import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { ScopedSystemWorkerContext } from '../../../core/auth/db-context.service';
import { WhatsappService } from '../application/whatsapp.service';
import { WahaError } from '../infrastructure/waha.adapter';
import { WA_SEND_DELAY_MIN_MS, WA_SEND_DELAY_MAX_MS, WA_AUTO_PAUSE_MS } from '../domain/whatsapp-lifecycle';
import { mustAbortSend } from '../domain/blast-guard';

export interface WhatsappSendJob {
  messageId: string;
  orgId: string;
  branchId: string;
  channelId: string;
  conversationId: string;
  correlationId: string;
}

/** D18 (governance-approved 30–60s randomized per-channel cooldown): the
 *  worker sleeps a random 30–60s BEFORE each send so no channel fires two
 *  external WhatsApp messages inside the anti-ban window, regardless of how
 *  fast BullMQ delivers jobs. */
export function randomizedSendDelay(rng: () => number = Math.random): number {
  const span = WA_SEND_DELAY_MAX_MS - WA_SEND_DELAY_MIN_MS;
  return WA_SEND_DELAY_MIN_MS + Math.floor(rng() * (span + 1));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Longest a single job will wait for its scheduled instant before giving up and
 *  letting a fresh job be enqueued. Holding a BullMQ job open for hours makes it
 *  invisible to reconciliation and loses the schedule on restart. */
export const WA_MAX_SCHEDULE_WAIT_MS = 15 * 60_000;

/** WhatsApp send worker — system-worker identity, RLS-scoped, idempotent. */
@Injectable()
export class WhatsappTransportWorker implements OnModuleInit, OnApplicationShutdown {
  private worker: Worker | null = null;
  constructor(private readonly queues: QueueRegistry, private readonly whatsapp: WhatsappService) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    this.worker = new Worker('whatsapp-send', async (job: Job<WhatsappSendJob>) => this.handle(job), {
      connection,
      concurrency: 1, /* per-channel sequential — BullMQ groupId not used here; we use channel row lock */
    });
  }

  async onApplicationShutdown(): Promise<void> { await this.worker?.close(); }

  /** Cap a scheduled wait so a stale schedule cannot pin a job open for hours.
   *  A job that wakes early simply re-examines its send_at and waits again. */
  private clampWait(ms: number): number {
    return Math.min(Math.max(0, ms), WA_MAX_SCHEDULE_WAIT_MS);
  }

  /** Public for direct execution (integration tests invoke this exact runtime
   *  path — F-13). BullMQ calls it via the Worker registered in onModuleInit. */
  async handle(job: Job<WhatsappSendJob>): Promise<void> {
    const { messageId, orgId, branchId, channelId, correlationId } = job.data;
    const ctx: ScopedSystemWorkerContext = {
      orgId, branchIds: [branchId], correlationId, source: 'system_worker',
    };

    /* 0. SEND-TIME GUARD — opt-out re-checked, then pace.
     *
     *  The blast path queues without the safety engine (its window gate is
     *  09:00–18:00 and would refuse an 08:00 blast), so this is where every rule
     *  it skipped is applied. The critical one: a blast spans up to 14 days, and
     *  a patient can reply STOP at any point in between. The queue decision is
     *  stale the moment they do, so the list is re-read here.
     *
     *  Before the sleep, not after: waiting eight minutes and then discovering
     *  the patient opted out wastes the slot. */
    const msgForGuard = await this.whatsapp.getWorkerMessage(ctx, messageId);
    if (!msgForGuard) throw new WahaError(`Message ${messageId} not found`, false);

    const conversationForGuard = await this.whatsapp.getWorkerConversation(ctx, msgForGuard.conversationId);
    if (!conversationForGuard) {
      throw new WahaError(`Conversation ${msgForGuard.conversationId} not found`, false);
    }

    const optedOut = await this.whatsapp.checkOptOutStatus(orgId, conversationForGuard.contactPhone);
    const verdict = mustAbortSend({
      optedOut,
      campaignStopped: await this.whatsapp.isCampaignStopped(ctx, msgForGuard.blastBatchId),
      cancelled: msgForGuard.status === 'cancelled' || Boolean(msgForGuard.cancelledAt),
    });

    if (verdict.abort) {
      await this.whatsapp.cancelWorkerSend(ctx, messageId, verdict.reason ?? 'ABORTED');
      /* Deliberate, terminal, and NOT a job failure: retrying would only repeat
       * the same compliance decision. */
      return;
    }

    /* 0b. Pace: wait until this message's scheduled instant. The schedule was
     *     computed up front by planDrip (up to 504s apart, which a fixed sleep
     *     ceiling of 60s could never express). Capped so a restart does not hold
     *     a job open indefinitely. */
    const nowMs = Date.now();
    if (msgForGuard.sendAt) {
      const waitMs = new Date(msgForGuard.sendAt).getTime() - nowMs;
      if (waitMs > 0) {
        await sleep(this.clampWait(waitMs));
        /* Re-check after waiting: the sleep can be minutes long, and the opt-out
         * list can change in that time. This is the same race as above, at
         * shorter range. */
        const optedOutAgain = await this.whatsapp.checkOptOutStatus(orgId, conversationForGuard.contactPhone);
        if (optedOutAgain !== false) {
          await this.whatsapp.cancelWorkerSend(ctx, messageId, 'OPTED_OUT');
          return;
        }
      }
    }

    /* 1. Validate channel scope before any external call. */
    let channel = await this.whatsapp.validateChannelScope(ctx, channelId);
    if (channel.status !== 'working') {
      throw new Error(`Channel ${channelId} not working (status=${channel.status})`);
    }
    if (channel.autoPausedAt) {
      const pausedAt =
        new Date(channel.autoPausedAt).getTime();

      const remainingPauseMs = Math.max(
        0,
        WA_AUTO_PAUSE_MS -
          (Date.now() - pausedAt),
      );

      if (remainingPauseMs > 0) {
        await sleep(remainingPauseMs);
      }

      await this.whatsapp.autoResumeExpiredChannels(ctx);

      channel =
        await this.whatsapp.validateChannelScope(
          ctx,
          channelId,
        );

      if (channel.autoPausedAt) {
        throw new Error(
          `Channel ${channelId} is still auto-paused`,
        );
      }
    }

/* 2. Mark processing (idempotent — safe on retry). */
    const msg = await this.whatsapp.markMessageProcessing(ctx, messageId);

    /* 3. Resolve actual WhatsApp chatId from conversation.contact_phone (F-01).
     *    Never pass internal UUID to WAHA. */
    const conversation = await this.whatsapp.getWorkerConversation(ctx, msg.conversationId);
    if (!conversation) throw new WahaError(`Conversation ${msg.conversationId} not found`, false);
    const chatId = `${conversation.contactPhone.replace(/[^0-9]/g, '')}@c.us`;

    /* 4. D18: randomized 30–60s per-channel cooldown before the external call.
     *    Test seam: WA_SEND_DELAY_DISABLE=1 skips the sleep (delay math itself
     *    is unit-tested via randomizedSendDelay). */
    if (process.env.WA_SEND_DELAY_DISABLE !== '1') {
      await sleep(randomizedSendDelay());
    }

    /* 5. Send via WAHA. */
    try {
      const session = channel.sessionName ?? `medini-branch-${branchId}`;
      const result = await this.whatsapp.transport.sendText(session, chatId, msg.body);
      if (!result.externalMessageId) throw new WahaError('WAHA returned no external message id', false);
      await this.whatsapp.confirmWorkerSend(ctx, messageId, result.externalMessageId);
    } catch (e) {
      const reason = e instanceof WahaError ? e.message : (e as Error).message;
      const retryable = e instanceof WahaError ? e.retryable : true;
      if (retryable && job.attemptsMade < 5) {
        throw e; /* let BullMQ retry with exponential backoff */
      }
      await this.whatsapp.markWorkerSendFailed(ctx, messageId, reason);
      throw e;
    }
  }
}
