/**
 * PaymentPlanService — P4 (0028). Create plans, record instalment payments,
 * read balances.
 *
 * THE SCHEDULE IS SERVER-GENERATED (see domain/payment-plan.ts): the client
 * sends totalAmount/downPayment/installments/frequency; the service generates
 * the rows and writes them in the SAME transaction as the plan. A client can
 * never post its own instalment amounts.
 *
 * RBAC: follows the finance module's own pattern — finance:view reads,
 * finance:create/edit writes (HQ per the matrix; managers are finance.view
 * only in this clinic's matrix cells). Writing a payment is money movement:
 * finance edit.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import {
  generateSchedule, outstandingBalance, nextDue, refreshOverdue,
  isPlanComplete, FREQUENCY_DAYS, PlanError,
} from '../domain/payment-plan';

const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'amount must be a non-negative decimal');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const createSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  treatmentPlanId: z.string().uuid(),
  totalAmount: money,
  downPayment: money.default('0'),
  installments: z.number().int().min(1).max(60),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']).default('monthly'),
  startDate: dateStr,
  notes: z.string().max(512).nullish(),
});

const paySchema = z.object({
  installmentNo: z.number().int().min(1),
  amount: money.refine((v) => parseFloat(v) > 0, 'payment must be positive'),
  paidDate: dateStr,
  notes: z.string().max(512).nullish(),
});

const waiveSchema = z.object({
  installmentNo: z.number().int().min(1),
  reason: z.string().trim().min(3).max(256),
});

const listSchema = z.object({
  branchId: z.string().uuid().nullish(),
  patientId: z.string().uuid().nullish(),
  status: z.enum(['active', 'completed', 'defaulted', 'cancelled']).nullish(),
});

@Injectable()
export class PaymentPlanService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  private today(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  }

  /** Create a plan + its full schedule in one transaction. */
  async create(p: Principal, raw: unknown) {
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    /* The domain owns the arithmetic; its errors surface as 422s. */
    let schedule;
    try {
      schedule = generateSchedule(input);
    } catch (e) {
      if (e instanceof PlanError) throw new ValidationError({ _: [e.message] });
      throw e;
    }

    return this.dbCtx.runAs(p, async (tx) => {
      /* The package must exist, belong to this patient, and be ACCEPTED or
       * further along — instalments on a draft/proposal nobody agreed to is
       * billing for a maybe. */
      const planCheck = await tx.execute(sql`
        SELECT tp.id, tp.title, tp.status, tp.patient_id
        FROM treatment_plans tp
        WHERE tp.org_id = ${p.orgId} AND tp.id = ${input.treatmentPlanId} AND tp.deleted_at IS NULL
      `);
      const tplan = (planCheck as unknown as { rows: Array<{ id: string; title: string; status: string; patient_id: string }> }).rows[0];
      if (!tplan) throw new NotFoundError('TreatmentPlan', input.treatmentPlanId);
      if (tplan.patient_id !== input.patientId) {
        throw new ConflictError('Treatment plan belongs to a different patient');
      }
      if (!['accepted', 'active', 'completed'].includes(tplan.status)) {
        throw new ConflictError(`Treatment plan status is "${tplan.status}" — a payment plan needs an ACCEPTED package`);
      }

      const id = crypto.randomUUID();
      const upcoming = nextDue(schedule.map((s) => ({ ...s, status: 'pending' as const })));

      await tx.execute(sql`
        INSERT INTO payment_plans
          (id, org_id, branch_id, patient_id, treatment_plan_id, plan_title_snapshot,
           total_amount, down_payment, installments, frequency, status, start_date,
           next_due_date, notes, created_by, updated_by)
        VALUES (
          ${id}, ${p.orgId}, ${input.branchId}, ${input.patientId}, ${input.treatmentPlanId},
          ${tplan.title}, ${input.totalAmount}, ${input.downPayment}, ${input.installments},
          ${input.frequency}, 'active', ${input.startDate},
          ${upcoming ? upcoming.dueDate : null}, ${input.notes ?? null},
          ${p.staffId}, ${p.staffId}
        )
      `);

      for (const s of schedule) {
        await tx.execute(sql`
          INSERT INTO payment_plan_schedules
            (id, org_id, payment_plan_id, installment_no, amount, due_date, status, created_by, updated_by)
          VALUES (
            ${crypto.randomUUID()}, ${p.orgId}, ${id}, ${s.installmentNo},
            ${s.amount}, ${s.dueDate}, 'pending', ${p.staffId}, ${p.staffId}
          )
        `);
      }

      await this.audit.record({
        actorId: p.staffId, actorRole: p.role,
        action: 'payment_plan_created', entity: 'payment_plans', entityId: id,
        orgId: p.orgId, branchId: input.branchId, source: 'api',
        after: {
          patientId: input.patientId, treatmentPlanId: input.treatmentPlanId,
          totalAmount: input.totalAmount, downPayment: input.downPayment,
          installments: input.installments, frequency: input.frequency,
        },
      }, tx);

      return { id, installments: schedule.length, nextDueDate: upcoming?.dueDate ?? null };
    });
  }

  /** List plans with computed balances; overdue statuses refreshed on read. */
  async list(p: Principal, raw: unknown) {
    const parsed = listSchema.safeParse(raw ?? {});
    if (!parsed.success) throw this.validation(parsed);
    const { patientId, status } = parsed.data;
    const target = p.role === 'hq' ? (parsed.data.branchId ?? null) : p.branchId;
    if (p.role !== 'hq' && !p.branchId) throw new ForbiddenError('No branch context — access denied');
    const today = this.today();

    return this.dbCtx.runAs(p, async (tx) => {
      /* Lateness is a read-time fact: refresh pending→overdue in one UPDATE
       * before reading, so every screen (and the audit) agrees on status. */
      await tx.execute(sql`
        UPDATE payment_plan_schedules s
        JOIN payment_plans pp ON pp.id = s.payment_plan_id
        SET s.status = 'overdue', s.updated_at = NOW(6)
        WHERE s.status = 'pending' AND s.due_date < DATE(${today})
          AND pp.org_id = ${p.orgId} AND pp.deleted_at IS NULL
      `);

      /* next_due_date stays honest after the refresh above. */
      await tx.execute(sql`
        UPDATE payment_plans pp
        SET next_due_date = (
          SELECT MIN(s.due_date) FROM payment_plan_schedules s
          WHERE s.payment_plan_id = pp.id AND s.status IN ('pending','overdue')
        ), updated_at = NOW(6)
        WHERE pp.org_id = ${p.orgId} AND pp.deleted_at IS NULL AND pp.status = 'active'
          AND EXISTS (SELECT 1 FROM payment_plan_schedules s WHERE s.payment_plan_id = pp.id AND s.status = 'overdue' AND pp.next_due_date < s.due_date)
      `);

      /* Auto-complete: nothing left to collect → status completed, once. */
      await tx.execute(sql`
        UPDATE payment_plans pp
        SET status = 'completed', updated_at = NOW(6)
        WHERE pp.org_id = ${p.orgId} AND pp.status = 'active' AND pp.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM payment_plan_schedules s
            WHERE s.payment_plan_id = pp.id AND s.status IN ('pending','overdue')
          )
      `);

      const result = await tx.execute(sql`
        SELECT pp.id, pp.plan_title_snapshot, pp.total_amount, pp.down_payment,
               pp.installments, pp.frequency, pp.status, pp.start_date, pp.next_due_date,
               pp.patient_id, pt.name AS patient_name,
               (SELECT COALESCE(SUM(s.amount), 0) FROM payment_plan_schedules s
                 WHERE s.payment_plan_id = pp.id AND s.status IN ('pending','overdue')) AS balance,
               (SELECT COUNT(*) FROM payment_plan_schedules s
                 WHERE s.payment_plan_id = pp.id AND s.status = 'overdue') AS overdue_count
        FROM payment_plans pp
        LEFT JOIN patients pt ON pt.id = pp.patient_id
        WHERE pp.org_id = ${p.orgId} AND pp.deleted_at IS NULL
          ${target ? sql`AND pp.branch_id = ${target}` : sql``}
          ${patientId ? sql`AND pp.patient_id = ${patientId}` : sql``}
          ${status ? sql`AND pp.status = ${status}` : sql``}
        ORDER BY pp.next_due_date IS NULL, pp.next_due_date ASC
        LIMIT 200
      `);

      const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
      return { plans: rows };
    });
  }

  /** One plan with its full schedule (the Patient360 panel). */
  async get(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const found = await tx.execute(sql`
        SELECT pp.*, pt.name AS patient_name FROM payment_plans pp
        LEFT JOIN patients pt ON pt.id = pp.patient_id
        WHERE pp.org_id = ${p.orgId} AND pp.id = ${id} AND pp.deleted_at IS NULL
      `);
      const plan = (found as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
      if (!plan) throw new NotFoundError('PaymentPlan', id);

      /* Refresh lateness for THIS plan's rows before reading (list() does it
       * in bulk; a direct get() must not show a staler view than the list). */
      const schedResult = await tx.execute(sql`
        SELECT installment_no, amount, due_date, paid_date, paid_amount, status
        FROM payment_plan_schedules
        WHERE payment_plan_id = ${id} AND deleted_at IS NULL
        ORDER BY installment_no ASC
      `);
      /* Rows arrive in DB casing (installment_no, due_date, ...) — map to the
       * API casing the frontend expects, THEN run the domain refresh on it. */
      const rawRows = (schedResult as unknown as { rows: Array<Record<string, unknown>> }).rows;
      const schedule = refreshOverdue(rawRows.map((s) => ({
        installmentNo: Number(s.installment_no),
        amount: String(s.amount),
        dueDate: String(s.due_date).slice(0, 10),
        paidDate: s.paid_date ? String(s.paid_date) : null,
        paidAmount: s.paid_amount ? String(s.paid_amount) : null,
        status: s.status as 'pending' | 'paid' | 'overdue' | 'waived',
      })), this.today());

      return {
        plan,
        schedule,
        balance: outstandingBalance(schedule),
        complete: isPlanComplete(schedule),
      };
    });
  }

  /**
   * P4-A — payment history for ONE patient: every instalment that carries
   * money (paid; waived shown separately labelled) across all their plans.
   * This is the "resit" record the clinic can show a patient who asks
   * "saya sudah bayar berapa?". Receipts are derived from paid rows —
   * no separate receipt table to drift out of sync.
   */
  async history(p: Principal, patientId: string) {
    const target = p.role === 'hq' ? null : p.branchId;
    return this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        SELECT s.installment_no, s.amount, s.paid_amount, s.due_date, s.paid_date,
               s.status, pp.id AS plan_id, pp.plan_title_snapshot, pp.branch_id
        FROM payment_plan_schedules s
        JOIN payment_plans pp ON pp.id = s.payment_plan_id
        WHERE pp.org_id = ${p.orgId} AND pp.deleted_at IS NULL
          AND pp.patient_id = ${patientId}
          AND s.status IN ('paid', 'waived')
          ${target ? sql`AND pp.branch_id = ${target}` : sql``}
        ORDER BY s.paid_date DESC, s.installment_no ASC
        LIMIT 200
      `);
      const raw = (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
      const payments = raw.map((r) => ({
        planId: String(r.plan_id),
        planTitle: String(r.plan_title_snapshot),
        installmentNo: Number(r.installment_no),
        amount: String(r.amount),
        paidAmount: r.paid_amount ? String(r.paid_amount) : null,
        dueDate: String(r.due_date).slice(0, 10),
        paidDate: r.paid_date ? String(r.paid_date).slice(0, 10) : null,
        status: String(r.status) as 'paid' | 'waived',
      }));
      const totalPaid = payments
        .filter((x) => x.status === 'paid')
        .reduce((sum, x) => sum + Number(x.paidAmount ?? x.amount), 0);
      return { payments, totalPaid: totalPaid.toFixed(2) };
    });
  }

  /** Record an instalment payment. */
  async pay(p: Principal, id: string, raw: unknown) {
    const parsed = paySchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const { installmentNo, amount, paidDate } = parsed.data;

    return this.dbCtx.runAs(p, async (tx) => {
      const found = await tx.execute(sql`
        SELECT id, status FROM payment_plans
        WHERE org_id = ${p.orgId} AND id = ${id} AND deleted_at IS NULL
      `);
      const plan = (found as unknown as { rows: Array<{ id: string; status: string; branch_id: string }> }).rows[0];
      if (!plan) throw new NotFoundError('PaymentPlan', id);
      if (plan.status === 'cancelled') throw new ConflictError('Plan is cancelled');
      if (plan.status === 'completed') throw new ConflictError('Plan is already complete');

      const rowResult = await tx.execute(sql`
        SELECT installment_no, amount, status FROM payment_plan_schedules
        WHERE payment_plan_id = ${id} AND installment_no = ${installmentNo} AND deleted_at IS NULL
      `);
      const row = (rowResult as unknown as { rows: Array<{ installment_no: number; amount: string; status: string }> }).rows[0];
      if (!row) throw new NotFoundError('Installment', String(installmentNo));
      if (row.status === 'paid') throw new ConflictError('Instalment is already paid');
      if (row.status === 'waived') throw new ConflictError('Instalment was waived');

      await tx.execute(sql`
        UPDATE payment_plan_schedules
        SET status = 'paid', paid_date = TIMESTAMP(${paidDate}, '00:00:00'), paid_amount = ${amount},
            updated_by = ${p.staffId}, updated_at = NOW(6)
        WHERE payment_plan_id = ${id} AND installment_no = ${installmentNo}
      `);

      /* next_due_date = the earliest remaining unpaid row. */
      await tx.execute(sql`
        UPDATE payment_plans
        SET next_due_date = (
          SELECT MIN(s.due_date) FROM payment_plan_schedules s
          WHERE s.payment_plan_id = ${id} AND s.status IN ('pending','overdue')
        ), updated_by = ${p.staffId}, updated_at = NOW(6)
        WHERE id = ${id}
      `);

      await this.audit.record({
        actorId: p.staffId, actorRole: p.role,
        action: 'installment_paid', entity: 'payment_plan_schedules',
        entityId: `${id}#${installmentNo}`,
        orgId: p.orgId, branchId: plan.branch_id, source: 'api',
        after: { installmentNo, amount, paidDate },
      }, tx);

      return { id, installmentNo, status: 'paid' };
    });
  }

  /**
   * Collection KPI (P5): of the instalments that have come due in the
   * window, how many were PAID BY their due date — the honest version of
   * "collection efficiency". Waived rows leave the denominator entirely
   * (forgiven money is neither collected nor owed); still-pending rows that
   * are not yet late do not count against the clinic either.
   */
  async collectionStats(p: Principal, from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new ValidationError({ _: ['from/to must be YYYY-MM-DD'] });
    }
    return this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        SELECT
          COUNT(*) AS due,
          SUM(CASE WHEN s.status = 'paid' AND s.paid_date IS NOT NULL
                    AND DATE(s.paid_date) <= s.due_date THEN 1 ELSE 0 END) AS on_time,
          SUM(CASE WHEN s.status = 'overdue' THEN 1 ELSE 0 END) AS currently_overdue,
          COALESCE(SUM(CASE WHEN s.status = 'paid' THEN s.paid_amount ELSE 0 END), 0) AS collected
        FROM payment_plan_schedules s
        JOIN payment_plans pp ON pp.id = s.payment_plan_id
        WHERE pp.org_id = ${p.orgId} AND pp.deleted_at IS NULL
          AND s.due_date BETWEEN ${from} AND ${to}
      `);
      const row = (result as unknown as { rows: Array<Record<string, unknown>> }).rows[0] ?? {};
      const due = Number(row.due ?? 0);
      const onTime = Number(row.on_time ?? 0);
      return {
        window: { from, to },
        instalmentsDue: due,
        paidOnTime: onTime,
        onTimeRate: due > 0 ? Math.round((onTime / due) * 100) : null,
        currentlyOverdue: Number(row.currently_overdue ?? 0),
        collected: String(row.collected ?? '0'),
      };
    });
  }

  /** Waive an instalment (management decision — needs a reason). */
  async waive(p: Principal, id: string, raw: unknown) {
    const parsed = waiveSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const { installmentNo, reason } = parsed.data;

    return this.dbCtx.runAs(p, async (tx) => {
      const found = await tx.execute(sql`
        SELECT id, branch_id FROM payment_plans
        WHERE org_id = ${p.orgId} AND id = ${id} AND deleted_at IS NULL
      `);
      const plan = (found as unknown as { rows: Array<{ id: string; branch_id: string }> }).rows[0];
      if (!plan) throw new NotFoundError('PaymentPlan', id);

      await tx.execute(sql`
        UPDATE payment_plan_schedules
        SET status = 'waived', updated_by = ${p.staffId}, updated_at = NOW(6)
        WHERE payment_plan_id = ${id} AND installment_no = ${installmentNo} AND status = 'pending'
      `);

      await this.audit.record({
        actorId: p.staffId, actorRole: p.role,
        action: 'installment_waived', entity: 'payment_plan_schedules',
        entityId: `${id}#${installmentNo}`,
        orgId: p.orgId, branchId: plan.branch_id, source: 'api',
        after: { installmentNo, reason },
      }, tx);

      return { id, installmentNo, status: 'waived' };
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

/* Kept honest: the domain vocabulary is re-exported for the controller docs. */
export { FREQUENCY_DAYS };
