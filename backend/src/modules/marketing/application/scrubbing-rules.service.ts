/**
 * Scrubbing rules service — boss directive 8 Okt, point 4:
 * "mana treatment yang butuh scrubbing, bisa 3 bulan sekali 4 bulan
 *  sekali tergantung treatment intinya. UI/UX branch manager bisa
 *  setting berapa lama patient harus scrubbing."
 *
 * Owns the per-(branch, treatment) interval table. Two surfaces:
 *   - the MANAGER's settings screen (list / set interval / toggle)
 *   - the scrubbing LIST generator: given a branch, every ENABLED rule
 *     whose interval has elapsed for a patient's last treatment makes
 *     that patient a candidate.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/errors';

const ruleInput = z.object({
  branchId: z.string().uuid(),
  treatmentCode: z.string().trim().min(1).max(32),
  intervalMonths: z.coerce.number().int().min(1).max(60),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(256).nullish(),
}).strict();

export interface ScrubbingRuleRow {
  treatmentCode: string;
  treatmentName: string;
  category: string | null;
  intervalMonths: number;
  enabled: boolean;
  notes: string | null;
}

export interface ScrubbingDue {
  patientId: string;
  patientName: string;
  phone: string | null;
  treatmentCode: string;
  treatmentName: string;
  lastVisit: string | null;
  monthsSince: number;
  intervalMonths: number;
}

@Injectable()
export class ScrubbingRulesService {
  constructor(private readonly dbCtx: DbContextService) {}

  /** List the branch's rules joined to catalogue names (manager screen). */
  async list(p: Principal, branchId?: string): Promise<ScrubbingRuleRow[]> {
    const branch = this.targetBranch(p, branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        SELECT r.treatment_code, t.name AS treatment_name, t.category,
               r.interval_months, r.enabled, r.notes
        FROM scrubbing_rules r
        LEFT JOIN treatment_catalog t ON t.code = r.treatment_code AND t.deleted_at IS NULL
        WHERE r.branch_id = ${branch} AND r.deleted_at IS NULL
        ORDER BY t.category, t.name
      `);
      return ((result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? []).map(
        (row) => ({
          treatmentCode: String(row.treatment_code),
          treatmentName: String(row.treatment_name ?? row.treatment_code),
          category: row.category ? String(row.category) : null,
          intervalMonths: Number(row.interval_months),
          enabled: Boolean(row.enabled),
          notes: row.notes ? String(row.notes) : null,
        }),
      );
    });
  }

  
  async upsert(p: Principal, raw: unknown): Promise<{ ok: true }> {
    const parsed = ruleInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError({ _: [parsed.error.issues[0]?.message ?? 'input tidak sah'] });
    }
    const { branchId, treatmentCode, intervalMonths, enabled, notes } = parsed.data;
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Hanya HQ dan pengurus cawangan boleh ubah scrubbing');
    }
    if (p.role === 'branch_manager' && p.branchId !== branchId) {
      throw new ForbiddenError('Pengurus hanya boleh ubah scrubbing cawangan sendiri');
    }

    await this.dbCtx.runAs(p, async (tx) => {
      await tx.execute(sql`
        INSERT INTO scrubbing_rules
          (id, org_id, branch_id, treatment_code, interval_months, enabled, notes, created_by, updated_by)
        VALUES
          (UUID(), ${p.orgId}, ${branchId}, ${treatmentCode}, ${intervalMonths}, ${enabled}, ${notes ?? null}, ${p.staffId}, ${p.staffId})
        ON DUPLICATE KEY UPDATE
          interval_months = VALUES(interval_months),
          enabled = VALUES(enabled),
          notes = VALUES(notes),
          updated_by = VALUES(updated_by),
          deleted_at = NULL
      `);
    });
    return { ok: true };
  }

  /**
   * The scrubbing LIST — patients whose LAST treatment has an enabled
   * rule whose interval has elapsed. Each patient appears once (their
   * most recent treatment decides), deduped against the rules.
   */
  async due(p: Principal, branchId?: string, limit = 100): Promise<ScrubbingDue[]> {
    const branch = this.targetBranch(p, branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      /* Last treatment per patient (appointment-linked, completed),
       * then match against the branch's enabled rules. */
      /* Jalur data: rawatan terakhir seseorang pesakit dilihat melalui
       * pelan rawatan mereka (treatment_plans → treatment_plan_items →
       * treatment_catalog), BUKAN appointments.treatment_ref (rujukan
       * teks bebas yang tidak menjamin sambungan ke katalog). Ini juga
       * lebih jujur: scrubbing patut ikut apa yang DIRAWAT, bukan apa
       * yang ditempah. */
      const result = await tx.execute(sql`
        SELECT pt.id AS patient_id, pt.name AS patient_name, pt.phone,
               last.code AS treatment_code, tcn.name AS treatment_name,
               last.last_visit,
               TIMESTAMPDIFF(MONTH, last.last_visit, NOW()) AS months_since,
               r.interval_months
        FROM (
          /* Window + placeholder pernah gagal pd mysql2 prepared di sini;
           * bentuk MAX + correlated HAVING lebih tahan dan tanpa window. */
          SELECT iq.patient_id, tc.code, MAX(iq.updated_at) AS last_visit
          FROM (
            SELECT tp.patient_id, tp.updated_at, ti.treatment_id
            FROM treatment_plan_items ti
            JOIN treatment_plans tp ON tp.id = ti.plan_id
            WHERE tp.branch_id = ${branch}
              AND tp.patient_id IS NOT NULL
              AND ti.deleted_at IS NULL
              AND tp.deleted_at IS NULL
              AND ti.treatment_id IS NOT NULL
          ) iq
          JOIN treatment_catalog tc ON tc.id = iq.treatment_id AND tc.deleted_at IS NULL
          GROUP BY iq.patient_id, tc.code
          HAVING MAX(iq.updated_at) = (
            SELECT MAX(tp2.updated_at)
            FROM treatment_plan_items ti2
            JOIN treatment_plans tp2 ON tp2.id = ti2.plan_id
            WHERE tp2.patient_id = iq.patient_id
              AND ti2.treatment_id IS NOT NULL
              AND ti2.deleted_at IS NULL AND tp2.deleted_at IS NULL
          )
        ) last
        JOIN scrubbing_rules r
          ON r.branch_id = ${branch}
         AND r.treatment_code = last.code
         AND r.enabled = 1 AND r.deleted_at IS NULL
        JOIN patients pt ON pt.id = last.patient_id AND pt.deleted_at IS NULL
        LEFT JOIN treatment_catalog tcn ON tcn.code = last.code
        WHERE TIMESTAMPDIFF(MONTH, last.last_visit, NOW()) >= r.interval_months
        ORDER BY last.last_visit ASC
        LIMIT ${sql.raw(String(Math.max(1, Math.min(200, Math.floor(limit)))))}
      `);
      return ((result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? []).map(
        (row) => ({
          patientId: String(row.patient_id),
          patientName: String(row.patient_name),
          phone: row.phone ? String(row.phone) : null,
          treatmentCode: String(row.treatment_code),
          treatmentName: String(row.treatment_name ?? row.treatment_code),
          lastVisit: row.last_visit ? String(row.last_visit).slice(0, 10) : null,
          monthsSince: Number(row.months_since ?? 0),
          intervalMonths: Number(row.interval_months),
        }),
      );
    });
  }

  private targetBranch(p: Principal, requested?: string): string {
    if (p.role === 'hq') {
      if (!requested) throw new ValidationError({ branchId: ['Pilih cawangan'] });
      return requested;
    }
    if (p.role !== 'branch_manager') {
      throw new ForbiddenError('Senarai scrubbing hanya untuk HQ dan pengurus cawangan');
    }
    if (requested && requested !== p.branchId) {
      throw new NotFoundError('Cawangan tidak dijumpai dalam skop anda');
    }
    return p.branchId!;
  }
}