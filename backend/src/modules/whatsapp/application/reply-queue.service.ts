/**
 * WA reply queue — anti-ban engine for AI replies.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Receiving a message used to trigger an immediate AI call and send, per
 * message. Two consequences, both of which get a number banned:
 *
 *  1. A patient who types in bursts ("Salam" … "saya nak tanya" … "harga?" …)
 *     produced one AI call and one reply PER FRAGMENT. Four replies to one
 *     question looks robotic and multiplies outbound volume by four.
 *  2. Ten patients messaging at once produced ten concurrent AI calls and ten
 *     near-simultaneous sends — a sending pattern no human produces.
 *
 * THE FIX
 *
 * Messages are never answered on arrival. They are COLLECTED per conversation
 * inside a short window, then the whole burst is answered ONCE. Replies leave
 * through a single FIFO line, one conversation at a time, spaced by a minimum
 * interval. Outbound volume ends up proportional to QUESTIONS, not to how many
 * times the patient pressed send.
 *
 * WINDOW RULE (sliding, bounded)
 *
 * The deadline is anchored to the FIRST collected message and extended by each
 * new one — but never past a hard ceiling. So a burst is always answered
 * within [windowMs, maxWindowMs] of its first fragment: responsive, yet patient
 * enough to gather fragments, and it can never be pushed back indefinitely by a
 * patient who keeps typing.
 *
 * HONEST LIMIT
 *
 * This queue is IN-PROCESS. A restart drops pending collections (already-saved
 * inbound messages are unaffected; they simply stop being auto-answered). That
 * is acceptable for a single-instance deployment and is the deliberate first
 * step — moving it to Redis is a separate change once the behaviour is proven.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface QueuedInbound {
  /** Conversation/chat identity — the grouping key. */
  chatId: string;
  text: string;
  branchId: string;
  orgId: string;
  /** Human-readable branch name, so the reply names the right clinic. */
  branchName: string;
  sessionName: string;
  receivedAt: number;
  /**
   * Per-branch collection window in ms, from ai_whatsapp_settings. The operator
   * sets this in the UI; the queue falls back to its configured default when
   * absent so a call without settings still behaves safely.
   */
  windowMs?: number;
  /** Whether the reply may show "sedang menaip…" first. */
  typingIndicator?: boolean;
  /**
   * Per-branch spacing band between two outbound replies, in ms. This is the
   * "Sela Masa Balasan" slider the operator drags (5s↔20s). It is read from
   * ai_whatsapp_settings for the branch that owns the conversation, so each
   * branch keeps its own pace.
   */
  minIntervalMs?: number;
  maxIntervalMs?: number;
}

interface PendingConversation {
  chatId: string;
  branchId: string;
  orgId: string;
  branchName: string;
  sessionName: string;
  parts: string[];
  /** When the FIRST fragment arrived — anchors the window. */
  firstAt: number;
  /** Absolute time this conversation becomes answerable. */
  dueAt: number;
  /** Hard ceiling for `dueAt`, so bursts cannot defer the answer forever. */
  latestAt: number;
  /** Set once dispatched, so a late fragment opens a NEW collection. */
  dispatched: boolean;
  typingIndicator: boolean;
  /** Effective window for this conversation (per-branch override). */
  windowMs: number;
  /** Effective spacing band for this conversation (per-branch override). */
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface ReplyQueueConfig {
  /** Collect for this long after the first fragment (default 10s). */
  windowMs: number;
  /** Never wait longer than this from the first fragment (default 30s). */
  maxWindowMs: number;
  /** Minimum spacing between two outbound replies (default 10000 ms). */
  minIntervalMs: number;
  /** Upper bound for the randomised per-send spacing (default 20000 ms). */
  maxIntervalMs: number;
}

export const DEFAULT_REPLY_QUEUE_CONFIG: ReplyQueueConfig = {
  windowMs: 10_000,
  maxWindowMs: 30_000,
  minIntervalMs: 10_000,
  maxIntervalMs: 20_000,
};

/** Randomised inter-send gap. A constant gap is itself a machine signature. */
export function randomInterval(cfg: ReplyQueueConfig, rand: () => number = Math.random): number {
  const lo = Math.max(0, cfg.minIntervalMs);
  const hi = Math.max(lo, cfg.maxIntervalMs);
  return lo + Math.floor(rand() * (hi - lo + 1));
}

@Injectable()
export class WaReplyQueueService {
  private readonly logger = new Logger(WaReplyQueueService.name);

  private readonly pending = new Map<string, PendingConversation>();
  /** FIFO of conversations ready to be answered. */
  private readonly ready: string[] = [];
  private draining = false;
  private lastSendAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ReplyQueueConfig = DEFAULT_REPLY_QUEUE_CONFIG,
    /** Answers one conversation's coalesced burst. Injected so the queue stays
     * free of AI/transport concerns and is directly testable. */
    private readonly onReady: (
      item: {
        chatId: string;
        branchId: string;
        orgId: string;
        branchName: string;
        sessionName: string;
        text: string;
        typingIndicator: boolean;
      },
    ) => Promise<void>,
  ) {}

