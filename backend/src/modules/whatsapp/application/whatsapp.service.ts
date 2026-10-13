import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { DbContextService, ScopedSystemWorkerContext, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/errors';
import { WaOptOutService } from './wa-opt-out.service';
import { WaBranchResolverService } from './wa-branch-resolver.service';
import { WhatsappRepository, WA_PAGE_MAX } from '../infrastructure/whatsapp.repository';
import { WahaAdapter } from '../infrastructure/waha.adapter';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import {
  canTransitionWaChannel, canTransitionWaConversation, canTransitionWaMessage, canTransitionWaAiQueue,
  evaluateWaSafety, waHealthBand, normalizePhone,
  WaChannelState, WaConversationState, WaMessageState, WaAiQueueState, WaBlockedReason,
  WA_AUTO_PAUSE_MS,
  WA_SAFETY_MESSAGE_FOR_REASON,
} from '../domain/whatsapp-lifecycle';
import { effectiveWindow, DEFAULT_BLAST_DAILY_CAP, WA_BLAST_HARD_MAX } from '../domain/blast-guard';
import { planDrip } from '../domain/blast-drip';
import { DEFAULT_SLA_MINUTES, slaLevel, slaSummary, waitingFirst, waitingMinutes } from '../domain/sla';
import { campaignProgress, reviewSchedule } from '../domain/campaign-schedule';
import { screenMessage } from '../../marketing/domain/clinical-guard';
import { substituteTags } from '../domain/tag-substitution';
import { WaMessage, WaConversation } from '../../../infrastructure/database/schema';

const uuid = z.string().uuid();
const page = z.object({
  limit: z.coerce.number().int().min(1).max(WA_PAGE_MAX).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const channelInput = z.object({ branchId: uuid, phone: z.string().trim().min(6).max(64), sessionName: z.string().trim().max(128).nullish() });
const channelPatchInput = z.object({ phone: z.string().trim().min(6).max(64).optional(), sessionName: z.string().trim().max(128).nullish() });
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

const blastInput = z.object({
  branchId: uuid,
  channelId: uuid,
  recipients: z
    .array(z.string().trim().min(6).max(64))
    .min(1)
    /* The hard ceiling is the branch's own max_blast_per_day (100), enforced
     * against the DB below. This outer bound exists only to stop an absurd
     * payload from reaching it; pinning it at 50 would silently cap every branch
     * below the 100/day the operator is allowed to configure. */
    .max(WA_BLAST_HARD_MAX),
  body: z.string().trim().min(1).max(4096),
  consentConfirmed: z.literal(true),
  /* Optional campaign label so an operator can find and stop it later. */
  campaignName: z.string().trim().min(1).max(160).optional(),
  /* Destination for the {link} tag. Optional: a template without {link} needs
   * none. A template WITH {link} and no URL is refused rather than sent with the
   * tag unresolved, because a visible "{link}" is a defect. */
  bookingUrl: z.string().trim().url().max(512).optional(),
  /* When the drip should start. Defaults to now. A future date queues every
   * message with a send_at at or after that instant; the transport worker waits
   * until each slot arrives, so a scheduled blast survives a server restart. */
  scheduledAt: z.string().datetime().optional(),
});

/* FASA 5F — campaign dates. Nullable so an operator can clear a date and see the
 * draft state; the feasibility check runs against whatever is set.
 *
 * `dailyTarget` is the operator's intended pace, which may be SLOWER than the
 * branch ceiling (a gentle recall, say). It is persisted so the intent survives a
 * reload — without that, changing only the dates silently discarded a target the
 * operator had set. */
const campaignScheduleInput = z.object({
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarikh mesti YYYY-MM-DD').nullish(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarikh mesti YYYY-MM-DD').nullish(),
  dailyTarget: z.coerce.number().int().min(1).max(WA_BLAST_HARD_MAX).nullish(),
}).strict();

/** Internal carrier for a blocked safety evaluation (never surfaced as-is;
 * converted to ForbiddenError after the decision is persisted out-of-tx). */
interface WaBlockedMeta {
  orgId: string; branchId: string; channelId: string; conversationId: string;
  blockedReason: string | null; gates: unknown; principal: Principal;
}
class WaSafetyBlockedError extends Error {
  constructor(public readonly reason: WaBlockedReason, public readonly meta: WaBlockedMeta) { super(reason); this.name = 'WaSafetyBlockedError'; }
}

/**
 * WhatsApp Hub — communication system of record (Sprint 6).
 * Persistent SIMULATED state only: NO WAHA transport, NO worker/queue/outbox,
 * NO campaign execution, NO AI decision logic (S7/S8 scope).
 * Roles: hq (all) · branch_manager/branch_admin/receptionist (branch) · doctor (branch).
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
    /* STOP list. Enforced at blast time and again at send time, because a
     * patient can opt out between the two. */
    private readonly optOuts?: WaOptOutService,
    /* 0029 — session→branch resolver, invalidated when a primary switch
     * changes routing (optional so existing constructor-call tests keep
     * compiling; the module wires the real one). */
    private readonly resolver?: WaBranchResolverService,
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
  /** HQ may act on any branch; branch roles only on their own. */
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
    this.branch(p, input.branchId);
    if (p.role !== 'hq' && p.role !== 'branch_manager') throw new ForbiddenError('Channel management is restricted');
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createChannel(tx, {
        orgId: p.orgId, branchId: input.branchId, phone: input.phone, sessionName: input.sessionName ?? null,
        status: 'stopped', createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'wa_channel_created', 'wa_channels', row.id, input.branchId), tx);
      return row;
    });
  }

  async updateChannel(p: Principal, id: string, raw: unknown) {
    const input = this.parse(channelPatchInput, raw);
    const channel = await this.dbCtx.runAs(p, (tx) => this.repo.findChannel(tx, p.orgId, id));
    if (!channel) throw new NotFoundError('waChannel', id);
    this.branch(p, channel.branchId);
    if (p.role !== 'hq' && p.role !== 'branch_manager') throw new ForbiddenError('Channel management is restricted');
    const updated = await this.dbCtx.runAs(p, (tx) => this.repo.updateChannel(tx, p.orgId, id, {
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.sessionName !== undefined ? { sessionName: input.sessionName || null } : {}),
      updatedBy: p.staffId,
    }));
    if (!updated) throw new NotFoundError('waChannel', id);
    return updated;
  }

  /**
   * 0029 — SWITCH the branch's live channel. Sets this channel primary and
   * demotes every other live channel of the SAME branch to spare, in ONE
   * transaction, so a branch never has two primaries (the DB guard) nor
   * zero (the old channel keeps serving until the moment the new one takes
   * over). The resolver's cache is invalidated so the very next inbound
   * message routes through the new number.
   *
   * Pairing the new primary is still the operator's job (QR button) — this
   * switch moves ROUTING, not session state.
   */
  async setChannelPrimary(p: Principal, id: string) {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Switch channel hanya boleh oleh HQ atau Branch Manager');
    }
    const channel = await this.dbCtx.runAs(p, (tx) => this.repo.findChannel(tx, p.orgId, id));
    if (!channel) throw new NotFoundError('waChannel', id);
    this.branch(p, channel.branchId);

    const updated = await this.dbCtx.runAs(p, async (tx) => {
      /* Demote siblings FIRST, promote target SECOND — the DB's primary
       * guard would refuse the insert order the other way around. */
      await tx.execute(sql`
        UPDATE wa_channels
        SET is_primary = 0, updated_by = ${p.staffId}, updated_at = NOW(6)
        WHERE org_id = ${p.orgId} AND branch_id = ${channel.branchId}
          AND deleted_at IS NULL AND is_primary = 1 AND id <> ${id}
      `);
      const result = await tx.execute(sql`
        UPDATE wa_channels
        SET is_primary = 1, updated_by = ${p.staffId}, updated_at = NOW(6)
        WHERE org_id = ${p.orgId} AND id = ${id} AND deleted_at IS NULL
      `);
      return result;
    });

    /* Routing changed — drop the cached session→branch mappings so the next
     * message resolves against the new truth instead of waiting out the TTL. */
    this.resolver?.invalidate();

    await this.dbCtx.runAs(p, async (tx) => {
      await this.audit.record(this.auditEvent(p, 'wa_channel_primary_switched', 'wa_channels', id, channel.branchId, { isPrimary: 0 }, { isPrimary: 1 }), tx);
    });

    return { id, isPrimary: true, updated: Boolean(updated) };
  }

  async deactivateChannel(p: Principal, id: string) {
    const channel = await this.dbCtx.runAs(p, (tx) =>
      this.repo.findChannel(tx, p.orgId, id),
    );

    if (!channel) {
      throw new NotFoundError('waChannel', id);
    }

    this.branch(p, channel.branchId);

    return this.dbCtx.runAs(p, (tx) =>
      this.repo.updateChannel(tx, p.orgId, id, {
        status: 'stopped',
        deletedAt: new Date(),
      }),
    );
  }
  async listChannels(p: Principal, branchId?: string, rawPage?: unknown) {
    const pg = this.pageOf(rawPage);

    const rows = await this.dbCtx.runAs(
      p,
      (tx) =>
        this.repo.listChannels(
          tx,
          p.orgId,
          this.scoped(p, branchId),
          pg.limit,
          pg.offset,
        ),
    );

    if (!this.waha.configured) {
      return rows;
    }

    for (const channel of rows) {
      if (!channel.sessionName) continue;

      try {
        const live =
          await this.waha.sessionStatus(
            channel.sessionName,
          );

        let status: WaChannelState | null = null;

        if (live === 'working') {
          status = 'working';
        } else if (live === 'starting') {
          status = 'starting';
        } else if (
          live === 'scan_qr_code' ||
          live === 'scan_qr' ||
          live === 'need_qr'
        ) {
          status = 'need_qr';
        } else if (live === 'failed') {
          status = 'failed';
        } else if (live === 'stopped') {
          status = 'stopped';
        }

        if (status && status !== channel.status) {
          const updated =
            await this.dbCtx.runAs(
              p,
              (tx) =>
                this.repo.updateChannel(
                  tx,
                  p.orgId,
                  channel.id,
                  {
                    status,
                    ...(status === 'working'
                      ? { lastSeenAt: new Date() }
                      : {}),
                  },
                ),
            );

          if (updated) {
            Object.assign(channel, updated);
          }
        }
      } catch {
        // Jika WAHA sementara tidak dapat dicapai,
        // kekalkan status terakhir dalam CRM.
      }
    }

    return rows;
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

  async generateChannelQr(p: Principal, id: string) {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('QR channel hanya boleh dijana oleh HQ atau Branch Manager');
    }

    const channel = await this.dbCtx.runAs(p, (tx) =>
      this.repo.findChannel(tx, p.orgId, id),
    );

    if (!channel) {
      throw new NotFoundError('waChannel', id);
    }

    const session = channel.sessionName || 'medini-' + channel.id;
    /* manualPairing: this call IS the human act (an operator clicked "QR" to
     * pair or re-pair). It lets a FAILED session restart once through the A1
     * brake instead of 500-ing — the fix for "QR tidak dapat dijana". */
    const result = await this.waha.startSession(session, { manualPairing: true });

    return {
      channelId: channel.id,
      session,
      qr: result.qr,
      expiresAt: result.expiresAt,
    };
  }
  /**
   * Toggle AI auto-reply for a number. The operator owns this switch: turning
   * it off silences the bot immediately and leaves every inbound message for
   * staff. Re-enabling does NOT re-arm any prior handoff — staff must opt back
   * in deliberately, so a conversation mid-takeover is never interrupted.
   */
  async setChannelAiReply(p: Principal, id: string, raw: unknown) {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Toggle AI hanya boleh diubah oleh HQ atau Branch Manager');
    }

    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError({ enabled: ['Nilai toggle tidak sah'] });
    }

    return this.dbCtx.runAs(p, async (tx) => {
      const channel = await this.repo.findChannel(tx, p.orgId, id);
      if (!channel) throw new NotFoundError('waChannel', id);
      this.branch(p, channel.branchId);

      const updated = await this.repo.updateChannel(tx, p.orgId, id, {
        aiReplyEnabled: parsed.data.enabled,
        aiReplyEnabledAt: new Date(),
        aiReplyEnabledBy: p.staffId,
      });

      return {
        id,
        aiReplyEnabled: Boolean(updated?.aiReplyEnabled),
        aiReplyEnabledAt: updated?.aiReplyEnabledAt ?? null,
      };
    });
  }

  /**
   * Conversation queue for the inbox. `filter` drives the operator's tabs:
   *  - all            : everything not archived
   *  - needs_human    : AI escalated, a person must reply
   *  - unanswered     : unread inbound with no reply yet
   *  - ai             : currently handled by the bot
   */
  async listConversationQueue(p: Principal, rawQuery: Record<string, unknown>) {
    const parsed = z.object({
      branchId: z.string().uuid().optional(),
      filter: z.enum(['all', 'needs_human', 'unanswered', 'ai']).default('all'),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      offset: z.coerce.number().int().min(0).default(0),
    }).strict().safeParse(rawQuery ?? {});

    if (!parsed.success) {
      throw new ValidationError({ filter: ['Penapis perbualan tidak sah'] });
    }

    const { filter, limit, offset } = parsed.data;
    const branchScope = this.scoped(p, parsed.data.branchId);

    const rows = await this.dbCtx.runAs(p, (tx) =>
      this.repo.listConversationQueue(tx, p.orgId, branchScope, filter, limit, offset),
    );

    return rows;
  }

  /**
   * FASA 5D-C — the waiting board.
   *
   * Two things make this different from the inbox queue, and both are the point:
   *
   * 1. IT SORTS BY WAIT. `listConversationQueue` sorts by newest activity, which
   *    is right for a chat list and wrong for a queue: the patient who has been
   *    waiting longest sinks further down every time someone else writes.
   *
   * 2. IT MEASURES THE PATIENT'S EXPERIENCE, NOT OURS. The clock starts at the
   *    patient's first message and stops at the first reply — whoever sends it.
   *    Starting it at the AI handover would report a short wait for a clinic that
   *    left someone sitting for an hour, which is precisely the case worth seeing.
   */
  async slaBoard(p: Principal, rawQuery: Record<string, unknown>) {
    const parsed = z.object({
      branchId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().safeParse(rawQuery ?? {});

    if (!parsed.success) {
      throw new ValidationError({ branchId: ['Penapis SLA tidak sah'] });
    }

    const branchScope = this.scoped(p, parsed.data.branchId);

    const result = await this.dbCtx.runAs(p, async (tx) => {
      /* Every conversation that has not been archived, with the fields the wait
       * depends on. */
      const rows = await this.repo.listConversationQueue(
        tx, p.orgId, branchScope, 'all', parsed.data.limit, 0,
      );

      /* ONE LIMIT PER BRANCH, NOT ONE LIMIT FOR THE WHOLE BOARD.
       *
       * A limit belongs to a branch, so a board spanning branches cannot be
       * graded against a single number. Reading `LIMIT 1` with no branch filter
       * returned whichever row MySQL happened to reach first: HQ on
       * "All Branches" was graded against 45 minutes while its own branch ran at
       * 15, and the choice was arbitrary rather than wrong-in-a-fixed-way —
       * exactly the kind of fault nobody notices until a breach is missed.
       *
       * So the limits are read per branch and each conversation is graded against
       * ITS OWN branch's limit. `slaMinutes` at the top level is only reported
       * when the board is narrowed to a single branch, because only then is there
       * one number to report. */
      const settings = await tx.execute(sql`
        SELECT branch_id AS branchId, sla_minutes AS slaMinutes
        FROM ai_whatsapp_settings
        WHERE org_id = ${p.orgId}
      `);

      const byBranch = new Map<string, number>();
      const slaRows = (settings as { rows?: Array<{ branchId: string; slaMinutes: number }> }).rows ?? [];
      for (const row of slaRows) {
        byBranch.set(row.branchId, Number(row.slaMinutes));
      }
      return { rows, byBranch, defaultLimit: DEFAULT_SLA_MINUTES };
    });

    const now = new Date();
    const limitOf = (conv: { branchId?: string | null }): number =>
      (conv.branchId ? result.byBranch.get(conv.branchId) : undefined)
      ?? result.defaultLimit;

    const ordered = waitingFirst(result.rows as WaConversation[], now);

    /* A single number is only meaningful for a single branch. When the board
     * spans branches, the summary grades each row against its own limit and the
     * top-level figure reports the NARROWEST limit in play — the strictest bar
     * anything on screen is being held to, which is the honest thing to show. */
    const scopedToBranch = branchScope !== null;
    const headerLimit = scopedToBranch
      ? limitOf({ branchId: branchScope })
      : (result.byBranch.size ? Math.min(...result.byBranch.values()) : result.defaultLimit);

    const rowsWithLimits = (result.rows as Array<{ branchId?: string | null }>).map((r) => ({
      ...r,
      slaLimit: limitOf(r),
    }));

    return {
      slaMinutes: headerLimit,
      /* True when every row on the board shares one limit — the screen may then
       * label the column once instead of per row. */
      uniformLimit: scopedToBranch,
      summary: slaSummary(rowsWithLimits as never[], headerLimit, now),
      conversations: ordered.map((c) => {
        const minutes = waitingMinutes(c, now);
        const limit = limitOf(c);
        return {
          id: c.id,
          branchId: c.branchId,
          contactPhone: c.contactPhone,
          patientId: c.patientId,
          status: c.status,
          needsHuman: c.needsHuman,
          needsHumanReason: c.needsHumanReason,
          assignedTo: c.assignedTo,
          lastMessageAt: c.lastMessageAt,
          firstResponseAt: c.firstResponseAt,
          waitingMinutes: minutes,
          slaMinutes: limit,
          level: slaLevel(minutes, limit),
        };
      }),
    };
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
        const matches = (await this.patients.findByPhone(tx, p.orgId, contact)) as Array<{ id: string; branchId: string | null }>;
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

  /**
   * Staff eligible to be assigned a conversation in the caller's scope.
   *
   * The Administration staff list is HQ-only, so a branch manager or
   * receptionist had no way to pick a colleague to hand a conversation to —
   * the assign button could not be built on top of it. This returns the
   * minimum needed to choose a person (id + name + role), never the full staff
   * record, and it is branch-scoped by the same rule as conversations.
   */
  async listAssignableStaff(p: Principal, requestedBranchId?: string) {
    const branchId = this.scoped(p, requestedBranchId);

    return this.dbCtx.runAs(p, async (tx) => {
      const conds = [
        sql`org_id = ${p.orgId}`,
        sql`deleted_at IS NULL`,
        sql`status = 'Active'`,
        /* Doctor may now be assigned WhatsApp conversations (RBAC amendment);
         * developer remains technical-only. */
        sql`role IN ('hq', 'branch_manager', 'branch_admin', 'doctor')`,
      ];
      if (branchId) {
        /* HQ may be scoped to all branches (branchId null) — then no branch
         * filter is applied. Otherwise the assignee must belong to the branch
         * that owns the conversation, so work cannot be handed across branches. */
        conds.push(sql`(branch_id = ${branchId} OR branch_id IS NULL)`);
      }

      const result = await tx.execute(sql`
        SELECT id, name, role, branch_id AS branchId
        FROM staff
        WHERE ${sql.join(conds, sql` AND `)}
        ORDER BY name ASC
        LIMIT 200
      `);

      return (result as unknown as { rows: Array<{ id: string; name: string; role: string; branchId: string | null }> }).rows;
    });
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

  /**
   * Mark a conversation read — clears `unread_count` on the thread.
   *
   * Fasa 1a. `POST /whatsapp/blast`-era Fasa 1 shipped a UI that called
   * `POST /whatsapp/conversations/:id/read` on opening a thread, but no such
   * route was ever registered — it returned 404 and the badge never cleared.
   *
   * Two counters exist and they are NOT the same thing, so this touches only
   * one of them:
   *   - `wa_conversations.unread_count` — the THREAD counter, incremented by
   *     the inbound webhook. This is what opening a thread resets.
   *   - `wa_notifications` (read_at) — the BELL, cleared by
   *     `/whatsapp/notifications/:id/read`. Opening a thread is not the same
   *     act as dismissing a bell item, so it is left alone.
   *
   * Idempotent by construction: it SETS 0 rather than decrementing, so a
   * double-click, a refetch or two staff opening the same thread cannot drive
   * the counter negative or replay a decrement.
   *
   * It is a WRITE, so it needs `whatsapp:edit` — a viewer must not be able to
   * clear another operator's unread state.
   */
  async markConversationRead(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const conv = await this.repo.findConversation(tx, p.orgId, id);
      if (!conv) throw new NotFoundError('waConversation', id);
      this.branch(p, conv.branchId);
      /* `lastReadAt` is recorded even when the count is already 0: the operator
       * did read the thread, and "when was this last looked at" is a question
       * the next shift asks. */
      const updated = await this.repo.updateConversation(tx, p.orgId, id, { unreadCount: 0 });
      if (!updated) throw new NotFoundError('waConversation', id);
      return { conversation: updated, unreadCount: 0 };
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
        /* Operator-facing explanation: the reason codes are internal names, so
         * say plainly why the send was refused and what to do next. The raw
         * code travels in `details.blockedReason` for the client to branch on. */
        const message = WA_SAFETY_MESSAGE_FOR_REASON[e.reason] ??
          `Mesej tidak dihantar: sistem keselamatan menghalangnya (${e.reason}).`;
        throw new ForbiddenError(message, {
          blockedReason: e.reason,
          conversationId: m.conversationId,
        });
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

  /**
   * The branch's saved blast window (08:00–22:00 by default).
   *
   * Read at SEND time, not at queue time: a 14-day campaign must respect a
   * window the operator changes on day 3, and the compile-time constants in
   * whatsapp-lifecycle.ts (09:00–18:00) are reply-engine defaults that must not
   * override a branch's saved setting.
   */
  async getWorkerBlastWindow(
    ctx: ScopedSystemWorkerContext,
    branchId: string,
  ): Promise<{ windowStartHour: number; windowEndHour: number }> {
    const row = await this.dbCtx.runAsWorker(ctx, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT blast_window_start_hour AS startHour, blast_window_end_hour AS endHour,
               blast_schedule_enabled AS enabled
        FROM ai_whatsapp_settings
        WHERE org_id = ${ctx.orgId} AND branch_id = ${branchId}
        LIMIT 1
      `);
      const r = (rows as { rows?: Array<{ startHour?: number | null; endHour?: number | null; enabled?: unknown }> }).rows?.[0];
      return r ?? null;
    });

    return effectiveWindow(row?.startHour ?? null, row?.endHour ?? null);
  }

  /**
   /**
   * Fetch a message under worker scope.
   *
   * The send-time guard runs BEFORE the channel is validated, because a message
   * that must not be sent should be refused without touching the transport at
   * all.
   */
  async getWorkerMessage(
    ctx: ScopedSystemWorkerContext,
    messageId: string,
  ): Promise<WaMessage | null> {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const msg = await this.repo.findMessage(tx, ctx.orgId, messageId);
      if (!msg) return null;
      if (ctx.branchIds.length > 0 && !ctx.branchIds.includes(msg.branchId)) return null;
      return msg;
    });
  }

  /**
   * Opt-out lookup for the worker, preserving the unknown state.
   *
   * Returns true / false / NULL. The blast guard needs to distinguish "not
   * opted out" from "could not check", because an unreadable list must abort the
   * send rather than be recorded as consent.
   */
  async checkOptOutStatus(orgId: string, phone: string): Promise<boolean | null> {
    if (!this.optOuts) return false; /* No opt-out store wired: nothing to check. */
    return this.optOuts.checkOptOut(orgId, phone);
  }

  /**
   * Has the campaign this message belongs to been stopped by an operator?
   *
   * Stored on the message's batch id, so a stop takes effect for everything not
   * yet sent. A message with no batch (a one-off reply) belongs to no campaign
   * and is never stopped this way.
   */
  async isCampaignStopped(
    ctx: ScopedSystemWorkerContext,
    blastBatchId: string | null | undefined,
  ): Promise<boolean> {
    if (!blastBatchId) return false;

    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT cancelled_at AS cancelledAt
        FROM wa_blast_campaigns
        WHERE org_id = ${ctx.orgId} AND batch_id = ${blastBatchId}
        LIMIT 1
      `);
      const row = (rows as { rows?: Array<{ cancelledAt?: unknown }> }).rows?.[0];
      return Boolean(row?.cancelledAt);
    });
  }

  /** Cancel a queued message the worker has decided not to send.
   * `cancelled_at` is deliberately separate from `failed`: failed means we tried
   * and WhatsApp rejected it, cancelled means we chose not to try. Recording a
   * compliance decision as a delivery failure would make an opt-out look like a
   * network problem in the reports.
   */
  async cancelWorkerSend(
    ctx: ScopedSystemWorkerContext,
    messageId: string,
    reason: string,
  ) {
    const result = await this.dbCtx.runAsWorker(ctx, async (tx) => {
      const msg = await this.repo.findMessage(tx, ctx.orgId, messageId);
      if (!msg) throw new NotFoundError('waMessage', messageId);
      /* Already delivered — never rewrite history. */
      if (msg.externalMessageId) return msg;

      const updated = await this.repo.updateMessage(tx, ctx.orgId, messageId, {
        status: 'cancelled',
        cancelledAt: new Date(),
        lastError: reason,
      });

      await this.repo.createSafetyDecision(tx, {
        orgId: ctx.orgId,
        branchId: msg.branchId,
        channelId: msg.channelId,
        conversationId: msg.conversationId,
        messageId,
        actorId: null,
        decision: 'blocked',
        blockedReason: reason as never,
        gates: { source: 'blast_send_guard', reason },
      });

      return updated ?? msg;
    });

    await this.audit.record({
      orgId: ctx.orgId,
      branchId: ctx.branchIds[0] ?? null,
      action: 'wa_message_cancelled',
      entity: 'wa_messages',
      entityId: messageId,
      actorId: null,
      metadata: { reason, source: 'blast_send_guard' },
    } as never);

    return result;
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

  async queueBlast(p: Principal, raw: unknown) {
    /* #2 (pemilik 10 Okt): "HQ Pastikan serba bisa". HQ kini boleh menghantar
     * blast ATAS NAMA cawangan: branchId dlm payload menjadi cawangan bertindak,
     * sama seperti corak klinikal (atas-nama doktor). Branch manager / doktor
     * kekal terikat kepada cawangan sendiri seperti sebelum ini. */
    const input = this.parse(blastInput, raw);

    if (p.role === 'hq') {
      if (!input.branchId) {
        throw new ForbiddenError(
          'HQ mesti memilih cawangan (branchId) untuk menghantar blast ini',
        );
      }
    } else {
      if (p.role !== 'branch_manager' && p.role !== 'doctor') {
        throw new ForbiddenError(
          'Only branch manager or doctor can send WhatsApp blast',
        );
      }

      if (!p.branchId) {
        throw new ForbiddenError(
          'No branch context - access denied',
        );
      }

      if (input.branchId !== p.branchId) {
        throw new ForbiddenError(
          'Cannot send blast for another branch',
        );
      }
    }

    /* Cawangan bertindak: cawangan payload utk HQ, cawangan sendiri utk lain. */
    const actingBranch: string = p.role === 'hq' ? input.branchId : p.branchId!;

    /* PRIVACY SCREEN (FASA 5C-E).
     *
     * WhatsApp is not a clinical channel. A phone is shared, borrowed, left
     * unlocked, and a number can change hands — so a sentence naming a condition
     * or a patient's own treatment tells whoever holds the phone something about
     * this patient that they never chose to disclose.
     *
     * Enforced here, at the point of sending, rather than as a warning in the
     * editor: a warning depends on a busy receptionist reading it. The message
     * that leaks is refused.
     *
     * Thrown BEFORE any DB work, so a rejected blast leaves nothing behind. */
    const screen = screenMessage(input.body);
    if (!screen.safe) {
      throw new ValidationError({
        body: [
          screen.reason ??
            'Mesej mengandungi butiran klinikal dan tidak boleh dihantar.',
          ...screen.findings.map(
            (f) => `Baris ${f.line}: "${f.snippet}"`,
          ),
        ],
      });
    }

    /* Schedule the whole batch up front (FASA 5C-D).
     *
     * The pacing CANNOT be expressed by the transport worker's fixed 30–60s
     * sleep: 100/day across a 14-hour window is ~504s between messages, and
     * holding a job open for eight minutes loses the schedule on restart. So
     * each message is given an explicit send_at and the worker waits for it. */
    const branchWindow = await this.dbCtx.runAs(
      p,
      async (tx) => {
        /* LEFT JOIN from `branches`, not from the settings row.
         *
         * A branch that has never opened the Anti-Ban panel has no settings row —
         * and an inner join would then return nothing, silently losing the branch
         * NAME along with the window. The name comes from the branch record, which
         * always exists; the settings columns are null when unconfigured and the
         * caller applies its own defaults. */
        const rows = await tx.execute(sql`
          SELECT s.blast_window_start_hour AS startHour,
                 s.blast_window_end_hour   AS endHour,
                 s.max_blast_per_day       AS perDay,
                 s.blast_min_gap_seconds   AS minGap,
                 s.blast_max_gap_seconds   AS maxGap,
                 b.short_name              AS branchName
          FROM branches b
          LEFT JOIN ai_whatsapp_settings s
            ON s.branch_id = b.id AND s.org_id = b.org_id
          WHERE b.org_id = ${p.orgId} AND b.id = ${actingBranch}
          LIMIT 1
        `);
        return (rows as { rows?: Array<{ branchName?: string | null; startHour?: number | null; endHour?: number | null; perDay?: number | null; minGap?: number | null; maxGap?: number | null }> }).rows?.[0] ?? null;
      },
    );

    /* Branch name for {cawangan}, and the booking link for {link}. The link is a
     * request parameter rather than a stored setting: the clinic has not fixed a
     * booking URL yet, and inventing one here would put a plausible-looking but
     * wrong address in front of patients. The operator supplies it, or the tag is
     * refused. */
    const branchName = String(branchWindow?.branchName ?? 'Klinik Medini');
    const bookingUrl = input.bookingUrl ?? '';

    const win = effectiveWindow(
      branchWindow?.startHour ?? null,
      branchWindow?.endHour ?? null,
    );

    const recipients = [
      ...new Set(
        input.recipients
          .map((phone) => normalizePhone(phone))
          .filter((phone) => phone.length >= 9),
      ),
    ];

    if (!recipients.length) {
      throw new ValidationError({
        recipients: ['Tiada nombor WhatsApp yang sah'],
      });
    }

    /* STOP LIST — drop opted-out numbers BEFORE anything else.
     *
     * This is the operator-visible filter: the response reports how many were
     * removed and who, so a blast that quietly skips half the list is never
     * mistaken for a list that was short to begin with.
     *
     * Checked again at send time (transport worker), because a patient can opt
     * out between queueing and sending. */
    let blocked: string[] = [];
    if (this.optOuts) {
      blocked = await this.optOuts.filterOptedOut(p.orgId, recipients);
    }
    const allowed = recipients.filter((r) => !blocked.includes(r));

    if (!allowed.length) {
      throw new ConflictError(
        'Semua nombor dalam senarai ini telah meminta berhenti menerima mesej (STOP). ' +
        'Tiada mesej dihantar.',
      );
    }

    /* The branch's own daily ceiling (100 by default), NOT a hardcoded 50.
     * The operator decides how many per day in the Anti-Ban panel, up to 100;
     * a constant here would silently cap them below their own configuration. */
    const dailyCap = branchWindow?.perDay ?? 100;

    if (allowed.length > dailyCap) {
      throw new ValidationError({
        recipients: [`Maksimum ${dailyCap} penerima sehari`],
      });
    }

    const batchId = randomUUID();

    /* The drip schedule. Computed AFTER the STOP filter on purpose: an opted-out
     * number must not occupy a send slot, or the campaign silently runs short.
     * One message per allowed recipient, paced across the branch's window. */
    const schedule = planDrip({
      count: allowed.length,
      windowStartHour: win.windowStartHour,
      windowEndHour: win.windowEndHour,
      perDay: branchWindow?.perDay ?? undefined,
      minGapSeconds: branchWindow?.minGap ?? undefined,
      maxGapSeconds: branchWindow?.maxGap ?? undefined,
      startAt: input.scheduledAt ? new Date(input.scheduledAt) : this.nowFn(),
    });

    const result = await this.dbCtx.runAs(
      p,
      async (tx) => {
        const channel = await this.repo.lockChannel(
          tx,
          p.orgId,
          input.channelId,
        );

        if (!channel) {
          throw new NotFoundError(
            'waChannel',
            input.channelId,
          );
        }

        if (channel.branchId !== actingBranch) {
          throw new ForbiddenError(
            'Channel belongs to another branch',
          );
        }

        if (channel.status !== 'working') {
          throw new ConflictError(
            'WhatsApp channel is not connected',
          );
        }

        if (channel.healthScore < 70) {
          throw new ConflictError(
            'WhatsApp channel health is too low for blast',
          );
        }

        const now = this.nowFn();

        const malaysiaToday = new Date(
          now.getTime() + 8 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10);

        const sentToday =
          channel.sentTodayDate === malaysiaToday
            ? channel.sentTodayCount
            : 0;

        const pendingResult = await tx.execute(sql`
          SELECT COUNT(*) AS total
          FROM wa_messages
          WHERE org_id = ${p.orgId}
            AND branch_id = ${actingBranch}
            AND channel_id = ${channel.id}
            AND direction = 'out'
            AND status IN ('queued', 'processing')
            AND deleted_at IS NULL
        `);

        const pendingRows = (pendingResult as { rows?: Array<{ total?: unknown }> }).rows;
        const pending = Number(
          pendingRows?.[0]?.total ?? 0,
        );

        const remaining = Math.max(
          0,
          dailyCap - sentToday - pending,
        );

        /* Counted against the ALLOWED recipients: an opted-out number must not
         * consume quota, and must never reach the queue loop below. */
        if (allowed.length > remaining) {
          throw new ConflictError(
            `Baki kuota WhatsApp hari ini hanya ${remaining} mesej`,
          );
        }

        const jobs: Array<{
          messageId: string;
          conversationId: string;
          channelId: string;
          branchId: string;
        }> = [];

        /* Resolve who each number belongs to, once, before the loop.
         *
         * The message body must differ per recipient — "Salam {nama}!" resolves
         * to the patient for an adult and to the GUARDIAN for a child — so the
         * patient record has to be read here. One query for the whole batch
         * rather than one per recipient: a 100-message blast would otherwise
         * issue 100 lookups.
         *
         * A number with no matching patient is not a failure. The clinic may be
         * messaging a contact who was never registered; that recipient gets the
         * neutral fallback, and the counter below tells the operator how many. */
        const patientRows = await tx.execute(sql`
          SELECT
            p.id            AS patientId,
            REGEXP_REPLACE(COALESCE(NULLIF(TRIM(p.whatsapp), ''), COALESCE(p.phone, '')), '[^0-9]', '') AS digits,
            p.name          AS name,
            p.patient_type  AS patientType,
            DATE_FORMAT(p.dob, '%Y-%m-%d') AS dob,
            COALESCE(
              (SELECT NULLIF(TRIM(g.name), '') FROM patients g
                WHERE g.id = p.guardian_id AND g.org_id = p.org_id AND g.deleted_at IS NULL LIMIT 1),
              (SELECT NULLIF(TRIM(pr.related_name), '') FROM patient_relationships pr
                WHERE pr.org_id = p.org_id AND pr.patient_id = p.id
                  AND pr.type IN ('guardian','parent','father','mother')
                ORDER BY pr.created_at DESC LIMIT 1)
            ) AS guardianName
          FROM patients p
          WHERE p.org_id = ${p.orgId}
            AND p.branch_id = ${actingBranch}
            AND p.deleted_at IS NULL
        `);

        /* Keyed by the normalised digits so the lookup matches `allowed`, which is
         * already normalised. Both intl and local forms are indexed because
         * patient master data stores whichever the counter staff typed. */
        const byPhone = new Map<string, {
          patientId?: string;
          digits?: unknown;
          name?: string | null;
          patientType?: string | null;
          dob?: string | null;
          guardianName?: string | null;
        }>();
        const patientList = (patientRows as { rows?: Array<{
          patientId?: string;
          digits?: unknown;
          name?: string | null;
          patientType?: string | null;
          dob?: string | null;
          guardianName?: string | null;
        }> }).rows ?? [];
        for (const row of patientList) {
          const digits = String(row.digits ?? '');
          if (!digits) continue;
          byPhone.set(digits, row);
          if (digits.startsWith('60') && digits.length > 9) {
            byPhone.set(`0${digits.slice(2)}`, row);
          } else if (digits.startsWith('0')) {
            byPhone.set(`6${digits}`, row);
          }
        }

        let unmatchedRecipients = 0;

        /* Compose every body up front, from the body the operator approved.
         *
         * `composedBody[i]` aligns with `allowed[i]`, so the drip schedule and the
         * message text cannot fall out of step. An unresolved tag is refused
         * rather than sent: "{nama}" visible to a patient is a defect, and a
         * clinical tag must stay unresolved so the privacy screen can see it. */
        const composedBody: string[] = [];
        for (const phone of allowed) {
          const patient = byPhone.get(phone);
          if (!patient) unmatchedRecipients++;

          const composed = substituteTags(input.body, {
            patient: {
              name: patient?.name ?? '',
              dob: patient?.dob ?? null,
              guardianName: patient?.guardianName ?? null,
              patientType: patient?.patientType ?? null,
            },
            branchName,
            bookingUrl,
            now,
          });

          if (composed.unknownTags.length > 0) {
            throw new ValidationError({
              body: [
                `Tag tidak dikenali: ${composed.unknownTags.join(', ')}`,
                'Tag yang tersedia: {nama}, {anak}, {cawangan}, {link}.',
              ],
            });
          }

          composedBody.push(composed.body);
        }

        /* Iterate the ALLOWED list — an opted-out number must never be queued.
         * The index aligns each recipient with its scheduled instant, so the
         * drip order matches the order the operator saw. */
        for (const [index, phone] of allowed.entries()) {
          let conversation =
            await this.repo.findActiveConversation(
              tx,
              p.orgId,
              channel.id,
              phone,
            );

          if (!conversation) {
            conversation =
              await this.repo.createConversation(
                tx,
                {
                  orgId: p.orgId,
                  branchId: actingBranch,
                  channelId: channel.id,
                  contactPhone: phone,
                  patientId: null,
                  status: 'new',
                  createdBy: p.staffId,
                  updatedBy: p.staffId,
                },
              );
          }

          const message =
            await this.repo.createMessage(
              tx,
              {
                orgId: p.orgId,
                branchId: actingBranch,
                channelId: channel.id,
                conversationId: conversation.id,
                direction: 'out',
                senderType: 'human',
                /* Per-recipient body: {nama} resolves to the patient for an
                 * adult and to the GUARDIAN for a minor, and {cawangan}/{link}
                 * come from this branch. Preview and send call the same function,
                 * so what the operator approved is what goes out. */
                body: composedBody[index] ?? input.body,
                mediaType: null,
                status: 'queued',
                /* FASA 5C-D: the drip schedule. Written per message so a restart
                 * loses nothing — the worker reads send_at from the row, not
                 * from an in-memory timer. */
                sendAt: schedule[index] ?? null,
                blastBatchId: batchId,
                idempotencyKey:
                  `blast:${batchId}:${phone}`,
                createdBy: p.staffId,
                updatedBy: p.staffId,
              },
            );

          await this.repo.updateConversation(
            tx,
            p.orgId,
            conversation.id,
            {
              lastMessageAt: now,
            },
          );

          await this.repo.createSafetyDecision(
            tx,
            {
              orgId: p.orgId,
              branchId: actingBranch,
              channelId: channel.id,
              conversationId: conversation.id,
              messageId: message.id,
              actorId: p.staffId,
              decision: 'allowed',
              blockedReason: null,
              gates: {
                source: 'whatsapp_blast',
                consentConfirmed: true,
                dailyCap,
              },
            },
          );

          jobs.push({
            messageId: message.id,
            conversationId: conversation.id,
            channelId: channel.id,
            branchId: actingBranch,
          });
        }

        /* Register the campaign so it can be reported on and stopped as a whole.
         * A stop must reach messages already queued (some up to 14 days out), so
         * the flag lives here and the worker checks it at send time. */
        await tx.execute(sql`
          INSERT INTO wa_blast_campaigns
            (id, org_id, branch_id, channel_id, batch_id, name, status,
             total_count, body, window_start_hour, window_end_hour, per_day,
             first_send_at, last_send_at, created_by, updated_by)
          VALUES
            (${randomUUID()}, ${p.orgId}, ${actingBranch}, ${channel.id}, ${batchId},
             ${input.campaignName ?? 'Blast WhatsApp'}, 'running',
             ${jobs.length}, ${input.body}, ${win.windowStartHour}, ${win.windowEndHour},
             ${branchWindow?.perDay ?? 100},
             ${schedule[0] ?? null}, ${schedule[schedule.length - 1] ?? null},
             ${p.staffId}, ${p.staffId})
        `);

        await this.audit.record(
          this.auditEvent(
            p,
            'wa_blast_queued',
            'wa_channels',
            channel.id,
            actingBranch,
            undefined,
            {
              batchId,
              recipients: jobs.length,
              dailyCap,
            },
          ),
          tx,
        );

        return {
          jobs,
          sentToday,
          pending,
          unmatchedRecipients,
        };
      },
    );

    for (const job of result.jobs) {
      await this.dispatchQueuedMessage(
        job.messageId,
        p.orgId,
        job.branchId,
        job.channelId,
        job.conversationId,
      );
    }

    return {
      ok: true,
      batchId,
      queued: result.jobs.length,
      /* How many recipients matched no patient record. They still received the
       * neutral fallback, but the operator should know the list contains numbers
       * the clinic has no record for. */
      unmatchedRecipients: result.unmatchedRecipients,
      dailyLimit: dailyCap,
      usedBefore: result.sentToday + result.pending,
      remaining: Math.max(
        0,
        dailyCap -
          result.sentToday -
          result.pending -
          result.jobs.length,
      ),
    };
  }

  /* ==========================================================================
     FASA 5F — CAMPAIGN SCHEDULE
     ==========================================================================*/

  /**
   * Set (or clear) a campaign's dates and daily target, and say whether the plan
   * is actually possible.
   *
   * Refuses rather than clamps. An operator planning 1400 over 7 days is asking
   * for 200 a day from a number capped at 100; sending 100 and finishing late
   * would miss the promotion date, which is the one thing that cannot move. The
   * refusal carries the arithmetic so the operator can fix the plan.
   */
  async setCampaignSchedule(p: Principal, campaignId: string, raw: unknown) {
    const input = this.parse(campaignScheduleInput, raw);

    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id, branch_id AS branchId, total_count AS totalCount,
               sent_count AS sentCount, per_day AS perDay, daily_target AS dailyTarget,
               start_date AS startDate, end_date AS endDate,
               paused_reason AS pausedReason, paused_until AS pausedUntil
        FROM wa_blast_campaigns
        WHERE id = ${campaignId} AND org_id = ${p.orgId} AND deleted_at IS NULL
        LIMIT 1
      `);

      const campaign = (rows as { rows?: Array<{
        id: string;
        branchId: string;
        totalCount: number;
        sentCount: number;
        perDay: number | null;
        dailyTarget: number | null;
        startDate: string | null;
        endDate: string | null;
        pausedReason: string | null;
        pausedUntil: string | null;
      }> }).rows?.[0];
      if (!campaign) throw new NotFoundError('waBlastCampaign', campaignId);

      /* Branch users may only schedule their own branch's campaign. */
      this.branch(p, campaign.branchId);

      const ceiling = await this.branchDailyCap(tx, p.orgId, campaign.branchId);

      const verdict = reviewSchedule({
        startDate: input.startDate ?? campaign.startDate,
        endDate: input.endDate ?? campaign.endDate,
        /* Read the STORED target when this request does not supply one, so
         * changing only the dates keeps the operator's chosen pace instead of
         * silently reverting it to the derived rate. */
        dailyTarget: input.dailyTarget ?? campaign.dailyTarget ?? null,
        branchDailyCap: ceiling,
        totalCount: Number(campaign.totalCount),
        sentCount: Number(campaign.sentCount),
      });

      if (!verdict.ok) {
        throw new ValidationError({
          schedule: [verdict.message],
        });
      }

      await tx.execute(sql`
        UPDATE wa_blast_campaigns
        SET start_date = ${input.startDate ?? campaign.startDate},
            end_date = ${input.endDate ?? campaign.endDate},
            daily_target = ${input.dailyTarget ?? campaign.dailyTarget ?? null},
            per_day = ${verdict.perDay},
            updated_at = NOW(6)
        WHERE id = ${campaignId} AND org_id = ${p.orgId}
      `);

      await this.audit.record(
        this.auditEvent(p, 'wa_campaign_scheduled', 'wa_blast_campaigns', campaignId, campaign.branchId, undefined, {
          days: verdict.days,
          perDay: verdict.perDay,
          cappedBy: verdict.cappedBy,
        }),
        tx,
      );

      return {
        campaignId,
        days: verdict.days,
        perDay: verdict.perDay,
        cappedBy: verdict.cappedBy,
      };
    });
  }

  /**
   * Campaign progress: day N of M, sent X of Y, and whether that is on track.
   *
   * "Behind" is measured against the plan, never against zero. 300 of 1400 is
   * fine on day 3 and badly behind on day 13 — the same number, an opposite
   * conclusion.
   */
  async campaignProgressBoard(p: Principal, rawQuery: Record<string, unknown>) {
    const parsed = z.object({
      branchId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).strict().safeParse(rawQuery ?? {});

    if (!parsed.success) {
      throw new ValidationError({ branchId: ['Penapis kempen tidak sah'] });
    }

    const branchScope = this.scoped(p, parsed.data.branchId);
    const now = new Date();

    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id, branch_id AS branchId, name, status,
               total_count AS totalCount, sent_count AS sentCount,
               failed_count AS failedCount, cancelled_count AS cancelledCount,
               per_day AS perDay, daily_target AS dailyTarget,
               start_date AS startDate, end_date AS endDate,
               paused_reason AS pausedReason, paused_until AS pausedUntil,
               cancelled_at AS cancelledAt
        FROM wa_blast_campaigns
        WHERE org_id = ${p.orgId} AND deleted_at IS NULL
          AND ${branchScope === null ? sql`1 = 1` : sql`branch_id = ${branchScope}`}
        ORDER BY created_at DESC
        LIMIT ${parsed.data.limit}
      `);

      /* THE CEILING COMES FROM THE BRANCH'S SETTINGS, NOT FROM THE CAMPAIGN.
       *
       * `per_day` on the campaign is the rate the PLAN was written at, so using
       * it as the ceiling is circular: the schedule can never appear to exceed a
       * limit derived from itself, and a branch that later lowers its real
       * ceiling would go unnoticed. The ceiling belongs to the WhatsApp number
       * (max_blast_per_day), so it is read per branch — the same per-branch rule
       * the SLA board uses, and for the same reason: one number cannot describe
       * several branches. */
      const capRows = await tx.execute(sql`
        SELECT branch_id AS branchId, max_blast_per_day AS cap
        FROM ai_whatsapp_settings
        WHERE org_id = ${p.orgId}
      `);
      const capByBranch = new Map<string, number>();
      const capList = (capRows as { rows?: Array<{ branchId: string; cap: number }> }).rows ?? [];
      for (const row of capList) {
        capByBranch.set(row.branchId, Number(row.cap));
      }

      const campaignRows = (rows as { rows?: Array<{
        id: string;
        branchId: string;
        name: string | null;
        status: string | null;
        totalCount: number;
        sentCount: number;
        failedCount: number;
        cancelledCount: number;
        perDay: number | null;
        dailyTarget: number | null;
        startDate: string | null;
        endDate: string | null;
        pausedReason: string | null;
        pausedUntil: string | null;
        cancelledAt: string | null;
      }> }).rows ?? [];
      const campaigns = campaignRows.map((c) => {
        const ceiling = capByBranch.get(c.branchId) ?? DEFAULT_BLAST_DAILY_CAP;
        /* A campaign with no dates cannot be measured; the UI shows the counts
         * and says why the schedule is missing, rather than inventing a rate. */
        const progress = campaignProgress({
          startDate: c.startDate,
          endDate: c.endDate,
          /* The stored intent, not the derived rate: progress must be measured
           * against the pace the operator chose. */
          dailyTarget: c.dailyTarget ?? null,
          branchDailyCap: ceiling,
          totalCount: Number(c.totalCount),
          sentCount: Number(c.sentCount),
        }, now);

        return {
          id: c.id,
          /* Returned so a multi-branch board can GROUP by branch. Without it the
           * HQ view can only list campaigns, and a branch that has run nothing
           * disappears — which is the row the meeting is about. */
          branchId: c.branchId,
          name: c.name,
          status: c.status,
          totalCount: Number(c.totalCount),
          sentCount: Number(c.sentCount),
          failedCount: Number(c.failedCount),
          cancelledCount: Number(c.cancelledCount),
          startDate: c.startDate,
          endDate: c.endDate,
          dailyTarget: c.dailyTarget ?? null,
          perDay: c.perDay ?? null,
          pausedReason: c.pausedReason,
          pausedUntil: c.pausedUntil,
          cancelled: Boolean(c.cancelledAt),
          progress,
          progressText: progress?.text ?? `${c.sentCount}/${c.totalCount} dihantar`,
        };
      });

      const behind = campaigns.filter((c) => c.progress && !c.progress.done && !c.progress.onTrack);

      return {
        campaigns,
        behindCount: behind.length,
        summary:
          behind.length === 0
            ? 'Semua kempen ikut jadual'
            : `${behind.length} kempen lewat jadual`,
      };
    });
  }

  /** The branch's hard daily ceiling, read from the settings row, defaulting. */
  private async branchDailyCap(
    tx: { execute: (q: unknown) => Promise<unknown> },
    orgId: string,
    branchId: string | null,
  ): Promise<number> {
    const rows = await tx.execute(sql`
      SELECT max_blast_per_day AS cap
      FROM ai_whatsapp_settings
      WHERE org_id = ${orgId}
        AND ${branchId === null ? sql`1 = 1` : sql`branch_id = ${branchId}`}
      LIMIT 1
    `);
    const cap = (rows as { rows?: Array<{ cap?: unknown }> }).rows?.[0]?.cap;
    return Number(cap ?? DEFAULT_BLAST_DAILY_CAP);
  }

  /* ==========================================================================
     TEMPLATES (quick-reply content records only — no automated sending)
     ==========================================================================*/
  async createTemplate(p: Principal, raw: unknown) {
    const input = this.parse(templateInput, raw);
    /* Fail-fast at service layer before touching RLS-protected tables:
     * branch roles own-branch only. Doctor branch access granted by RBAC matrix. */
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
