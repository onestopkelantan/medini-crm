/**
 * WaitlistService — FASA E (0027). CRUD + lifecycle transitions.
 *
 * THE CONTRACT (mirrors the reference system's API surface):
 *   GET    /appointments/waitlist?status=   → list (with 3 stat counts)
 *   POST   /appointments/waitlist           → add (registered patient, REQUIRED)
 *   PATCH  /appointments/waitlist/:id/status → active → notified → booked…
 *   DELETE /appointments/waitlist/:id       → soft-delete (cancel)
 *
 * Registered patients only — the reference (dental-erp model Waitlist) takes
 * no walk-ins, and the sources of an entry are staff and the booking AI, both
 * of which already know who the patient is. The patient's name/phone are NOT
 * snapshotted here: the FK keeps the join live, and a snapshot would rot
 * the moment the patient's record is corrected.
 *
 * RBAC follows the appointments module's own matrix cells: view for staff who
 * can see appointments, create/edit for those who can manage them. HQ may
 * target any branch explicitly; branch staff act on their own branch only.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ConflictError, ForbiddenError, NotFoundError,
} from '../../../shared/errors/errors';
import { waitlistEntries } from '../../../infrastructure/database/schema';
import {
  canWaitlistTransition, allowedWaitlistTransitions, normalizeDays, WEEKDAYS,
} from '../domain/waitlist-flow';

const addSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().nullish(),
  /* Weekday names — normalized by the domain before storage. Empty/absent =
   * any day. Max 7 (there are only 7 days). */
  preferredDays: z.array(z.string().trim().min(3).max(10)).max(7).nullish(),
  preferredTime: z.enum(['morning', 'afternoon', 'evening']).nullish(),
  notes: z.string().max(512).nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

const statusSchema = z.object({
  status: z.enum(['active', 'notified', 'booked', 'cancelled', 'expired']),
});

const listSchema = z.object({
  branchId: z.string().uuid().nullish(),
  status: z.enum(['active', 'notified', 'booked', 'cancelled', 'expired']).nullish(),
});

