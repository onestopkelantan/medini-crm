import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import {
  ForbiddenError,
  ValidationError,
} from '../../../shared/errors/errors';

/**
 * AI Scrubbing — find the patients worth contacting.
 *
 * WHAT THIS IS FOR
 *
 * A patient who was seen months ago and never returned has a reason to be
 * contacted; a patient seen last week does not. This service finds the former,
 * with enough context (what they were last treated for) that the message can be
 * relevant rather than generic.
 *
 * THE TIME WINDOW IS A RANGE, NOT A THRESHOLD
 *
 * `months` alone ("longer ago than N") cannot express the bucket the clinic
 * actually works in — "6 to 9 months" is a different campaign from "over 12
 * months". A single lower bound also silently includes the very long tail, so
 * every recall bucket would collapse into one list.
 *
 * TREATMENT FILTERING FOLLOWS THE SCHEMA
 *
 * The link is `treatment_plan_items.treatment_id` → `treatment_catalog`, which
 * carries both the individual treatment and its category. Filtering joins
 * through that path rather than string-matching the free-text summary, so the
 * filter keeps working when the wording of a summary changes.
 *
 * Patients with NO recorded visit are excluded from every window: they have no
 * treatment history to recall them about, and treating "never visited" as
 * "infinitely overdue" is what previously put new patients into recall lists.
 */

/** A window with NO upper bound — used for "12 months or longer". */
const NO_UPPER_BOUND = 120;

