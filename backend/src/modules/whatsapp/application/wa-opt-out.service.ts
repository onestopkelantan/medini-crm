/**
 * WhatsApp opt-out (STOP list).
 *
 * WHY THIS EXISTS
 *
 * A patient who replies "STOP" must never be messaged again. For a clinic this
 * is not a courtesy: continuing to contact someone who asked to stop is a PDPA
 * exposure, and operationally it is the fastest way to be reported and have the
 * number restricted by Meta — which costs every other patient their reminders.
 *
 * TWO RULES THAT SHAPE THE DESIGN
 *
 * 1. STOP IS ORG-WIDE. "Stop" means stop messaging me, not stop messaging me
 *    from this one branch. A patient who opts out at Setia Tropika must not be
 *    re-contacted by Bukit Indah — that is precisely how a clinic looks like it
 *    is not listening, and how a report becomes a block.
 *
 * 2. THE BLOCK IS CHECKED AT SEND TIME, NOT ONLY AT LIST TIME. Filtering the
 *    recipient list is not enough: a message can also be composed, queued or
 *    scheduled before the patient opts out. `assertNotOptedOut()` is the single
 *    gate every outbound path must pass, so a STOP that arrives between
 *    "list built" and "message sent" still wins.
 *
 * KEYED ON PHONE, NOT PATIENT ID
 *
 * The blast path works from a raw number list, and a number can belong to no
 * patient record at all (a lead, a guardian, an archived patient). Keying on the
 * number means their STOP still counts.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/errors';
import { AuditService } from '../../../shared/audit/audit.service';
import { waOptOuts } from '../../../infrastructure/database/schema';
import { normalizePhone } from '../domain/whatsapp-lifecycle';

/**
 * Words that mean "stop messaging me".
 *
 * Deliberately matched as WHOLE, NORMALISED words rather than substrings: a
 * patient asking "boleh saya stop rawatan ini?" is asking about treatment, not
 * about marketing, and must NOT be silently removed from every future reminder.
 * That false positive is worse than a missed opt-out (which the patient will
 * repeat), so the match is deliberately narrow.
 */
export const STOP_KEYWORDS = [
  'stop',
  'berhenti',
  'berhentilah',
  'jangan hantar',
  'jangan mesej',
  'jangan whatsapp',
  'unsubscribe',
  'unsub',
  'opt out',
  'optout',
  'tak nak terima',
  'jangan ganggu',
] as const;

/** Reply sent once, so the patient knows the request landed. */
export const STOP_CONFIRMATION =
  'Baik, kami akan berhenti menghantar mesej kepada nombor ini. ' +
  'Jika anda ingin menerima mesej semula pada masa akan datang, ' +
  'sila maklumkan kepada kami. Terima kasih.';

/** Short replies that are unambiguously an opt-out even standing alone. */
const EXACT_STOP = new Set(['stop', 'berhenti', 'unsub', 'unsubscribe', 'optout', 'opt out']);

/**
 * Detect an opt-out request in an inbound message.
 *
 * Returns the matched keyword, or null. Kept pure and exported so both the
 * webhook and its tests use the same rule.
 */