  /** Register a new inbound fragment. Idempotent per message — callers pass
   *  each WHOLE inbound message exactly once. */
  enqueue(input: QueuedInbound, now: number = Date.now()): void {
    const existing = this.pending.get(input.chatId);

    /* A fragment arriving AFTER dispatch belongs to a fresh exchange.
     * Note the operator's window can shrink mid-burst (they moved the slider);
     * the new value applies from this fragment on, while the ceiling stays
     * anchored to the first fragment. */
    if (existing && !existing.dispatched) {
      existing.parts.push(input.text);
      if (typeof input.windowMs === 'number' && input.windowMs > 0) {
        existing.windowMs = input.windowMs;
      }
      /* Extend, but never beyond the ceiling anchored on the first fragment. */
      existing.dueAt = Math.min(now + existing.windowMs, existing.latestAt);
      this.arm();
      return;
    }

    /* Clamp: a sane floor keeps a bad setting from collapsing the collector,
     * and the ceiling stops an absurd window from stalling replies. */
    const windowMs = Math.min(
      Math.max(input.windowMs ?? this.config.windowMs, 1000),
      Math.max(this.config.windowMs, this.config.maxWindowMs),
    );
    const firstAt = now;
    const latestAt = firstAt + Math.max(windowMs, this.config.maxWindowMs);
    this.pending.set(input.chatId, {
      chatId: input.chatId,
      branchId: input.branchId,
      orgId: input.orgId,
      branchName: input.branchName,
      sessionName: input.sessionName,
      parts: [input.text],
      firstAt,
      dueAt: Math.min(firstAt + windowMs, latestAt),
      latestAt,
      dispatched: false,
      typingIndicator: input.typingIndicator ?? true,
      windowMs,
      /* Spacing floor comes from the operator's slider. Clamped so a bad value
       * can never produce a 0ms flood, and never slower than the ceiling. */
      minIntervalMs: Math.max(0, input.minIntervalMs ?? this.config.minIntervalMs),
      maxIntervalMs: Math.max(
        Math.max(0, input.minIntervalMs ?? this.config.minIntervalMs),
        input.maxIntervalMs ?? this.config.maxIntervalMs,
      ),
    });
    this.arm();
  }

  private arm(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.promoteDue();
    }, 250);
    /* Never hold the event loop open on account of the collector. */
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  /** Move every conversation whose window has closed into the FIFO line. */
  private promoteDue(now: number = Date.now()): void {
    let promoted = false;
    for (const [chatId, p] of this.pending) {
      if (p.dispatched) continue;
      if (now >= p.dueAt) {
        p.dispatched = true;
        this.ready.push(chatId);
        promoted = true;
      }
    }
    if (promoted) this.drain();
    else if (this.pending.size) this.arm();
  }

  /**
   * Single FIFO line: one conversation answered at a time, spaced by a
   * randomised interval. This is what keeps concurrent arrivals from turning
   * into lockstep bursts.
   */
  private async drain(now: number = Date.now()): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.ready.length) {
        /* Spacing is per-branch: the next conversation in line carries its own
         * band, taken from the operator's slider for that branch. */
        const next = this.pending.get(this.ready[0]!);
        const band: ReplyQueueConfig = {
          ...this.config,
          minIntervalMs: next?.minIntervalMs ?? this.config.minIntervalMs,
          maxIntervalMs: next?.maxIntervalMs ?? this.config.maxIntervalMs,
        };
        const wait = this.lastSendAt + randomInterval(band) - now;
        if (wait > 0) {
          await new Promise((r) => setTimeout(r, wait));
          now = Date.now();
        }

        const chatId = this.ready.shift()!;
        const p = this.pending.get(chatId);
        if (!p) continue;

        /* Burst joined into ONE text — the patient's question, not fragments. */
        const text = p.parts.join('\n').trim();
        this.pending.delete(chatId);
        this.lastSendAt = Date.now();

        try {
          await this.onReady({
            chatId,
            branchId: p.branchId,
            orgId: p.orgId,
            branchName: p.branchName,
            sessionName: p.sessionName,
            text,
            typingIndicator: p.typingIndicator,
          });
        } catch (e) {
          /* One failed conversation must never stall the line. */
          this.logger.error(
            `reply dispatch failed chatId=${chatId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        now = Date.now();
      }
    } finally {
      this.draining = false;
    }
  }

  /** Await the line going idle. Test seam only. */
  async waitForIdle(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.promoteDue();
      if (!this.pending.size && !this.ready.length && !this.draining) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Observability — what the operator panel reports. */
  snapshot() {
    return {
      collecting: this.pending.size,
      waiting: this.ready.length,
      draining: this.draining,
      config: { ...this.config },
    };
  }

  /** Test seam: forget all in-flight state. */
  reset(): void {
    this.pending.clear();
    this.ready.length = 0;
    this.draining = false;
    this.lastSendAt = 0;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