const querySchema = z.object({
  branchId: z.string().uuid().optional(),
  /** Legacy single threshold. Kept so existing callers keep working. */
  months: z.coerce.number().int().min(1).max(36).optional(),
  /** Window start: at least this many months since the last visit. */
  minMonths: z.coerce.number().int().min(1).max(120).optional(),
  /** Window end: at most this many months since the last visit. */
  maxMonths: z.coerce.number().int().min(1).max(120).optional(),
  /** Filter by catalogue category, e.g. "Preventive". */
  treatmentCategory: z.string().trim().max(64).optional(),
  /** Filter by catalogue code, e.g. "TRT-0001". */
  treatmentCode: z.string().trim().max(32).optional(),
  /** Skip anyone messaged within this many days (default 30). */
  excludeContactedDays: z.coerce.number().int().min(0).max(3650).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface ScrubbingCandidate {
  patientId: string;
  mrn: string;
  name: string;
  contactPhone: string;
  lastVisitDate: string;
  daysSinceLastVisit: number;
  monthsSinceLastVisit: number;
  lastTreatment: string;
  /** Catalogue category of the last treatment, when one could be resolved. */
  lastTreatmentCategory: string | null;
  /** Catalogue code of the last treatment, when one could be resolved. */
  lastTreatmentCode: string | null;
  /** FASA 5C-E: date of birth (YYYY-MM-DD), null when unrecorded. */
  dob: string | null;
  /** The clinic's own adult/child classification. */
  patientType: string | null;
  /** Guardian on file, so a minor is addressed through them, not directly. */
  guardianName: string | null;
  suggestedReason: string;
}

/** Catalogue shape the UI needs for the treatment filter. */
export interface TreatmentOption {
  code: string;
  name: string;
  category: string;
}

/**
 * Normalise a phone the same way `normalizePhone()` does, in SQL.
 *
 * Both sides of a comparison must use the same form: conversation rows store the
 * normalised number, while patient rows store whatever was typed at the counter.
 * Comparing them raw would silently match nothing.
 */
const SQ_PHONE = (col: string) => sql.raw(`(
  CASE
    WHEN REGEXP_REPLACE(COALESCE(${col},''), '[^0-9]', '') LIKE '0%'
     AND REGEXP_REPLACE(COALESCE(${col},''), '[^0-9]', '') NOT LIKE '00%'
    THEN CONCAT('6', REGEXP_REPLACE(COALESCE(${col},''), '[^0-9]', ''))
    ELSE REGEXP_REPLACE(COALESCE(${col},''), '[^0-9]', '')
  END
)`);

@Injectable()
export class ScrubbingService {
  constructor(
    private readonly dbCtx: DbContextService,
  ) {}

  /** Catalogue for the treatment filter, grouped by category in the UI. */
  async listTreatments(principal: Principal): Promise<TreatmentOption[]> {
    this.assertAccess(principal);

    const result = await this.dbCtx.runAs(principal, async (tx) =>
      tx.execute(sql`
        SELECT code, name, category
        FROM treatment_catalog
        WHERE org_id = ${principal.orgId}
          AND deleted_at IS NULL
          AND is_active = 1
        ORDER BY category, name
      `),
    );

    return ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((r) => ({
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      category: String(r.category ?? ''),
    }));
  }

  async listCandidates(
    principal: Principal,
    rawQuery: unknown,
  ): Promise<ScrubbingCandidate[]> {
    this.assertAccess(principal);

    const parsed = querySchema.safeParse(rawQuery ?? {});

    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join('.'),
            [issue.message],
          ]),
        ),
      );
    }

    const input = parsed.data;

    /* A single `months` is treated as a LOWER bound — "at least this long ago"
     * — which preserves the original meaning for existing callers. */
    const minMonths = input.minMonths ?? input.months ?? 3;
    const maxMonths = input.maxMonths ?? NO_UPPER_BOUND;

    if (maxMonths < minMonths) {
      throw new ValidationError({
        maxMonths: ['Julat tidak sah: bulan maksimum mesti lebih besar daripada bulan minimum'],
      });
    }

    /* A manager is pinned to their own branch. Requesting another one is refused
     * outright rather than silently ignored: an operator who picks branch A and
     * is shown branch B's patients has no way to notice the mismatch, and the
     * resulting recall list would be sent under the wrong clinic's name. */
    if (
      principal.role === 'branch_manager' &&
      input.branchId &&
      input.branchId !== principal.branchId
    ) {
      throw new ForbiddenError(
        'Branch manager cannot scrub another branch',
      );
    }

    const branchId =
      principal.role === 'hq'
        ? input.branchId ?? null
        : principal.branchId;

    if (!branchId) {
      throw new ValidationError({
        branchId: ['Branch mesti dipilih untuk AI Scrubbing'],
      });
    }

    const limit = input.limit;

    return this.dbCtx.runAs(
      principal,
      async (tx) => {
        const result = await tx.execute(sql`
          WITH patient_activity AS (
            SELECT
              p.id AS patient_id,
              p.mrn AS mrn,
              p.name AS name,

              COALESCE(
                NULLIF(TRIM(p.whatsapp), ''),
                NULLIF(TRIM(p.phone), '')
              ) AS contact_phone,

              GREATEST(
                COALESCE(
                  (
                    SELECT MAX(ts.performed_at)
                    FROM treatment_sessions ts
                    INNER JOIN treatment_plans tp
                      ON tp.id = ts.plan_id
                    WHERE ts.org_id = p.org_id
                      AND tp.org_id = p.org_id
                      AND tp.patient_id = p.id
                      AND tp.branch_id = p.branch_id
                      AND tp.deleted_at IS NULL
                  ),
                  TIMESTAMP('1000-01-01 00:00:00')
                ),

                COALESCE(
                  (
                    SELECT MAX(
                      COALESCE(e.completed_at, e.started_at)
                    )
                    FROM encounters e
                    WHERE e.org_id = p.org_id
                      AND e.branch_id = p.branch_id
                      AND e.patient_id = p.id
                      AND e.deleted_at IS NULL
                      AND e.status <> 'cancelled'
                  ),
                  TIMESTAMP('1000-01-01 00:00:00')
                ),

                COALESCE(
                  (
                    SELECT MAX(
                      TIMESTAMP(
                        a.scheduled_date,
                        a.scheduled_time
                      )
                    )
                    FROM appointments a
                    WHERE a.org_id = p.org_id
                      AND a.branch_id = p.branch_id
                      AND a.patient_id = p.id
                      AND a.deleted_at IS NULL
                      AND a.status = 'completed'
                  ),
                  TIMESTAMP('1000-01-01 00:00:00')
                ),

                COALESCE(
                  p.last_visit_at,
                  TIMESTAMP('1000-01-01 00:00:00')
                )
              ) AS last_visit_at,

              COALESCE(
                (
                  SELECT COALESCE(
                    NULLIF(TRIM(ts2.summary), ''),
                    NULLIF(TRIM(tp2.title), '')
                  )
                  FROM treatment_sessions ts2
                  INNER JOIN treatment_plans tp2
                    ON tp2.id = ts2.plan_id
                  WHERE ts2.org_id = p.org_id
                    AND tp2.org_id = p.org_id
                    AND tp2.patient_id = p.id
                    AND tp2.branch_id = p.branch_id
                    AND tp2.deleted_at IS NULL
                  ORDER BY ts2.performed_at DESC
                  LIMIT 1
                ),

                (
                  SELECT NULLIF(
                    TRIM(e2.chief_complaint),
                    ''
                  )
                  FROM encounters e2
                  WHERE e2.org_id = p.org_id
                    AND e2.branch_id = p.branch_id
                    AND e2.patient_id = p.id
                    AND e2.deleted_at IS NULL
                    AND e2.status <> 'cancelled'
                  ORDER BY
                    COALESCE(
                      e2.completed_at,
                      e2.started_at
                    ) DESC
                  LIMIT 1
                ),

                'Pemeriksaan'
              ) AS last_treatment,

              /* Treatment identity from the CATALOGUE, via the plan items.
               * This is the schema's own link; matching the free-text summary
               * would break the moment a summary is reworded. */
              (
                SELECT tc.code
                FROM treatment_plan_items tpi
                INNER JOIN treatment_plans tp3
                  ON tp3.id = tpi.plan_id
                INNER JOIN treatment_catalog tc
                  ON tc.id = tpi.treatment_id
                WHERE tpi.org_id = p.org_id
                  AND tp3.org_id = p.org_id
                  AND tp3.patient_id = p.id
                  AND tp3.branch_id = p.branch_id
                  AND tp3.deleted_at IS NULL
                  AND tpi.deleted_at IS NULL
                  AND tc.deleted_at IS NULL
                ORDER BY
                  COALESCE(tp3.completed_at, tp3.activated_at, tp3.proposed_at) DESC
                LIMIT 1
              ) AS last_treatment_code,

              (
                SELECT tc.category
                FROM treatment_plan_items tpi
                INNER JOIN treatment_plans tp4
                  ON tp4.id = tpi.plan_id
                INNER JOIN treatment_catalog tc
                  ON tc.id = tpi.treatment_id
                WHERE tpi.org_id = p.org_id
                  AND tp4.org_id = p.org_id
                  AND tp4.patient_id = p.id
                  AND tp4.branch_id = p.branch_id
                  AND tp4.deleted_at IS NULL
                  AND tpi.deleted_at IS NULL
                  AND tc.deleted_at IS NULL
                ORDER BY
                  COALESCE(tp4.completed_at, tp4.activated_at, tp4.proposed_at) DESC
                LIMIT 1
              ) AS last_treatment_category,

              /* FASA 5C-E — addressing. A paediatric patient does not read their
               * own WhatsApp, so the candidate carries what is needed to address
               * the GUARDIAN instead. Resolved from the patient's own guardian
               * link, then from the relationship table, because real records
               * populate one or the other but not always both. */
              p.dob AS dob,
              p.patient_type AS patient_type,

              COALESCE(
                (
                  SELECT NULLIF(TRIM(g.name), '')
                  FROM patients g
                  WHERE g.id = p.guardian_id
                    AND g.org_id = p.org_id
                    AND g.deleted_at IS NULL
                  LIMIT 1
                ),
                (
                  SELECT NULLIF(TRIM(pr.related_name), '')
                  FROM patient_relationships pr
                  WHERE pr.org_id = p.org_id
                    AND pr.patient_id = p.id
                    AND pr.type IN ('guardian', 'parent', 'father', 'mother')
                  ORDER BY pr.created_at DESC
                  LIMIT 1
                )
              ) AS guardian_name

            FROM patients p

            WHERE p.org_id = ${principal.orgId}
              AND p.branch_id = ${branchId}
              AND p.deleted_at IS NULL
              AND p.status <> 'Inactive'

              AND COALESCE(
                NULLIF(TRIM(p.whatsapp), ''),
                NULLIF(TRIM(p.phone), '')
              ) IS NOT NULL
          )

          SELECT
            pa.patient_id AS patientId,
            pa.mrn AS mrn,
            pa.name AS name,
            pa.contact_phone AS contactPhone,

            DATE_FORMAT(
              pa.last_visit_at,
              '%Y-%m-%d'
            ) AS lastVisitDate,

            DATEDIFF(
              UTC_TIMESTAMP(),
              pa.last_visit_at
            ) AS daysSinceLastVisit,

            TIMESTAMPDIFF(
              MONTH,
              pa.last_visit_at,
              UTC_TIMESTAMP()
            ) AS monthsSinceLastVisit,

            pa.last_treatment AS lastTreatment,
            pa.last_treatment_code AS lastTreatmentCode,
            pa.last_treatment_category AS lastTreatmentCategory,
            pa.dob AS dob,
            pa.patient_type AS patientType,
            pa.guardian_name AS guardianName,

            CASE
              WHEN TIMESTAMPDIFF(
                MONTH,
                pa.last_visit_at,
                UTC_TIMESTAMP()
              ) >= 12
                THEN 'Tidak hadir 12 bulan atau lebih'

              WHEN pa.last_treatment <> 'Pemeriksaan'
                THEN CONCAT(
                  'Follow-up selepas ',
                  pa.last_treatment
                )

              ELSE
                'Sesuai untuk recall pemeriksaan'
            END AS suggestedReason

          FROM patient_activity pa

          WHERE
            /* A patient must HAVE a recorded visit. Without this, a never-seen
             * patient is treated as infinitely overdue and lands in every
             * recall list — the bug this window previously shipped. */
            pa.last_visit_at >
              TIMESTAMP('1000-01-01 00:00:00')

            /* Window: at least minMonths ago. */
            AND pa.last_visit_at <=
              DATE_SUB(
                UTC_TIMESTAMP(),
                INTERVAL ${minMonths} MONTH
              )

            /* And no longer than maxMonths ago, unless unbounded. */
            AND (
              ${maxMonths} >= ${NO_UPPER_BOUND}
              OR pa.last_visit_at >=
                DATE_SUB(
                  UTC_TIMESTAMP(),
                  INTERVAL ${maxMonths} MONTH
                )
            )

            /* Treatment filter, by catalogue category and/or exact code. */
            AND (
              ${input.treatmentCategory ?? null} IS NULL
              OR pa.last_treatment_category = ${input.treatmentCategory ?? null}
            )

            AND (
              ${input.treatmentCode ?? null} IS NULL
              OR pa.last_treatment_code = ${input.treatmentCode ?? null}
            )

            /* Nobody with an upcoming appointment — they are already coming. */
            AND NOT EXISTS (
              SELECT 1
              FROM appointments future_appt

              WHERE future_appt.org_id =
                  ${principal.orgId}

                AND future_appt.branch_id =
                  ${branchId}

                AND future_appt.patient_id =
                  pa.patient_id

                AND future_appt.deleted_at IS NULL

                AND future_appt.scheduled_date >=
                  DATE(UTC_TIMESTAMP())

                AND future_appt.status IN (
                  'booked',
                  'confirmed',
                  'checked-in',
                  'waiting',
                  'called',
                  'in-progress'
                )
            )

            /* Skip anyone contacted recently. Messaging the same patient in two
             * consecutive campaigns is what makes a clinic look like spam and
             * drives the reports that get a number restricted. Phone matching
             * is normalised on both sides. */
            AND NOT EXISTS (
              SELECT 1
              FROM wa_messages recent_out
              INNER JOIN wa_conversations recent_conv
                ON recent_conv.id = recent_out.conversation_id

              WHERE recent_out.org_id = ${principal.orgId}
                AND recent_out.direction = 'out'
                AND recent_out.deleted_at IS NULL
                AND recent_conv.deleted_at IS NULL
                AND recent_conv.contact_phone = ${SQ_PHONE('pa.contact_phone')}
                AND recent_out.created_at >=
                  DATE_SUB(
                    UTC_TIMESTAMP(),
                    INTERVAL ${input.excludeContactedDays} DAY
                  )
            )

          ORDER BY pa.last_visit_at ASC

          LIMIT ${limit}
        `);

        return ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => ({
          patientId: String(row.patientId),
          mrn: String(row.mrn ?? ''),
          name: String(row.name ?? ''),
          contactPhone: String(row.contactPhone ?? ''),
          lastVisitDate: String(row.lastVisitDate ?? ''),
          daysSinceLastVisit:
            Number(row.daysSinceLastVisit ?? 0),
          monthsSinceLastVisit:
            Number(row.monthsSinceLastVisit ?? 0),
          lastTreatment:
            String(row.lastTreatment ?? 'Pemeriksaan'),
          lastTreatmentCategory:
            row.lastTreatmentCategory == null ? null : String(row.lastTreatmentCategory),
          lastTreatmentCode:
            row.lastTreatmentCode == null ? null : String(row.lastTreatmentCode),
          /* FASA 5C-E — MySQL hands back a DATE as a Date object, so normalise
           * to YYYY-MM-DD. Passing a Date straight through would make age
           * arithmetic depend on the server timezone. */
          dob: row.dob
            ? (row.dob instanceof Date
                ? row.dob.toISOString().slice(0, 10)
                : String(row.dob).slice(0, 10))
            : null,
          patientType:
            row.patientType == null ? null : String(row.patientType),
          guardianName:
            row.guardianName == null ? null : String(row.guardianName),
          suggestedReason:
            String(
              row.suggestedReason ??
                'Sesuai untuk follow-up',
            ),
        }));
      },
    );
  }

  private assertAccess(principal: Principal): void {
    if (
      principal.role !== 'hq' &&
      principal.role !== 'branch_manager'
    ) {
      throw new ForbiddenError(
        'AI Scrubbing is restricted to HQ and branch managers',
      );
    }
  }
}
