import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import {
  ForbiddenError,
  ValidationError,
} from '../../../shared/errors/errors';

const querySchema = z.object({
  branchId: z.string().uuid().optional(),
  months: z.coerce.number().int().min(1).max(36).default(6),
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
  suggestedReason: string;
}

@Injectable()
export class ScrubbingService {
  constructor(
    private readonly dbCtx: DbContextService,
  ) {}

  async listCandidates(
    principal: Principal,
    rawQuery: unknown,
  ): Promise<ScrubbingCandidate[]> {
    if (
      principal.role !== 'hq' &&
      principal.role !== 'branch_manager'
    ) {
      throw new ForbiddenError(
        'AI Scrubbing is restricted to HQ and branch managers',
      );
    }

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

    const branchId =
      principal.role === 'hq'
        ? input.branchId ?? null
        : principal.branchId;

    if (!branchId) {
      throw new ValidationError({
        branchId: ['Branch mesti dipilih untuk AI Scrubbing'],
      });
    }

    if (
      principal.role === 'branch_manager' &&
      branchId !== principal.branchId
    ) {
      throw new ForbiddenError(
        'Branch manager cannot scrub another branch',
      );
    }

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
              ) AS last_treatment

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
            pa.last_visit_at >
              TIMESTAMP('1000-01-01 00:00:00')

            AND pa.last_visit_at <=
              DATE_SUB(
                UTC_TIMESTAMP(),
                INTERVAL ${input.months} MONTH
              )

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

          ORDER BY pa.last_visit_at ASC

          LIMIT ${input.limit}
        `);

        return result.rows.map((row: any) => ({
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
          suggestedReason:
            String(
              row.suggestedReason ??
                'Sesuai untuk follow-up',
            ),
        }));
      },
    );
  }
}
