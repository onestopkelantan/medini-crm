import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { ScopedSystemWorkerContext } from '../../../core/auth/db-context.service';
import { WhatsappService } from '../application/whatsapp.service';
import { WahaError } from '../infrastructure/waha.adapter';
import { WA_SEND_DELAY_MIN_MS, WA_SEND_DELAY_MAX_MS } from '../domain/whatsapp-lifecycle';

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

  /** Public for direct execution (integration tests invoke this exact runtime
   *  path — F-13). BullMQ calls it via the Worker registered in onModuleInit. */
  async handle(job: Job<WhatsappSendJob>): Promise<void> {
    const { messageId, orgId, branchId, channelId, correlationId } = job.data;
    const ctx: ScopedSystemWorkerContext = {
      orgId, branchIds: [branchId], correlationId, source: 'system_worker',
    };

    /* 1. Validate channel scope before any external call. */
    const channel = await this.whatsapp.validateChannelScope(ctx, channelId);
    if (channel.status !== 'working') {
      throw new Error(`Channel ${channelId} not working (status=${channel.status})`);
    }
    if (channel.autoPausedAt) {
      throw new Error(`Channel ${channelId} auto-paused — worker must not send`);
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
