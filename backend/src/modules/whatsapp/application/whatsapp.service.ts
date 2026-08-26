import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { DbContextService, ScopedSystemWorkerContext, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/errors';
import { WhatsappRepository, WA_PAGE_MAX } from '../infrastructure/whatsapp.repository';
import { WahaAdapter } from '../infrastructure/waha.adapter';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import {
  canTransitionWaChannel, canTransitionWaConversation, canTransitionWaMessage, canTransitionWaAiQueue,
  evaluateWaSafety, waHealthBand, normalizePhone,
  WaChannelState, WaConversationState, WaMessageState, WaAiQueueState,
  WA_AUTO_PAUSE_MS,
} from '../domain/whatsapp-lifecycle';

const uuid = z.string().uuid();
const page = z.object({
  limit: z.coerce.number().int().min(1).max(WA_PAGE_MAX).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const channelInput = z.object({ branchId: uuid, phone: z.string().trim().min(6).max(64), sessionName: z.string().trim().max(128).nullish() });
const channelStatusInput = z.object({ status: z.enum(['stopped', 'starting', 'working', 'failed', 'need_qr']) });
const conversationInput = z.object({ channelId: uuid, contactPhone: z.string().trim().min(6).max(64), linkPatient: z.boolean().default(true).optional() });
const messageInput = z.object({
  body: z.string().trim().min(1).max(4096),
  idempotencyKey: z.string().trim().min(8).max(256), /* MANDATORY for authoritative message creation (governance §8) */
  mediaType: z.string().max(64).nullish(),
});
const messageStatusInput = z.object({ status: z.enum(['sent', 'delivered', 'read', 'failed']) });
const assignInput = z.object({ staffId: uuid });
const aiQueueInput = z.object({ state: z.enum(['received', 'buffering', 'ready', 'processing', 'responded', 'waiting', 'handoff', 'closed']) });
const templateInput = z.object({ branchId: uuid, name: z.string().trim().min(1).max(256), body: z.string().trim().min(1).max(4096), category: z.string().trim().max(64).nullish() });
const templatePatchInput = z.object({ name: z.string().trim().min(1).max(256).optional(), body: z.string().trim().min(1).max(4096).optional(), category: z.string().trim().max(64).nullish(), active: z.boolean().optional() });

/** Internal carrier for a blocked safety evaluation (never surfaced as-is;
 * converted to ForbiddenError after the decision is persisted out-of-tx). */
interface WaBlockedMeta {
  orgId: string; branchId: string; channelId: string; conversationId: string;
  blockedReason: string | null; gates: unknown; principal: Principal;
}
class WaSafetyBlockedError extends Error {
  constructor(public readonly reason: string, public readonly meta: WaBlockedMeta) { super(reason); this.name = 'WaSafetyBlockedError'; }
}

/**
 * WhatsApp Hub — communication system of record (Sprint 6).
 * Persistent SIMULATED state only: NO WAHA transport, NO worker/queue/outbox,
 * NO campaign execution, NO AI decision logic (S7/S8 scope).
 * Roles: hq (all) · branch_manager/branch_admin/receptionist (branch) · doctor = NONE (D1).
 */
@Injectable()
export class WhatsappService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: WhatsappRepository,
    private readonly patients: PatientsReadPort,
    private readonly audit: AuditService,
    /* Clock seam — production default is wall-clock; tests inject a fixed
     * instant so safety-gate evaluation (09:00–18:00 MYT window) is
     * deterministic. No behavioural difference in production. */
    private readonly nowFn: () => Date = () => new Date(),
    private readonly waha: WahaAdapter = new WahaAdapter(),
    private readonly queues?: QueueRegistry,
  ) {}

  /** Exposed for the transport worker — adapter boundary, not domain logic. */
  get transport(): WahaAdapter { return this.waha; }

  /** Test seam: HQ-scoped channel mutation for setup (not for production use). */
  async hqUpdateChannel(p: Principal, id: string, set: Record<string, unknown>) {
    return this.dbCtx.runAs(p, async (tx) => this.repo.updateChannel(tx, p.orgId, id, set));
  }

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new ValidationError(Object.fromEntries(result.error.issues.map((x) => [x.path.join('.'), [x.message]])));
    return result.data;
  }
  private auditEvent(p: Principal, action: string, entity: string, id: string, branchId: string, before?: Record<string, unknown>, after?: Record<string, unknown>) {
    return { actorId: p.staffId, actorRole: p.role, action, entity, entityId: id, orgId: p.orgId, branchId, source: 'api' as const, before, after };
  }
  /** HQ may act on any branch; branch roles only on their own. Doctor is already denied by the RBAC matrix (D1). */
  private branch(p: Principal, requested: string) {
    if (p.role !== 'hq' && p.branchId !== requested) throw new ForbiddenError('Branch-scoped role cannot access another branch');
    return requested;
  }
  private scoped(p: Principal, requested?: string) { return p.role === 'hq' ? (requested ?? null) : p.branchId; }
  private pageOf(raw: unknown) {
    const pg = this.parse(page, raw ?? {});
    return { limit: pg.limit ?? 50, offset: pg.offset ?? 0 };
  }

  /* ==========================================================================
     CHANNELS (simulated WAHA session state; connect/restart = HQ-controlled)
     ==========================================================================*/
  async createChannel(p: Principal, raw: unknown) {
    const input = this.parse(channelInput, raw);
    if (p.role !== 'hq') throw new ForbiddenError('Channel management is HQ-controlled');
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createChannel(tx, {
        orgId: p.orgId, branchId: input.branchId, phone: input.phone, sessionName: input.sessionName ?? null,
        status: 'stopped', createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'wa_channel_created', 'wa_channels', row.id, input.branchId), tx);
      return row;
    });
  }

  async listChannels(p: Principal, branchId?: string, rawPage?: unknown) {
    const pg = this.pageOf(rawPage);
    return this.dbCtx.runAs(p, (tx) => this.repo.listChannels(tx, p.orgId, this.scoped(p, branchId), pg.limit, pg.offset));
  }

  async transitionChannel(p: Principal, id: string, raw: unknown) {
    const input = this.parse(channelStatusInput, raw);
    if (p.role !== 'hq') throw new ForbiddenError('Channel connect/restart is HQ-controlled');
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.lockChannel(tx, p.orgId, id);
      if (!before) throw new NotFoundError('waChannel', id);
      if (!canTransitionWaChannel(before.status as WaChannelState, input.status)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${input.status}`);
      }
      if (before.status === input.status) return before;
      const extra: Record<string, unknown> = { status: input.status };
      if (input.status === 'working') extra.lastSeenAt = new Date();
      const updated = await this.repo.updateChannel(tx, p.orgId, id, extra);
      if (!updated) throw new NotFoundError('waChannel', id);
      await this.audit.record(this.auditEvent(p, `wa_channel_${input.status}`, 'wa_channels', id, before.branchId, { status: before.status }, { status: input.status }), tx);
      return updated;
    });
  }

  /* ==========================================================================
     CONVERSATIONS
     ==========================================================================*/
  async createConversation(p: Principal, raw: unknown) {
    const input = this.parse(conversationInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const channel = await this.repo.findChannel(tx, p.orgId, input.channelId);
      if (!channel) throw new ValidationError({ channelId: ['Unknown channel'] });
      this.branch(p, channel.branchId);
      const contact = normalizePhone(input.contactPhone);

      /* Patient phone matching (governance §7): org-scoped via RLS context,
       * minimal fields, ambiguity-safe — NEVER arbitrarily pick a patient. */
      let patientId: string | null = null;
      if (input.linkPatient !== false) {
        const matches = await this.patients.findByPhone(tx, p.orgId, contact);
        const visible = p.role === 'hq' ? matches : matches.filter((m) => m.branchId === channel.branchId);
        const uniqueIds = new Set(visible.map((m) => m.id));
        if (uniqueIds.size === 1) {
          patientId = visible[0]!.id;
          await this.audit.record(this.auditEvent(p, 'wa_conversation_patient_linked', 'wa_conversations', input.channelId, channel.branchId, undefined, { patientId, contactPhone: contact }), tx);
        } else if (uniqueIds.size > 1) {
          await this.audit.record(this.auditEvent(p, 'wa_patient_match_ambiguous', 'wa_conversations', input.channelId, channel.branchId, undefined, { candidates: uniqueIds.size, contactPhone: contact }), tx);
        }
      }

      /* Deterministic duplicate protection: reuse the existing ACTIVE
       * conversation for this channel+contact; only create when none exists
       * (archived = terminal history → a returning contact gets a NEW row). */
      const existing = await this.repo.findActiveConversation(tx, p.orgId, channel.id, contact);
      if (existing) return { conversation: existing, reused: true };
      const row = await this.repo.createConversation(tx, {
        orgId: p.orgId, branchId: channel.branchId, channelId: channel.id, contactPhone: contact,
        patientId, status: 'new', createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'wa_conversation_created', 'wa_conversations', row.id, channel.branchId), tx);
      return { conversation: row, reused: false };
    });
  }

  async listConversations(p: Principal, rawQuery: Record<string, unknown>) {
    const pg = this.pageOf({ limit: rawQuery.limit, offset: rawQuery.offset });
    const filters = {
      status: typeof rawQuery.status === 'string' ? rawQuery.status : undefined,
      assignedTo: typeof rawQuery.assignedTo === 'string' ? rawQuery.assignedTo : undefined,
      unassigned: rawQuery.unassigned === 'true',
      unreadOnly: rawQuery.unread === 'true',
    };
    const branchId = typeof rawQuery.branchId === 'string' ? rawQuery.branchId : undefined;
    return this.dbCtx.runAs(p, (tx) => this.repo.listConversations(tx, p.orgId, this.scoped(p, branchId), filters, pg.limit, pg.offset));
  }

  async getConversation(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.findConversation(tx, p.orgId, id);
      if (!row) throw new NotFoundError('waConversation', id);
      this.branch(p, row.branchId);
      return row;
    });
  }

  async listMessages(p: Principal, conversationId: string, rawPage?: unknown) {
    const pg = this.pageOf(rawPage);
    return this.dbCtx.runAs(p, async (tx) => {
      const conv = await this.repo.findConversation(tx, p.orgId, conversationId);
      if (!conv) throw new NotFoundError('waConversation', conversationId);
      this.branch(p, conv.branchId);
      return this.repo.listMessages(tx, p.orgId, conversationId, pg.limit, pg.offset);
    });
  }

  /* ==========================================================================
     MESSAGES — authoritative records with MANDATORY idempotency + safety engine.
     Records the intended message/state; does NOT send a real WhatsApp message.
     ==========================================================================*/
  async createMessage(p: Principal, conversationId: string, raw: unknown) {
    const input = this.parse(messageInput, raw);
    let result: { message: { id: string; [k: string]: unknown }; branchId: string; channelId: string; conversationId: string };
    try {
      result = await this.dbCtx.runAs(p, async (tx) => {
      /* conv.lock semantics (M2 D6-D7): transaction-scoped row lock — one
       * processing cycle per conversation at a time. NOT a distributed lock. */
      const conv = await this.repo.lockConversation(tx, p.orgId, conversationId);
      if (!conv) throw new NotFoundError('waConversation', conversationId);
      this.branch(p, conv.branchId);
      if (conv.status === 'archived') throw new ConflictError('Archived conversations are terminal — open a new conversation');

      /* Idempotency replay: same key + same conversation → return original. */
      const replay = await this.repo.findMessageByIdempotencyKey(tx, p.orgId, conversationId, input.idempotencyKey);
      if (replay) {
        if (replay.body !== input.body) throw new ConflictError('Idempotency key was already used with a different message');
        return { message: replay, branchId: conv.branchId, channelId: conv.channelId, conversationId: conv.id };
      }

      const channel = await this.repo.lockChannel(tx, p.orgId, conv.channelId);
      if (!channel) throw new NotFoundError('waChannel', conv.channelId);

      /* Safety engine — six locked gates, synchronous, always audited.
       * IMPORTANT: blocked decisions must SURVIVE the ForbiddenError — a
       * same-transaction insert would roll back with the throw. We therefore
       * record the blocked decision in its OWN transaction after rethrowing
       * from the business tx (decision = compliance evidence, not business
       * state). Allowed decisions stay in-transaction with the message. */
      const now = this.nowFn();
      const evaluation = evaluateWaSafety({
        channelStatus: channel.status as WaChannelState,
        healthScore: channel.healthScore,
        sentTodayCount: channel.sentTodayCount,
        lastSentAt: channel.lastSentAt,
        now,
      });
      if (!evaluation.allowed) {
        await this.audit.record(this.auditEvent(p, 'wa_message_blocked', 'wa_conversations', conv.id, conv.branchId, undefined, { reason: evaluation.blockedReason }), tx);
        const blockedMeta = { orgId: p.orgId, branchId: conv.branchId, channelId: channel.id, conversationId: conv.id, blockedReason: evaluation.blockedReason, gates: evaluation.gates, principal: p };
        throw new WaSafetyBlockedError(evaluation.blockedReason ?? 'BLOCKED', blockedMeta);
      }

      const row = await this.repo.createMessage(tx, {
        orgId: p.orgId, branchId: conv.branchId, channelId: channel.id, conversationId: conv.id,
        direction: 'out', senderType: 'human', body: input.body, mediaType: input.mediaType ?? null,
        status: 'queued', idempotencyKey: input.idempotencyKey, createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.repo.createSafetyDecision(tx, {
        orgId: p.orgId, branchId: conv.branchId, channelId: channel.id, conversationId: conv.id, messageId: row.id,
        actorId: null, decision: 'allowed', blockedReason: null, gates: evaluation.gates,
      });

      /* Queueing is not delivery. The send worker increments channel counters only
       * after WAHA returns a durable external message ID. This avoids consuming
       * the anti-ban quota for failed attempts or retries. */
      const convUpdate: Record<string, unknown> = { lastMessageAt: new Date() };
      if (!conv.firstResponseAt && conv.status === 'new') {
        convUpdate.firstResponseAt = new Date();
        convUpdate.status = 'open';
      }
      await this.repo.updateConversation(tx, p.orgId, conv.id, convUpdate);

      await this.audit.record(this.auditEvent(p, 'wa_message_created', 'wa_messages', row.id, conv.branchId, undefined, { direction: 'out', senderType: 'human', status: 'queued' }), tx);

      /* F-06: Return metadata for post-commit dispatch */
      return { message: row as { id: string; [k: string]: unknown }, branchId: conv.branchId, channelId: channel.id, conversationId: conv.id };
      });

    /* F-06: Post-commit enqueue — DB durable state committed first, then queue.
     * If enqueue fails, reconcileQueuedMessages() recovers the stranded record. */
    await this.dispatchQueuedMessage(result.message.id, p.orgId, result.branchId, result.channelId, result.conversationId);

    return result.message;
    } catch (e) {
      /* Blocked-send compliance record: the business tx rolled back, so the
       * decision is persisted in a FRESH transaction (audit of a rejected
       * action must survive — M2 WAH.blocked). Then rethrow the 403. */
      if (e instanceof WaSafetyBlockedError) {
        const m = e.meta;
        await this.dbCtx.runAs(m.principal, async (tx2) => {
          await this.repo.createSafetyDecision(tx2, {
            orgId: m.orgId, branchId: m.branchId, channelId: m.channelId, conversationId: m.conversationId,
            actorId: null, decision: 'blocked', blockedReason: m.blockedReason, gates: m.gates,
          });
        });
        throw new ForbiddenError(`Message blocked by safety engine: ${e.reason}`);
      }
      throw e;
    }
  }

  /** Post-commit enqueue — called AFTER the DB transaction commits.
   *  If enqueue fails, the queued message remains durable for reconciliation. */
  async dispatchQueuedMessage(messageId: string, orgId: string, branchId: string, channelId: string, conversationId: string) {
    await this.queues?.enqueue('whatsapp-send', 'send-message', {
      messageId,
      orgId,
      branchId,
      channelId,
      conversationId,
      correlationId: getCorrelationId(),
    }, messageId);
  }

  /** F-06: Scoped reconciliation — find stranded queued messages and re-enqueue.
   *  Called by a periodic scheduler with explicit org+branch scope. */
  async reconcileQueuedMessages(ctx: ScopedSystemWorkerContext, thresholdMinutes = 5) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);
      const stranded = await tx.execute(
        sql`SELECT id, org_id, branch_id, channel_id, conversation_id FROM wa_messages
            WHERE org_id = ${ctx.orgId} AND branch_id = ${ctx.branchIds[0]!}
              AND status = 'queued' AND created_at < ${cutoff} AND deleted_at IS NULL`,
      );
      const rows = (stranded as unknown as { rows: Array<{ id: string; org_id: string; branch_id: string; channel_id: string; conversation_id: string }> }).rows;
      for (const row of rows) {
        await this.queues?.enqueue('whatsapp-send', 'send-message', {
          messageId: row.id, orgId: row.org_id, branchId: row.branch_id,
          channelId: row.channel_id, conversationId: row.conversation_id,
          correlationId: ctx.correlationId,
        }, row.id);
      }
      return rows.length;
    });
  }

  /** Called only after WAHA confirms a successful send. It is idempotent on
   * externalMessageId and locks the channel before consuming the send quota. */
  async confirmTransportSend(p: Principal, messageId: string, externalMessageId: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const message = await this.repo.findMessage(tx, p.orgId, messageId);
      if (!message) throw new NotFoundError('waMessage', messageId);
      this.branch(p, message.branchId);
      if (message.externalMessageId) return message; // Retry/duplicate acknowledgement.
      const channel = await this.repo.lockChannel(tx, p.orgId, message.channelId);
      if (!channel) throw new NotFoundError('waChannel', message.channelId);
      const now = this.nowFn();
      const today = now.toISOString().slice(0, 10);
      const count = channel.sentTodayDate === today ? channel.sentTodayCount : 0;
      const updatedMessage = await this.repo.updateMessage(tx, p.orgId, messageId, { status: 'sent', externalMessageId, sentAt: now });
      if (!updatedMessage) throw new NotFoundError('waMessage', messageId);
      const nextCount = count + 1;
      await this.repo.updateChannel(tx, p.orgId, channel.id, {
        sentTodayCount: nextCount, sentTodayDate: today, lastSentAt: now,
        autoPausedAt: nextCount % 25 === 0 ? now : channel.autoPausedAt,
      });
      await this.audit.record(this.auditEvent(p, 'wa_message_transport_sent', 'wa_messages', messageId, message.branchId, { status: message.status }, { status: 'sent', externalMessageId }), tx);
      return updatedMessage;
    });
  }

  /* ==========================================================================
     T2 — WORKER TRANSPORT PATH (system worker, runAsWorker, RLS-enforced)
     ==========================================================================*/

  /** Mark message as processing. Returns the row for the worker to proceed. */
  async markMessageProcessing(ctx: ScopedSystemWorkerContext, messageId: string) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const msg = await this.repo.findMessage(tx, ctx.orgId, messageId);
      if (!msg) throw new NotFoundError('waMessage', messageId);
      if (msg.status !== 'queued') return msg; /* already processing/sent/failed */
      const updated = await this.repo.updateMessage(tx, ctx.orgId, messageId, { status: 'processing' });
      return updated ?? msg;
    });
  }

  /** Worker-side confirm: idempotent, channel-locked, counter-safe. */
  async confirmWorkerSend(ctx: ScopedSystemWorkerContext, messageId: string, externalMessageId: string) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const msg = await this.repo.findMessage(tx, ctx.orgId, messageId);
      if (!msg) throw new NotFoundError('waMessage', messageId);
      if (msg.externalMessageId) return msg; /* duplicate success — no second increment */
      const channel = await this.repo.lockChannel(tx, ctx.orgId, msg.channelId);
      if (!channel) throw new NotFoundError('waChannel', msg.channelId);
      if (channel.autoPausedAt) throw new Error('Channel auto-paused — worker must not send');
      const now = this.nowFn();
      const today = now.toISOString().slice(0, 10);
      const count = channel.sentTodayDate === today ? channel.sentTodayCount : 0;
      const updatedMsg = await this.repo.updateMessage(tx, ctx.orgId, messageId, { status: 'sent', externalMessageId, sentAt: now });
      if (!updatedMsg) throw new NotFoundError('waMessage', messageId);
      const nextCount = count + 1;
      await this.repo.updateChannel(tx, ctx.orgId, channel.id, {
        sentTodayCount: nextCount, sentTodayDate: today, lastSentAt: now,
        autoPausedAt: nextCount % 25 === 0 ? now : channel.autoPausedAt,
      });
      await this.audit.record({
        actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
        action: 'wa_message_transport_sent', entity: 'wa_messages', entityId: messageId,
        orgId: ctx.orgId, branchId: msg.branchId, source: 'worker',
        before: { status: msg.status }, after: { status: 'sent', externalMessageId },
      }, tx);
      return updatedMsg;
    });
  }

  /** Worker-side failure: mark failed with reason (retry-safe; terminal). */
  async markWorkerSendFailed(ctx: ScopedSystemWorkerContext, messageId: string, reason: string) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const msg = await this.repo.findMessage(tx, ctx.orgId, messageId);
      if (!msg) throw new NotFoundError('waMessage', messageId);
      if (msg.externalMessageId) return msg; /* already sent — don't overwrite */
      const updated = await this.repo.updateMessage(tx, ctx.orgId, messageId, { status: 'failed', lastError: reason });
      await this.audit.record({
        actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
        action: 'wa_message_transport_failed', entity: 'wa_messages', entityId: messageId,
        orgId: ctx.orgId, branchId: msg.branchId, source: 'worker',
        before: { status: msg.status }, after: { status: 'failed', lastError: reason },
      }, tx);
      return updated;
    });
  }

  /** Validate channel scope ownership: channelId belongs to orgId + branchId. */
  async validateChannelScope(ctx: ScopedSystemWorkerContext, channelId: string) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const channel = await this.repo.findChannel(tx, ctx.orgId, channelId);
      if (!channel) throw new NotFoundError('waChannel', channelId);
      if (ctx.branchIds.length > 0 && !ctx.branchIds.includes(channel.branchId)) {
        throw new ForbiddenError('Channel belongs to a different branch than worker scope');
      }
      return channel;
    });
  }

  /** Worker-side conversation lookup — RLS-scoped, validates org+branch ownership. */
  async getWorkerConversation(ctx: ScopedSystemWorkerContext, conversationId: string) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const conv = await this.repo.findConversation(tx, ctx.orgId, conversationId);
      if (!conv) return null;
      if (ctx.branchIds.length > 0 && !ctx.branchIds.includes(conv.branchId)) return null;
      return conv;
    });
  }

  /** N6-3: auto-resume a channel whose pause has expired. */
  async autoResumeExpiredChannels(ctx: ScopedSystemWorkerContext) {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const now = this.nowFn();
      const cutoff = new Date(now.getTime() - WA_AUTO_PAUSE_MS);
      const expired = await tx.execute(
        sql`SELECT id, branch_id, auto_paused_at FROM wa_channels
            WHERE org_id = ${ctx.orgId} AND auto_paused_at IS NOT NULL
              AND auto_paused_at <= ${cutoff} AND deleted_at IS NULL`,
      );
      const rows = (expired as unknown as { rows: Array<{ id: string; branch_id: string; auto_paused_at: Date }> }).rows;
      for (const row of rows) {
        await this.repo.updateChannel(tx, ctx.orgId, row.id, { autoPausedAt: null, autoPauseResumedAt: now });
        await this.audit.record({
          actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
          action: 'wa_channel_auto_pause_expired', entity: 'wa_channels', entityId: row.id,
          orgId: ctx.orgId, branchId: row.branch_id, source: 'worker',
          before: { autoPausedAt: row.auto_paused_at }, after: { autoPauseResumedAt: now },
        }, tx);
      }
      return rows.length;
    });
  }

  /** Simulated delivery-state progression (no real transport; S8 owns delivery). */
  async transitionMessage(p: Principal, id: string, raw: unknown) {
    const input = this.parse(messageStatusInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findMessage(tx, p.orgId, id);
      if (!before) throw new NotFoundError('waMessage', id);
      this.branch(p, before.branchId);
      if (!canTransitionWaMessage(before.status as WaMessageState, input.status)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${input.status}`);
      }
      if (before.status === input.status) return before;
      const extra: Record<string, unknown> = { status: input.status };
      if (input.status === 'sent') extra.sentAt = new Date();
      if (input.status === 'delivered') extra.deliveredAt = new Date();
      if (input.status === 'read') extra.readAt = new Date();
      const updated = await this.repo.updateMessage(tx, p.orgId, id, extra);
      if (!updated) throw new NotFoundError('waMessage', id);
      await this.audit.record(this.auditEvent(p, `wa_message_${input.status}`, 'wa_messages', id, before.branchId, { status: before.status }, { status: input.status }), tx);
      return updated;
    });
  }

  /* ==========================================================================
     ASSIGNMENT + HUMAN HANDOFF + LIFECYCLE ACTIONS (append-only history)
     ==========================================================================*/
  private async assignmentAction(p: Principal, id: string, action: 'assign' | 'unassign' | 'handoff' | 'return_to_ai', raw?: unknown) {
    return this.dbCtx.runAs(p, async (tx) => {
      const conv = await this.repo.lockConversation(tx, p.orgId, id);
      if (!conv) throw new NotFoundError('waConversation', id);
      this.branch(p, conv.branchId);
      if (conv.status === 'archived') throw new ConflictError('Archived conversations are terminal');

      let assignedTo: string | null = conv.assignedTo;
      let status = conv.status as WaConversationState;
      let aiState = conv.aiQueueState as WaAiQueueState | null;

      if (action === 'assign') {
        if (p.role === 'branch_admin' || p.role === 'receptionist') throw new ForbiddenError('Receptionist cannot assign conversations');
        const input = this.parse(assignInput, raw);
        assignedTo = input.staffId;
        if (status === 'new') status = 'open';
      } else if (action === 'unassign') {
        if (p.role === 'branch_admin' || p.role === 'receptionist') throw new ForbiddenError('Receptionist cannot unassign conversations');
        assignedTo = null;
      } else if (action === 'handoff') {
        /* AI → HUMAN: human takes control; AI auto-reply pauses. */
        assignedTo = p.staffId;
        if (status === 'new' || status === 'pending') status = 'open';
        if (status === 'open' || status === 'escalated') status = 'escalated';
        /* AI queue: any active state transitions deterministically to handoff
         * (processing/waiting can; received/buffering/ready treated as engaged). */
        if (aiState && aiState !== 'handoff' && aiState !== 'closed') aiState = 'handoff';
      } else {
        /* HUMAN → AI: resume AI handling for this conversation. */
        assignedTo = null;
        if (status === 'escalated') status = 'open';
        if (aiState === 'handoff') aiState = null;
      }

      const updated = await this.repo.updateConversation(tx, p.orgId, id, { assignedTo, status, aiQueueState: aiState });
      if (!updated) throw new NotFoundError('waConversation', id);
      await this.repo.createAssignment(tx, {
        orgId: p.orgId, branchId: conv.branchId, conversationId: id,
        action, assignedTo, actorId: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, `wa_conversation_${action}`, 'wa_conversations', id, conv.branchId,
        { assignedTo: conv.assignedTo, status: conv.status }, { assignedTo, status }), tx);
      return updated;
    });
  }
  assignConversation(p: Principal, id: string, raw: unknown) { return this.assignmentAction(p, id, 'assign', raw); }
  unassignConversation(p: Principal, id: string) { return this.assignmentAction(p, id, 'unassign'); }
  handoffConversation(p: Principal, id: string) { return this.assignmentAction(p, id, 'handoff'); }
  returnToAiConversation(p: Principal, id: string) { return this.assignmentAction(p, id, 'return_to_ai'); }

  private async transitionConversation(p: Principal, id: string, next: WaConversationState) {
    return this.dbCtx.runAs(p, async (tx) => {
      const conv = await this.repo.lockConversation(tx, p.orgId, id);
      if (!conv) throw new NotFoundError('waConversation', id);
      this.branch(p, conv.branchId);
      const before = conv.status as WaConversationState;
      if (!canTransitionWaConversation(before, next)) throw new ConflictError(`Illegal transition ${before} → ${next}`);
      if (before === next) return conv;
      const extra: Record<string, unknown> = { status: next };
      if (next === 'resolved') extra.resolvedAt = new Date();
      if (next === 'archived' && p.role !== 'hq' && p.role !== 'branch_manager') throw new ForbiddenError('Only HQ or branch manager can archive conversations');
      const updated = await this.repo.updateConversation(tx, p.orgId, id, extra);
      if (!updated) throw new NotFoundError('waConversation', id);
      await this.audit.record(this.auditEvent(p, `wa_conversation_${next}`, 'wa_conversations', id, conv.branchId, { status: before }, { status: next }), tx);
      return updated;
    });
  }
  resolveConversation(p: Principal, id: string) { return this.transitionConversation(p, id, 'resolved'); }
  reopenConversation(p: Principal, id: string) { return this.transitionConversation(p, id, 'open'); }
  archiveConversation(p: Principal, id: string) { return this.transitionConversation(p, id, 'archived'); }

  /** AI response queue state foundation (state only — no timer/worker/AI in S6). */
  async transitionAiQueue(p: Principal, id: string, raw: unknown) {
    const input = this.parse(aiQueueInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const conv = await this.repo.lockConversation(tx, p.orgId, id);
      if (!conv) throw new NotFoundError('waConversation', id);
      this.branch(p, conv.branchId);
      const before = conv.aiQueueState as WaAiQueueState | null;
      if (!before) throw new ConflictError('AI queue is not active for this conversation');
      if (!canTransitionWaAiQueue(before, input.state)) throw new ConflictError(`Illegal transition ${before} → ${input.state}`);
      if (before === input.state) return conv;
      const updated = await this.repo.updateConversation(tx, p.orgId, id, { aiQueueState: input.state });
      if (!updated) throw new NotFoundError('waConversation', id);
      await this.audit.record(this.auditEvent(p, 'wa_ai_queue_transition', 'wa_conversations', id, conv.branchId, { state: before }, { state: input.state }), tx);
      return updated;
    });
  }

  /** Explicitly start AI handling for a conversation (state foundation only). */
  async startAiQueue(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const conv = await this.repo.lockConversation(tx, p.orgId, id);
      if (!conv) throw new NotFoundError('waConversation', id);
      this.branch(p, conv.branchId);
      if (conv.aiQueueState) return conv;
      if (conv.status === 'archived') throw new ConflictError('Archived conversations are terminal');
      const updated = await this.repo.updateConversation(tx, p.orgId, id, { aiQueueState: 'received' });
      if (!updated) throw new NotFoundError('waConversation', id);
      await this.audit.record(this.auditEvent(p, 'wa_ai_queue_started', 'wa_conversations', id, conv.branchId), tx);
      return updated;
    });
  }

  /* ==========================================================================
     TEMPLATES (quick-reply content records only — no automated sending)
     ==========================================================================*/
  async createTemplate(p: Principal, raw: unknown) {
    const input = this.parse(templateInput, raw);
    /* Fail-fast at service layer before touching RLS-protected tables:
     * doctor is denied whatsapp entirely (D1); branch roles own-branch only. */
    if (p.role === 'doctor') throw new ForbiddenError('Doctor has no WhatsApp access (governance D1)');
    const branchId = this.branch(p, input.branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createTemplate(tx, {
        orgId: p.orgId, branchId, name: input.name, body: input.body, category: input.category ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'wa_template_created', 'wa_templates', row.id, branchId), tx);
      return row;
    });
  }

  async listTemplates(p: Principal, branchId?: string, rawPage?: unknown) {
    const pg = this.pageOf(rawPage);
    return this.dbCtx.runAs(p, (tx) => this.repo.listTemplates(tx, p.orgId, this.scoped(p, branchId), pg.limit, pg.offset));
  }

  async updateTemplate(p: Principal, id: string, raw: unknown) {
    const input = this.parse(templatePatchInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findTemplate(tx, p.orgId, id);
      if (!before) throw new NotFoundError('waTemplate', id);
      this.branch(p, before.branchId);
      const set: Record<string, unknown> = {};
      if (input.name !== undefined) set.name = input.name;
      if (input.body !== undefined) set.body = input.body;
      if (input.category !== undefined) set.category = input.category;
      if (input.active !== undefined) set.active = input.active;
      const updated = await this.repo.updateTemplate(tx, p.orgId, id, set);
      if (!updated) throw new NotFoundError('waTemplate', id);
      await this.audit.record(this.auditEvent(p, 'wa_template_updated', 'wa_templates', id, before.branchId, before as unknown as Record<string, unknown>, set), tx);
      return updated;
    });
  }

  /** N6-3: clear a channel-local pause under the same row lock used by sends. */
  async resumeAutoPause(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const channel = await this.repo.lockChannel(tx, p.orgId, id);
      if (!channel) throw new NotFoundError('waChannel', id);
      this.branch(p, channel.branchId);
      if (p.role !== 'hq' && p.role !== 'branch_manager') throw new ForbiddenError('Only HQ or branch manager can resume safety pause');
      const at = this.nowFn();
      const updated = await this.repo.updateChannel(tx, p.orgId, id, { autoPausedAt: null, autoPauseResumedAt: at });
      await this.audit.record(this.auditEvent(p, 'wa_channel_auto_pause_resumed', 'wa_channels', id, channel.branchId, { autoPausedAt: channel.autoPausedAt }, { autoPauseResumedAt: at }), tx);
      return updated;
    });
  }

  /* ============================================================================
     SAFETY DECISIONS + DEVICE HEALTH (read surfaces)
     ==========================================================================*/
  async listSafetyDecisions(p: Principal, branchId?: string, rawPage?: unknown) {
    const pg = this.pageOf(rawPage);
    return this.dbCtx.runAs(p, (tx) => this.repo.listSafetyDecisions(tx, p.orgId, this.scoped(p, branchId), pg.limit, pg.offset));
  }

  /** Deterministic device-health snapshot (score + band; no background worker). */
  async getChannelHealth(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const channel = await this.repo.findChannel(tx, p.orgId, id);
      if (!channel) throw new NotFoundError('waChannel', id);
      this.branch(p, channel.branchId);
      return { id: channel.id, branchId: channel.branchId, healthScore: channel.healthScore, band: waHealthBand(channel.healthScore), status: channel.status, lastSeenAt: channel.lastSeenAt };
    });
  }

  /** HQ-controlled health-score update (deterministic input; recalc worker = S8). */
  async updateChannelHealth(p: Principal, id: string, raw: unknown) {
    if (p.role !== 'hq') throw new ForbiddenError('Device health administration is HQ-controlled');
    const input = this.parse(z.object({ healthScore: z.number().int().min(0).max(100) }), raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.lockChannel(tx, p.orgId, id);
      if (!before) throw new NotFoundError('waChannel', id);
      const updated = await this.repo.updateChannel(tx, p.orgId, id, { healthScore: input.healthScore });
      if (!updated) throw new NotFoundError('waChannel', id);
      await this.audit.record(this.auditEvent(p, 'wa_channel_health_updated', 'wa_channels', id, before.branchId, { healthScore: before.healthScore }, { healthScore: input.healthScore }), tx);
      return { id, healthScore: input.healthScore, band: waHealthBand(input.healthScore) };
    });
  }
}