@Injectable()
export class WaitlistService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  private readBranch(p: Principal): string | null {
    if (p.role === 'hq') return null;
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  private mutateBranch(p: Principal, explicit: string | null | undefined): string {
    if (p.role === 'hq') {
      if (!explicit) throw new ValidationError({ branchId: ['branchId is required for HQ'] });
      return explicit;
    }
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  async list(p: Principal, raw: unknown) {
    const parsed = listSchema.safeParse(raw ?? {});
    if (!parsed.success) throw this.validation(parsed);
    const target = this.readBranch(p) ?? parsed.data.branchId ?? null;

    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx
        .select({
          id: waitlistEntries.id,
          branchId: waitlistEntries.branchId,
          patientId: waitlistEntries.patientId,
          doctorId: waitlistEntries.doctorId,
          preferredDays: waitlistEntries.preferredDays,
          preferredTime: waitlistEntries.preferredTime,
          notes: waitlistEntries.notes,
          status: waitlistEntries.status,
          notifiedAt: waitlistEntries.notifiedAt,
          bookedAt: waitlistEntries.bookedAt,
          createdAt: waitlistEntries.createdAt,
        })
        .from(waitlistEntries)
        .where(and(
          eq(waitlistEntries.orgId, p.orgId),
          isNull(waitlistEntries.deletedAt),
          ...(target ? [eq(waitlistEntries.branchId, target)] : []),
          ...(parsed.data.status ? [eq(waitlistEntries.status, parsed.data.status)] : []),
        ))
        .orderBy(desc(waitlistEntries.createdAt))
        .limit(200);

      /* The three numbers the reference screen shows at the top. One query,
       * scoped exactly like the list beside it. */
      const counts = await tx
        .select({
          status: waitlistEntries.status,
          n: sql<number>`COUNT(*)`,
        })
        .from(waitlistEntries)
        .where(and(
          eq(waitlistEntries.orgId, p.orgId),
          isNull(waitlistEntries.deletedAt),
          ...(target ? [eq(waitlistEntries.branchId, target)] : []),
        ))
        .groupBy(waitlistEntries.status);

      const by = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
      return {
        entries: rows,
        stats: { active: by('active'), notified: by('notified'), booked: by('booked') },
      };
    });
  }

  async add(p: Principal, raw: unknown) {
    const parsed = addSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.mutateBranch(p, input.branchId);
    /* The domain owns the weekday vocabulary; an unknown day is dropped, and
     * a fully-invalid list becomes null (any day) rather than a 422 — staff
     * say "mondae" and the entry should still land. */
    const days = normalizeDays(input.preferredDays ?? null);

    return this.dbCtx.runAs(p, async (tx) => {
      const patient = await tx.execute(sql`
        SELECT id, name, phone FROM patients
        WHERE org_id = ${p.orgId} AND id = ${input.patientId} AND deleted_at IS NULL
      `);
      const row = (patient as unknown as { rows: Array<{ id: string }> }).rows[0];
      if (!row) throw new NotFoundError('Patient', input.patientId);

      /* One live wish per patient per branch: a second "add" for a patient
       * already waiting is almost always a double-submit, and the AI's slot
       * offers would then chase two rows for one person. */
      const dup = await tx.execute(sql`
        SELECT id FROM waitlist_entries
        WHERE org_id = ${p.orgId} AND branch_id = ${branchId}
          AND patient_id = ${input.patientId}
          AND status IN ('active', 'notified')
          AND deleted_at IS NULL
      `);
      if ((dup as unknown as { rows: unknown[] }).rows.length) {
        throw new ConflictError('Patient is already on the waitlist for this branch');
      }

      const id = crypto.randomUUID();
      await tx.execute(sql`
        INSERT INTO waitlist_entries
          (id, org_id, branch_id, patient_id, doctor_id, preferred_days,
           preferred_time, notes, status, created_by, updated_by)
        VALUES (
          ${id}, ${p.orgId}, ${branchId}, ${input.patientId}, ${input.doctorId ?? null},
          ${days ? JSON.stringify(days) : null},
          ${input.preferredTime ?? null}, ${input.notes ?? null},
          'active', ${p.staffId}, ${p.staffId}
        )
      `);

      await this.audit.record({
        actorId: p.staffId, actorRole: p.role,
        action: 'waitlist_entry_created', entity: 'waitlist_entries', entityId: id,
        orgId: p.orgId, branchId, source: 'api',
        after: {
          patientId: input.patientId,
          doctorId: input.doctorId ?? null,
          preferredDays: days,
          preferredTime: input.preferredTime ?? null,
        },
      }, tx);

      return { id, status: 'active' };
    });
  }

  async changeStatus(p: Principal, id: string, raw: unknown) {
    const parsed = statusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const to = parsed.data.status;

    return this.dbCtx.runAs(p, async (tx) => {
      const found = await tx.execute(sql`
        SELECT id, status, branch_id FROM waitlist_entries
        WHERE org_id = ${p.orgId} AND id = ${id} AND deleted_at IS NULL
      `);
      const entry = (found as unknown as { rows: Array<{ id: string; status: string; branch_id: string }> }).rows[0];
      if (!entry) throw new NotFoundError('WaitlistEntry', id);

      if (entry.status === to) return { id, status: to };

      if (!canWaitlistTransition(entry.status, to)) {
        throw new ConflictError(
          `Illegal transition ${entry.status} → ${to} (allowed: ${allowedWaitlistTransitions(entry.status).join(', ') || 'none'})`,
        );
      }

      await tx.execute(sql`
        UPDATE waitlist_entries
        SET status = ${to},
            notified_at = CASE WHEN ${to} = 'notified' THEN NOW(6) ELSE notified_at END,
            booked_at = CASE WHEN ${to} = 'booked' THEN NOW(6) ELSE booked_at END,
            updated_by = ${p.staffId},
            updated_at = NOW(6)
        WHERE org_id = ${p.orgId} AND id = ${id}
      `);

      await this.audit.record({
        actorId: p.staffId, actorRole: p.role,
        action: 'waitlist_entry_status_changed', entity: 'waitlist_entries', entityId: id,
        orgId: p.orgId, branchId: entry.branch_id, source: 'api',
        before: { status: entry.status }, after: { status: to },
      }, tx);

      return { id, status: to };
    });
  }

  /** Soft-delete = staff cancel. The row stays for the audit trail. */
  async remove(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const found = await tx.execute(sql`
        SELECT id, status, branch_id FROM waitlist_entries
        WHERE org_id = ${p.orgId} AND id = ${id} AND deleted_at IS NULL
      `);
      const entry = (found as unknown as { rows: Array<{ id: string; status: string; branch_id: string }> }).rows[0];
      if (!entry) throw new NotFoundError('WaitlistEntry', id);

      await tx.execute(sql`
        UPDATE waitlist_entries
        SET deleted_at = NOW(6), updated_by = ${p.staffId}, updated_at = NOW(6)
        WHERE org_id = ${p.orgId} AND id = ${id}
      `);

      await this.audit.record({
        actorId: p.staffId, actorRole: p.role,
        action: 'waitlist_entry_removed', entity: 'waitlist_entries', entityId: id,
        orgId: p.orgId, branchId: entry.branch_id, source: 'api',
        before: { status: entry.status },
      }, tx);

      return { id, removed: true };
    });
  }

  private validation(parsed: { error: { issues: Array<{ path: (string | number)[]; message: string }> } }): ValidationError {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      (fields[key] ??= []).push(issue.message);
    }
    return new ValidationError(fields);
  }
}

/* Keep the weekday vocabulary import honest (used in add()'s normalization). */
export const WAITLIST_WEEKDAYS = WEEKDAYS;
