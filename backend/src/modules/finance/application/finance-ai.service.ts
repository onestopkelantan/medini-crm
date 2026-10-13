import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';
import { AiPolicyPort } from '../../../shared/ports/ai-policy.port';
import {
  escalationKey,
  draftReminder,
  type OverdueInstallment,
  type EscalationDraft,
} from '../domain/escalation-rules';

/**
 * Finance AI — Fasa D: collection escalation SCAN.
 *
 * The engine behind the `finance-ai` agent (the last of the four mentor
 * agents to get one). DATA → LADDER → DRAFT → APPROVAL QUEUE:
 *
 *   overdue installments (payment_plan_schedules, status refreshed on read)
 *     → escalation-rules.ts decides tier + drafts the BM template
 *     → recordApproval() writes ONE queue row per (installment × tier)
 *     → a human approves; nothing is ever sent automatically.
 *
 * No MiniMax call in this phase: the templates are deterministic and
 * test-guaranteed polite. (A "refine draft" model pass can be added later
 * without changing this flow — the queue row is the seam.)
 *
 * HQ-only, like every group-level finance surface in this module.
 */
@Injectable()
export class FinanceAiService {
  private readonly logger = new Logger('FinanceAI');

  constructor(
    private readonly policy: AiPolicyPort,
    private readonly dbCtx: DbContextService,
  ) {}

  async scanOverdue(principal: Principal): Promise<{
    scanned: number;
    drafted: number;
    skippedExisting: number;
    staffTasks: number;
  }> {
    if (principal.role !== 'hq') throw new ForbiddenError('Finance AI escalation is HQ-only');

    /* POLICY GATE — same order as the analyst: refuse before ANY data read. */
    const allowed = await this.policy.canDraft(principal, {
      agentKey: 'finance-ai',
      domain: 'finance',
      actionKey: 'finance.escalate',
    });
    if (!allowed) {
      throw new ForbiddenError('Agen Finance AI tidak aktif (paused/registered) di AI Manager');
    }

    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    return this.dbCtx.runAs(principal, async (tx) => {
      /* 1. Same read-time refresh the PaymentPlanService.list() performs, so
       *    this scan and the Balances tab agree on what "overdue" means. */
      await tx.execute(sql`
        UPDATE payment_plan_schedules s
        JOIN payment_plans pp ON pp.id = s.payment_plan_id
        SET s.status = 'overdue', s.updated_at = NOW(6)
        WHERE s.status = 'pending' AND s.due_date < DATE(${todayIso})
          AND pp.org_id = ${principal.orgId} AND pp.deleted_at IS NULL
      `);

      /* 2. Fetch overdue installments with patient context + opt-out flag.
       *    Waived/paid are excluded by status. Only ACTIVE plans escalate.
       *    plan identification = plan_title_snapshot (payment_plans carries
       *    no code column); opt-out = row exists with revoked_at NULL. */
      const result = await tx.execute(sql`
        SELECT s.payment_plan_id AS planId,
               CAST(s.installment_no AS SIGNED) AS installmentNo,
               s.amount AS amount,
               s.due_date AS dueDate,
               DATEDIFF(DATE(${todayIso}), s.due_date) AS daysOverdue,
               pp.patient_id AS patientId,
               pt.name AS patientName,
               pt.whatsapp AS patientPhone,
               pp.plan_title_snapshot AS planTitle,
               (SELECT COUNT(*) FROM wa_opt_outs o
                 WHERE o.org_id = ${principal.orgId}
                   AND o.phone = pt.whatsapp
                   AND o.revoked_at IS NULL
                   AND o.deleted_at IS NULL) AS optedOut
        FROM payment_plan_schedules s
        JOIN payment_plans pp ON pp.id = s.payment_plan_id
        LEFT JOIN patients pt ON pt.id = pp.patient_id
        WHERE pp.org_id = ${principal.orgId}
          AND pp.deleted_at IS NULL
          AND pp.status = 'active'
          AND s.status = 'overdue'
          AND s.deleted_at IS NULL
        ORDER BY s.due_date ASC
        LIMIT 500
      `);
      const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];

      /* 3. Existing pending queue rows for this action — the idempotency
       *    check. A rescan must not stack duplicates.
       *    NOTE: this table has NO deleted_at (append-only governance log);
       *    status is the lifecycle. */
      const existing = await tx.execute(sql`
        SELECT payload FROM ai_approval_requests
        WHERE org_id = ${principal.orgId}
          AND agent_key = 'finance-ai'
          AND action_key = 'finance.escalate'
          AND status = 'pending'
      `);
      const existingRows = (existing as unknown as { rows: Array<{ payload: unknown }> }).rows ?? [];
      const seen = new Set<string>();
      for (const r of existingRows) {
        const p = r.payload as { escalationKey?: string } | null;
        if (p?.escalationKey) seen.add(p.escalationKey);
      }

      let drafted = 0;
      let skippedExisting = 0;
      let staffTasks = 0;

      for (const row of rows) {
        const installment: OverdueInstallment = {
          planId: String(row['planId']),
          installmentNo: Number(row['installmentNo']),
          daysOverdue: Number(row['daysOverdue']),
          amount: String(row['amount'] ?? '0'),
          dueDate: String(row['dueDate']).slice(0, 10),
          patientId: String(row['patientId'] ?? ''),
          patientName: String(row['patientName'] ?? 'Pesakit'),
          patientPhone: row['patientPhone'] ? String(row['patientPhone']) : null,
          planCode: String(row['planTitle'] ?? ''),
          optedOut: Number(row['optedOut'] ?? 0) > 0,
        };

        const draft: EscalationDraft | null = draftReminder(installment);
        if (!draft) continue; /* not actually overdue (defensive) */

        const key = escalationKey(installment);
        if (seen.has(key)) { skippedExisting++; continue; }

        await this.policy.recordApproval(principal, {
          agentKey: 'finance-ai',
          domain: 'finance',
          actionKey: 'finance.escalate',
          reason: `Ansuran tertunggak ${installment.daysOverdue} hari (${draft.tier}) — pelan ${installment.planCode} #${installment.installmentNo}`,
          payload: {
            escalationKey: key,
            tier: draft.tier,
            toStaff: draft.toStaff,
            channel: draft.toStaff ? 'staff-task' : 'whatsapp-draft',
            to: installment.patientPhone,
            patientId: installment.patientId,
            patientName: installment.patientName,
            planCode: installment.planCode,
            installmentNo: installment.installmentNo,
            amount: installment.amount,
            dueDate: installment.dueDate,
            daysOverdue: installment.daysOverdue,
            body: draft.body,
          },
        });
        seen.add(key);
        drafted++;
        if (draft.toStaff) staffTasks++;
      }

      this.logger.log(
        `Imbasan kutipan: ${rows.length} ansuran tertunggak · ${drafted} draf baharu · ${skippedExisting} sedia ada dilangkau`,
      );
      return { scanned: rows.length, drafted, skippedExisting, staffTasks };
    });
  }
}