export function detectStopRequest(text: string): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  /* Cap the length: a long message is a conversation, not a one-word command.
   * This also stops a stray "stop" deep inside a paragraph of treatment
   * questions from unmasking a patient out of their reminders. */
  if (raw.length > 60) return null;

  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    /* Strip surrounding punctuation on BOTH ends. People write "STOP", 'stop',
     * — stop — and (stop). A quote or dash is noise, not a different word. */
    .replace(/^["'“”‘’()[\]{}<>\-—–*_.,!?~:;\s]+/, '')
    .replace(/["'“”‘’()[\]{}<>\-—–*_.,!?~:;\s]+$/, '')
    .trim();
  if (!normalized) return null;

  if (EXACT_STOP.has(normalized)) return normalized;

  /* A short message that STARTS with a stop word ("stop hantar mesej") is an
   * instruction. A sentence that merely mentions it is not. */
  for (const kw of STOP_KEYWORDS) {
    if (normalized === kw) return kw;
    if (normalized.startsWith(kw + ' ')) return kw;
  }
  return null;
}

export interface OptOutRecord {
  id: string;
  phone: string;
  source: 'reply_stop' | 'staff_manual' | 'patient_request';
  matchedKeyword: string | null;
  reason: string | null;
  patientId: string | null;
  originBranchId: string | null;
  createdAt: Date;
  /** True when this entry no longer blocks sends. */
  revoked: boolean;
  revokedAt: Date | null;
}

@Injectable()
export class WaOptOutService {
  private readonly logger = new Logger(WaOptOutService.name);

  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ reading */

  /**
   * Is this number blocked?
   *
   * Safe default: a lookup failure returns TRUE (treat as blocked). Refusing to
   * send a reminder is a recoverable annoyance; sending to someone who asked to
   * be left alone is not. The error is logged so the outage is visible.
   */
  /**
   * Tri-state opt-out lookup: true / false / NULL (lookup failed).
   *
   * NULL exists because "we could not tell" is not the same as "no". The queue
   * decision for a 14-day blast is made on day 1 and acted on day 14; if the
   * database is unreachable at that moment, recording the patient as opted-out
   * would be a false compliance record, and recording them as clear would send
   * to someone who said STOP. The caller decides, and the blast path decides
   * "abort".
   */
  async checkOptOut(orgId: string, phone: string): Promise<boolean | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;

    try {
      return await this.dbCtx.runAsWorker(
        {
          orgId,
          branchIds: ['00000000-0000-0000-0000-000000000000'],
          correlationId: 'wa-optout-check',
          source: 'system_worker',
        },
        async (tx) => {
          const rows = await tx.select({ id: waOptOuts.id })
            .from(waOptOuts)
            .where(and(
              eq(waOptOuts.orgId, orgId),
              eq(waOptOuts.phone, normalized),
              isNull(waOptOuts.revokedAt),
              isNull(waOptOuts.deletedAt),
            ))
            .limit(1);
          return rows.length > 0;
        },
      );
    } catch (error) {
      this.logger.error(
        `Gagal semak senarai STOP untuk ${normalized}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Boolean form, failing CLOSED: an unreadable opt-out list is treated as
   * "opted out" so no message is sent on an unknown answer.
   */
  async isOptedOut(orgId: string, phone: string): Promise<boolean> {
    const result = await this.checkOptOut(orgId, phone);
    return result !== false;
  }

  /** The subset of `phones` that are blocked. Used to filter a recipient list. */
  async filterOptedOut(orgId: string, phones: string[]): Promise<string[]> {
    const normalized = [...new Set(phones.map((p) => normalizePhone(p)).filter(Boolean))];
    if (!normalized.length) return [];

    try {
      return await this.dbCtx.runAsWorker(
        {
          orgId,
          branchIds: ['00000000-0000-0000-0000-000000000000'],
          correlationId: 'wa-optout-filter',
          source: 'system_worker',
        },
        async (tx) => {
          const rows = await tx.select({ phone: waOptOuts.phone })
            .from(waOptOuts)
            .where(and(
              eq(waOptOuts.orgId, orgId),
              inArray(waOptOuts.phone, normalized),
              isNull(waOptOuts.revokedAt),
              isNull(waOptOuts.deletedAt),
            ));
          return rows.map((r: { phone: string }) => r.phone);
        },
      );
    } catch (error) {
      this.logger.error(
        `Gagal tapis senarai STOP: ${error instanceof Error ? error.message : error}`,
      );
      /* Fail closed: treat every number as blocked rather than risk messaging
       * someone who asked to be left alone. The caller reports a count. */
      return normalized;
    }
  }

  /** The STOP list for the operator screen. */
  async list(p: Principal): Promise<OptOutRecord[]> {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Senarai STOP hanya untuk HQ dan pengurus cawangan');
    }

    const rows = await this.dbCtx.runAs(p, async (tx) =>
      tx.select().from(waOptOuts)
        .where(and(eq(waOptOuts.orgId, p.orgId), isNull(waOptOuts.deletedAt)))
        .orderBy(desc(waOptOuts.createdAt))
        .limit(500),
    );

    return rows.map((r: typeof waOptOuts.$inferSelect) => ({
      id: r.id,
      phone: r.phone,
      source: r.source as OptOutRecord['source'],
      matchedKeyword: r.matchedKeyword ?? null,
      reason: r.reason ?? null,
      patientId: r.patientId ?? null,
      originBranchId: r.originBranchId ?? null,
      createdAt: r.createdAt,
      revoked: r.revokedAt != null,
      revokedAt: r.revokedAt ?? null,
    }));
  }

  /* ------------------------------------------------------------ writing */

  /**
   * Record a STOP.
   *
   * Idempotent: a second "STOP" from the same number updates nothing and does
   * not error — the patient repeating themselves must not produce a failure.
   * If the number previously opted out and later asked to be re-included, a new
   * STOP clears the revocation, because the latest instruction wins.
   */
  async record(
    orgId: string,
    phone: string,
    opts: {
      source?: OptOutRecord['source'];
      matchedKeyword?: string | null;
      reason?: string | null;
      patientId?: string | null;
      originBranchId?: string | null;
    } = {},
  ): Promise<{ created: boolean; phone: string }> {
    const normalized = normalizePhone(phone);
    if (!normalized || normalized.length < 9) {
      throw new ValidationError({ phone: ['Nombor telefon tidak sah'] });
    }

    const source = opts.source ?? 'reply_stop';

    return this.dbCtx.runAsWorker(
      {
        orgId,
        branchIds: [opts.originBranchId ?? '00000000-0000-0000-0000-000000000000'],
        correlationId: 'wa-optout-record',
        source: 'system_worker',
      },
      async (tx) => {
        const existing = await tx.select().from(waOptOuts)
          .where(and(eq(waOptOuts.orgId, orgId), eq(waOptOuts.phone, normalized)))
          .limit(1);

        if (existing.length) {
          /* Already blocked and still blocked — nothing to do. Repeated STOPs
           * are common and must stay silent. */
          if (existing[0]!.revokedAt == null && existing[0]!.deletedAt == null) {
            return { created: false, phone: normalized };
          }
          /* Previously revoked → the newest instruction is to stop again. */
          await tx.update(waOptOuts)
            .set({
              revokedAt: null,
              revokedBy: null,
              deletedAt: null,
              source,
              matchedKeyword: opts.matchedKeyword ?? null,
              reason: opts.reason ?? null,
              updatedAt: new Date(),
            })
            .where(eq(waOptOuts.id, existing[0]!.id));
          return { created: true, phone: normalized };
        }

        await tx.insert(waOptOuts).values({
          orgId,
          phone: normalized,
          source,
          matchedKeyword: opts.matchedKeyword ?? null,
          reason: opts.reason ?? null,
          patientId: opts.patientId ?? null,
          originBranchId: opts.originBranchId ?? null,
        } as never);

        return { created: true, phone: normalized };
      },
    );
  }

  /** Staff-added block (a complaint, a request by phone, a wrong number). */
  async recordManual(p: Principal, raw: unknown): Promise<OptOutRecord> {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Hanya HQ dan pengurus cawangan boleh menambah senarai STOP');
    }

    const body = (raw ?? {}) as { phone?: unknown; reason?: unknown };
    const phone = normalizePhone(String(body.phone ?? ''));
    const reason = body.reason == null ? null : String(body.reason).trim().slice(0, 512);

    const result = await this.record(p.orgId, phone, {
      source: 'staff_manual',
      reason,
      originBranchId: p.branchId ?? null,
    });

    await this.dbCtx.runAs(p, async (tx) =>
      this.audit.record({
        actorId: p.staffId,
        actorRole: p.role,
        action: 'wa_opt_out_added',
        entity: 'wa_opt_outs',
        entityId: result.phone,
        orgId: p.orgId,
        branchId: p.branchId,
        source: 'api',
        after: { phone: result.phone, source: 'staff_manual' },
      }, tx),
    );

    const all = await this.list(p);
    const found = all.find((r) => r.phone === result.phone);
    if (!found) throw new NotFoundError('waOptOut', result.phone);
    return found;
  }

  /**
   * Lift a block — only on the patient's own request.
   *
   * Revoked rather than deleted so the history survives: "this patient asked us
   * to stop, then asked to resume" is exactly what you need to show if the
   * decision is ever questioned.
   */
  async revoke(p: Principal, id: string): Promise<OptOutRecord> {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Hanya HQ dan pengurus cawangan boleh buka sekatan STOP');
    }

    const updated = await this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.update(waOptOuts)
        .set({ revokedAt: new Date(), revokedBy: p.staffId, updatedAt: new Date() })
        .where(and(
          eq(waOptOuts.orgId, p.orgId),
          eq(waOptOuts.id, id),
          isNull(waOptOuts.revokedAt),
          isNull(waOptOuts.deletedAt),
        ))
        .returning();

      if (!rows.length) return null;

      await this.audit.record({
        actorId: p.staffId,
        actorRole: p.role,
        action: 'wa_opt_out_revoked',
        entity: 'wa_opt_outs',
        entityId: id,
        orgId: p.orgId,
        branchId: p.branchId,
        source: 'api',
        after: { revoked: true },
      }, tx);

      return rows[0]!;
    });

    if (!updated) throw new NotFoundError('waOptOut', id);
    return {
      id: updated.id,
      phone: updated.phone,
      source: updated.source as OptOutRecord['source'],
      matchedKeyword: updated.matchedKeyword ?? null,
      reason: updated.reason ?? null,
      patientId: updated.patientId ?? null,
      originBranchId: updated.originBranchId ?? null,
      createdAt: updated.createdAt,
      revoked: true,
      revokedAt: updated.revokedAt ?? null,
    };
  }

  /**
   * The gate every outbound send must pass.
   *
   * Throws instead of returning a boolean so a caller cannot accidentally ignore
   * the result — the whole point is that no path can "forget" to check.
   */
  async assertNotOptedOut(orgId: string, phone: string): Promise<void> {
    if (await this.isOptedOut(orgId, phone)) {
      throw new ForbiddenError(
        'Pesakit ini telah meminta berhenti menerima mesej (STOP). ' +
        'Mesej tidak dihantar. Buka sekatan di Senarai STOP jika pesakit meminta semula.',
      );
    }
  }

  /** Count only — for the Hub badge. */
  async count(p: Principal): Promise<number> {
    if (p.role !== 'hq' && p.role !== 'branch_manager') return 0;
    const rows = await this.dbCtx.runAs(p, async (tx) =>
      tx.select({ n: sql<number>`COUNT(*)` }).from(waOptOuts)
        .where(and(
          eq(waOptOuts.orgId, p.orgId),
          isNull(waOptOuts.revokedAt),
          isNull(waOptOuts.deletedAt),
        )),
    );
    return Number(rows[0]?.n ?? 0);
  }
}
