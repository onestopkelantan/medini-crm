import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import {
  ForbiddenError,
  ValidationError,
} from '../../../shared/errors/errors';
import { MinimaxAdapter } from '../../ai-manager/infrastructure/minimax.adapter';

const uuid = z.string().uuid();

const draftInput = z.object({
  branchId: uuid.optional(),
  patientIds: z.array(uuid).min(1).max(50),
}).strict();

interface ContextRow {
  patientId: string;
  name: string;
  contactPhone: string;
  lastVisitDate: string;
  monthsSinceLastVisit: number;
  lastTreatment: string;
}

export interface ScrubbingMessageDraft {
  patientId: string;
  name: string;
  contactPhone: string;
  lastVisitDate: string;
  monthsSinceLastVisit: number;
  lastTreatment: string;
  suggestedReason: string;
  message: string;
  source: 'ai' | 'fallback';
}

@Injectable()
export class ScrubbingAiService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly minimax: MinimaxAdapter,
  ) {}

  private resolveBranch(
    principal: Principal,
    requested?: string,
  ): string {
    if (
      principal.role !== 'hq' &&
      principal.role !== 'branch_manager'
    ) {
      throw new ForbiddenError(
        'AI Scrubbing is restricted to HQ and branch managers',
      );
    }

    const branchId =
      principal.role === 'hq'
        ? requested
        : principal.branchId;

    if (!branchId) {
      throw new ValidationError({
        branchId: ['Branch mesti dipilih'],
      });
    }

    if (
      principal.role === 'branch_manager' &&
      branchId !== principal.branchId
    ) {
      throw new ForbiddenError(
        'Branch manager cannot access another branch',
      );
    }

    return branchId;
  }

  private reason(
    row: ContextRow,
  ): {
    type: 'long_absence' | 'post_treatment' | 'recall';
    label: string;
  } {
    if (row.monthsSinceLastVisit >= 12) {
      return {
        type: 'long_absence',
        label: 'Pesakit sudah lama tidak hadir',
      };
    }

    if (
      row.lastTreatment &&
      row.lastTreatment.toLowerCase() !==
        'pemeriksaan'
    ) {
      return {
        type: 'post_treatment',
        label: 'Susulan selepas lawatan/rawatan terdahulu',
      };
    }

    return {
      type: 'recall',
      label: 'Recall pemeriksaan berkala',
    };
  }

  private fallback(
    name: string,
    type: string,
  ): string {
    if (type === 'long_absence') {
      return (
        `Assalamualaikum ${name}, kami dari Medini Dental ingin ` +
        `membuat susulan kerana sudah agak lama sejak lawatan terakhir anda. ` +
        `Jika berkelapangan, balas mesej ini dan kami boleh bantu aturkan pemeriksaan.`
      );
    }

    if (type === 'post_treatment') {
      return (
        `Assalamualaikum ${name}, kami dari Medini Dental ingin membuat ` +
        `susulan selepas lawatan anda sebelum ini. Jika ada sebarang pertanyaan ` +
        `atau ingin membuat pemeriksaan susulan, balas mesej ini dan kami akan bantu.`
      );
    }

    return (
      `Assalamualaikum ${name}, kami dari Medini Dental ingin mengingatkan ` +
      `tentang pemeriksaan pergigian berkala. Jika berkelapangan, balas mesej ` +
      `ini dan kami boleh bantu aturkan temujanji.`
    );
  }

  async generateDrafts(
    principal: Principal,
    raw: unknown,
  ): Promise<ScrubbingMessageDraft[]> {
    const parsed = draftInput.safeParse(raw);

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

    const branchId = this.resolveBranch(
      principal,
      input.branchId,
    );

    const ids = [
      ...new Set(input.patientIds),
    ];

    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );

    const rows = await this.dbCtx.runAs(
      principal,
      async (tx) => {
        const result = await tx.execute(sql`
          WITH patient_activity AS (
            SELECT
              p.id AS patientId,
              p.name AS name,

              COALESCE(
                NULLIF(TRIM(p.whatsapp), ''),
                NULLIF(TRIM(p.phone), '')
              ) AS contactPhone,

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
                      COALESCE(
                        e.completed_at,
                        e.started_at
                      )
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
              ) AS lastVisitAt,

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
                'Pemeriksaan'
              ) AS lastTreatment

            FROM patients p

            WHERE p.org_id = ${principal.orgId}
              AND p.branch_id = ${branchId}
              AND p.id IN (${idList})
              AND p.deleted_at IS NULL
              AND p.status <> 'Inactive'

              AND COALESCE(
                NULLIF(TRIM(p.whatsapp), ''),
                NULLIF(TRIM(p.phone), '')
              ) IS NOT NULL
          )

          SELECT
            pa.patientId,
            pa.name,
            pa.contactPhone,

            DATE_FORMAT(
              pa.lastVisitAt,
              '%Y-%m-%d'
            ) AS lastVisitDate,

            TIMESTAMPDIFF(
              MONTH,
              pa.lastVisitAt,
              UTC_TIMESTAMP()
            ) AS monthsSinceLastVisit,

            pa.lastTreatment

          FROM patient_activity pa

          WHERE pa.lastVisitAt >
            TIMESTAMP('1000-01-01 00:00:00')

          AND NOT EXISTS (
            SELECT 1
            FROM appointments future_appt

            WHERE future_appt.org_id =
                ${principal.orgId}

              AND future_appt.branch_id =
                ${branchId}

              AND future_appt.patient_id =
                pa.patientId

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
        `);

        return result.rows as unknown as ContextRow[];
      },
    );

    if (!rows.length) {
      return [];
    }

    const contexts = rows.map(
      (row, index) => {
        const reason = this.reason(row);

        return {
          ref: index,
          months: Number(
            row.monthsSinceLastVisit ?? 0,
          ),
          reasonType: reason.type,
        };
      },
    );

    const generated =
      new Map<number, string>();

    try {
      const reply = await this.minimax.chat(
        [
          'Anda membantu sebuah klinik pergigian menulis mesej WhatsApp follow-up.',
          'Tulis dalam Bahasa Melayu yang mesra, profesional dan ringkas.',
          'Jangan sebut diagnosis, penyakit, prosedur, rawatan khusus atau maklumat klinikal.',
          'Jangan beri nasihat perubatan.',
          'Tujuan mesej hanya untuk susulan dan menawarkan bantuan membuat temujanji.',
          'Gunakan placeholder {{name}} untuk nama pesakit.',
          'Output MESTI JSON array sahaja.',
          'Format: [{"ref":0,"message":"..."}]',
        ].join(' '),

        JSON.stringify(contexts),
      );

      const start = reply.indexOf('[');
      const end = reply.lastIndexOf(']');

      if (start >= 0 && end > start) {
        const data = JSON.parse(
          reply.slice(start, end + 1),
        ) as Array<{
          ref?: unknown;
          message?: unknown;
        }>;

        for (const item of data) {
          const ref = Number(item.ref);

          if (
            Number.isInteger(ref) &&
            typeof item.message === 'string' &&
            item.message.trim()
          ) {
            generated.set(
              ref,
              item.message
                .trim()
                .slice(0, 1500),
            );
          }
        }
      }
    } catch {
      // Fallback di bawah memastikan staff masih boleh preview
      // walaupun provider AI sedang unavailable.
    }

    return rows.map(
      (row, index) => {
        const reason = this.reason(row);

        const aiMessage =
          generated.get(index);

        const message = aiMessage
          ? aiMessage.replace(
              /\{\{name\}\}/gi,
              row.name,
            )
          : this.fallback(
              row.name,
              reason.type,
            );

        return {
          patientId: row.patientId,
          name: row.name,
          contactPhone: row.contactPhone,
          lastVisitDate:
            row.lastVisitDate,
          monthsSinceLastVisit:
            Number(
              row.monthsSinceLastVisit ?? 0,
            ),
          lastTreatment:
            row.lastTreatment ||
            'Pemeriksaan',
          suggestedReason:
            reason.label,
          message,
          source: aiMessage
            ? 'ai'
            : 'fallback',
        };
      },
    );
  }
}
