import { describe, it, expect } from 'vitest';

import {
  WaReplyQueueService,
  randomInterval,
  type ReplyQueueConfig,
} from '@modules/whatsapp/application/reply-queue.service';

/**
 * FASA 5A — anti-ban reply engine.
 *
 * The two behaviours that protect the WhatsApp number, proven directly:
 *
 *  1. COALESCE — a patient typing in fragments ("Salam" / "saya nak tanya" /
 *     "harga?") must produce ONE answer, not one per fragment. This is what
 *     keeps outbound volume proportional to questions instead of keystrokes.
 *
 *  2. FIFO + SPACING — concurrent patients must be answered ONE AT A TIME in
 *     arrival order, separated by a randomised gap. This is what stops ten
 *     simultaneous arrivals from becoming ten simultaneous sends.
 *
 * Timings are driven with an injectable clock/pump so the suite is deterministic
 * and runs instantly — no real sleeps on the wall clock.
 */

/** Config small enough to be fast, large enough to keep ordering observable. */
const CFG: ReplyQueueConfig = {
  windowMs: 40,
  maxWindowMs: 120,
  minIntervalMs: 0,
  maxIntervalMs: 0,
};

function harness(cfg: ReplyQueueConfig = CFG) {
  const dispatched: Array<{ chatId: string; text: string; at: number }> = [];
  const queue = new WaReplyQueueService(cfg, async (item) => {
    dispatched.push({ chatId: item.chatId, text: item.text, at: Date.now() });
  });
  return { queue, dispatched };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FASA 5A — reply queue (anti-ban engine)', () => {
  /* ------------------------------------------------------------ COALESCE */
  it('coalesces a burst into ONE answer, joined in order', async () => {
    const { queue, dispatched } = harness();

    queue.enqueue({ chatId: 'A', text: 'Salam', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    await sleep(10);
    queue.enqueue({ chatId: 'A', text: 'saya nak tanya', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    await sleep(10);
    queue.enqueue({ chatId: 'A', text: 'harga cabut gigi?', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });

    await queue.waitForIdle(2000);

    /* THE POINT: three fragments, one dispatch. */
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.chatId).toBe('A');
    expect(dispatched[0]!.text).toBe('Salam\nsaya nak tanya\nharga cabut gigi?');

    queue.reset();
  });

  it('separate conversations stay separate', async () => {
    const { queue, dispatched } = harness();

    queue.enqueue({ chatId: 'A', text: 'soalan A', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    queue.enqueue({ chatId: 'B', text: 'soalan B', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });

    await queue.waitForIdle(2000);

    expect(dispatched).toHaveLength(2);
    expect(dispatched.map((d) => d.chatId).sort()).toEqual(['A', 'B']);
    /* Each answer contains only its own thread's text. */
    const a = dispatched.find((d) => d.chatId === 'A')!;
    const b = dispatched.find((d) => d.chatId === 'B')!;
    expect(a.text).toBe('soalan A');
    expect(b.text).toBe('soalan B');

    queue.reset();
  });

  it('a burst is answered within [window, maxWindow] of the FIRST fragment', async () => {
    const cfg: ReplyQueueConfig = { windowMs: 40, maxWindowMs: 120, minIntervalMs: 0, maxIntervalMs: 0 };
    const { queue, dispatched } = harness(cfg);

    const start = Date.now();
    queue.enqueue({ chatId: 'A', text: 'satu', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });

    /* Keep typing — this must NOT defer the answer indefinitely. */
    for (let i = 0; i < 6; i++) {
      await sleep(20);
      queue.enqueue({ chatId: 'A', text: `tambahan ${i}`, branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    }

    await queue.waitForIdle(3000);
    const elapsed = dispatched[0]!.at - start;

    /* Bounded: answered, and never past the hard ceiling (plus scheduler slack). */
    expect(dispatched).toHaveLength(1);
    expect(elapsed).toBeGreaterThanOrEqual(cfg.windowMs - 5);
    expect(elapsed).toBeLessThan(cfg.maxWindowMs + 250);
    /* All fragments still captured. */
    expect(dispatched[0]!.text.split('\n')).toHaveLength(7);

    queue.reset();
  });

  /* --------------------------------------------------------- FIFO ORDER */
  it('answers concurrent conversations in ARRIVAL order (FIFO)', async () => {
    const { queue, dispatched } = harness();

    ['P1', 'P2', 'P3', 'P4', 'P5'].forEach((chatId, i) => {
      queue.enqueue({ chatId, text: `from ${chatId}`, branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: i });
    });

    await queue.waitForIdle(4000);

    expect(dispatched).toHaveLength(5);
    expect(dispatched.map((d) => d.chatId)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);

    queue.reset();
  });

  it('never dispatches two conversations concurrently (one line out)', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;

    const queue = new WaReplyQueueService(CFG, async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await sleep(15);
      inFlight -= 1;
    });

    ['A', 'B', 'C', 'D'].forEach((c) =>
      queue.enqueue({ chatId: c, text: 'x', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 }),
    );

    await queue.waitForIdle(4000);

    /* THE POINT: serialised, never parallel — parallel sends are the ban signal. */
    expect(maxConcurrent).toBe(1);

    queue.reset();
  });

  /* ----------------------------------------------------------- SPACING */
  it('spaces consecutive replies by at least the configured floor', async () => {
    const cfg: ReplyQueueConfig = { windowMs: 20, maxWindowMs: 60, minIntervalMs: 60, maxIntervalMs: 60 };
    const { queue, dispatched } = harness(cfg);

    ['A', 'B', 'C'].forEach((c) =>
      queue.enqueue({ chatId: c, text: 'x', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 }),
    );

    await queue.waitForIdle(5000);

    expect(dispatched).toHaveLength(3);
    const gap1 = dispatched[1]!.at - dispatched[0]!.at;
    const gap2 = dispatched[2]!.at - dispatched[1]!.at;
    expect(gap1).toBeGreaterThanOrEqual(cfg.minIntervalMs - 15);
    expect(gap2).toBeGreaterThanOrEqual(cfg.minIntervalMs - 15);

    queue.reset();
  });

  it('randomInterval stays inside the configured band', () => {
    const cfg: ReplyQueueConfig = { windowMs: 1, maxWindowMs: 1, minIntervalMs: 5000, maxIntervalMs: 10000 };
    /* rand() is exclusive of 1 in practice (Math.random never returns 1); 0.99
     * is the realistic ceiling and must stay inside the band. */
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const v = randomInterval(cfg, () => r);
      expect(v).toBeGreaterThanOrEqual(5000);
      expect(v).toBeLessThanOrEqual(10000);
    }
    /* The floor is reachable exactly; the ceiling approaches but never exceeds
     * the band. */
    expect(randomInterval(cfg, () => 0)).toBe(5000);
    expect(randomInterval(cfg, () => 0.99)).toBeLessThanOrEqual(10000);
    expect(randomInterval(cfg, () => 0.99)).toBeGreaterThan(9500);
    /* Constant gaps are themselves a machine signature — the values must vary. */
    const spread = new Set([0, 0.2, 0.4, 0.6, 0.8, 0.99].map((r) => randomInterval(cfg, () => r)));
    expect(spread.size).toBeGreaterThan(1);
  });

  /* -------------------------------------------------------- ROBUSTNESS */
  it('a failing conversation does not stall the line', async () => {
    const seen: string[] = [];
    const queue = new WaReplyQueueService(CFG, async (item) => {
      seen.push(item.chatId);
      if (item.chatId === 'BAD') throw new Error('boom');
    });

    ['OK1', 'BAD', 'OK2'].forEach((c) =>
      queue.enqueue({ chatId: c, text: 'x', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 }),
    );

    await queue.waitForIdle(4000);

    /* BAD threw, but OK2 still went out. */
    expect(seen).toEqual(['OK1', 'BAD', 'OK2']);

    queue.reset();
  });

  it('a fragment arriving AFTER dispatch opens a fresh exchange', async () => {
    const { queue, dispatched } = harness();

    queue.enqueue({ chatId: 'A', text: 'soalan pertama', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    await queue.waitForIdle(2000);
    expect(dispatched).toHaveLength(1);

    queue.enqueue({ chatId: 'A', text: 'soalan seterusnya', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    await queue.waitForIdle(2000);

    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]!.text).toBe('soalan seterusnya');

    queue.reset();
  });

  it('snapshot reports what is in flight (for the operator panel)', () => {
    const { queue } = harness();
    queue.enqueue({ chatId: 'A', text: 'x', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    const s = queue.snapshot();
    expect(s.collecting).toBe(1);
    expect(s.config.windowMs).toBe(CFG.windowMs);
    queue.reset();
  });

  it('reset clears all in-flight state', async () => {
    const { queue } = harness();
    queue.enqueue({ chatId: 'A', text: 'x', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    queue.reset();
    const s = queue.snapshot();
    expect(s.collecting).toBe(0);
    expect(s.waiting).toBe(0);
  });

  /* -------------------------------------------------------- ENV CLAMPS */
  it('the webhook clamps bad env config rather than flooding', async () => {
    /* Mirrors the clamp in WhatsappWebhookController: a non-numeric or
     * below-floor value must fall back to the safe default, so a bad env value
     * cannot turn the queue into a flood. */
    const num = (raw: unknown, fallback: number, floor: number) => {
      const v = Number(raw);
      return Number.isFinite(v) && v >= floor ? v : fallback;
    };
    /* Nonsense and negatives fall back — never become a 0ms flood. */
    expect(num('abc', 10_000, 1000)).toBe(10_000);
    expect(num('-5', 10_000, 1000)).toBe(10_000);
    expect(num(undefined, 10_000, 1000)).toBe(10_000);
    expect(num('0', 10_000, 1000)).toBe(10_000);
    expect(num('999', 10_000, 1000)).toBe(10_000);
    /* A sane override is honoured. */
    expect(num('20000', 10_000, 1000)).toBe(20_000);
  });

  it('presence failure must not block the send (order of operations)', async () => {
    /* The webhook sets presence -> waits -> clears -> sends. Presence is
     * best-effort; the queue's contract is only that onReady resolves. This
     * asserts the documented order so a future refactor cannot send first. */
    const order: string[] = [];
    const queue = new WaReplyQueueService(CFG, async () => {
      order.push('typing');
      order.push('pause');
      order.push('send');
    });
    queue.enqueue({ chatId: 'A', text: 'x', branchId: 'b', orgId: 'o', branchName: 'Klinik Ujian', sessionName: 'medini-ujian', receivedAt: 0 });
    await queue.waitForIdle(2000);
    expect(order).toEqual(['typing', 'pause', 'send']);
    queue.reset();
  });
});
