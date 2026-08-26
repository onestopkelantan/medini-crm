import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql, SQL } from 'drizzle-orm';
import {
  treatmentCosts, TreatmentCost,
  labPayables, LabPayable,
  commissionLedger, CommissionLedger,
  commissionPayouts, CommissionPayout,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';

/**
 * FinanceClinicalRepository — stateless data access for S4-T3:
 * treatment_costs (Finance-owned, links Clinical via read-port), lab_payables,
 * commission_ledger, commission_payouts.
 *
 * RLS applies via the runAs() transaction. org_id server-derived. toDomainError
 * maps unique/check violations (overpayment guard, commission formula) to domain errors.
 */
@Injectable()
export class FinanceClinicalRepository {
  /* ================= TREATMENT_COSTS ================= */
  async createCost(tx: DbClient, orgId: string, input: {
    costCode: string; branchId: string; patientId: string; planId: string;
    encounterId?: string | null; treatmentId?: string | null; description: string;
    quantity: number; unitCost: string; totalCost: string; costDate: string;
    externalRef?: string | null; notes?: string | null;
  }): Promise<TreatmentCost> {
    try {
      const rows = await tx.insert(treatmentCosts).values({
        orgId,
        branchId: input.branchId,
        patientId: input.patientId,
        planId: input.planId,
        encounterId: input.encounterId ?? null,
        treatmentId: input.treatmentId ?? null,
        costCode: input.costCode,
        description: input.description,
        quantity: input.quantity,
        unitCost: input.unitCost,
        totalCost: input.totalCost,
        costDate: input.costDate,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findCostById(tx: DbClient, orgId: string, id: string): Promise<TreatmentCost | null> {
    const rows = await tx.select().from(treatmentCosts)
      .where(and(eq(treatmentCosts.orgId, orgId), eq(treatmentCosts.id, id), isNull(treatmentCosts.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listCosts(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; planId?: string; patientId?: string; limit?: number; offset?: number;
  }): Promise<TreatmentCost[]> {
    const cond: SQL[] = [eq(treatmentCosts.orgId, orgId), isNull(treatmentCosts.deletedAt)];
    if (opts.branchId) cond.push(eq(treatmentCosts.branchId, opts.branchId));
    if (opts.planId) cond.push(eq(treatmentCosts.planId, opts.planId));
    if (opts.patientId) cond.push(eq(treatmentCosts.patientId, opts.patientId));
    return tx.select().from(treatmentCosts).where(and(...cond))
      .orderBy(desc(treatmentCosts.costDate))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  /* Top treatments by revenue (management read-model). */
  async topTreatments(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; limit?: number;
  }): Promise<Array<{ description: string; total: string; volume: number }>> {
    const cond: SQL[] = [eq(treatmentCosts.orgId, orgId), isNull(treatmentCosts.deletedAt)];
    if (opts.branchId) cond.push(eq(treatmentCosts.branchId, opts.branchId));
    return tx.select({
      description: treatmentCosts.description,
      total: sql<string>`COALESCE(SUM(${treatmentCosts.totalCost}), 0)::text`,
      volume: sql<number>`COALESCE(SUM(${treatmentCosts.quantity}), 0)::int`,
    }).from(treatmentCosts).where(and(...cond))
      .groupBy(treatmentCosts.description)
      .orderBy(desc(sql`SUM(${treatmentCosts.totalCost})`))
      .limit(Math.min(Math.max(opts.limit ?? 10, 1), 50));
  }

  /* Doctor gross treatment revenue for commission (sum of their plan costs). */
  async doctorTreatmentRevenue(tx: DbClient, orgId: string, doctorId: string, _period?: string): Promise<string> {
    const rows = await tx.select({
      total: sql<string>`COALESCE(SUM(${treatmentCosts.totalCost}), 0)::text`,
    }).from(treatmentCosts)
      .where(and(
        eq(treatmentCosts.orgId, orgId),
        isNull(treatmentCosts.deletedAt),
        sql`${treatmentCosts.planId} IN (SELECT id FROM treatment_plans WHERE doctor_id = ${doctorId})`,
      ));
    return rows[0]!.total;
  }

  /* ================= LAB_PAYABLES ================= */
  async createLabPayable(tx: DbClient, orgId: string, input: {
    labCode: string; branchId: string; labName: string; treatmentCostId?: string | null;
    caseRef?: string | null; externalInvoiceRef?: string | null; amount: string;
    paidAmount?: string; outstandingAmount: string; dueDate: string; status?: string;
    externalRef?: string | null; notes?: string | null;
  }): Promise<LabPayable> {
    try {
      const rows = await tx.insert(labPayables).values({
        orgId,
        branchId: input.branchId,
        treatmentCostId: input.treatmentCostId ?? null,
        labCode: input.labCode,
        labName: input.labName,
        caseRef: input.caseRef ?? null,
        externalInvoiceRef: input.externalInvoiceRef ?? null,
        amount: input.amount,
        paidAmount: input.paidAmount ?? '0',
        outstandingAmount: input.outstandingAmount,
        dueDate: input.dueDate,
        status: (input.status as LabPayable['status']) ?? 'DRAFT',
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findLabPayableById(tx: DbClient, orgId: string, id: string): Promise<LabPayable | null> {
    const rows = await tx.select().from(labPayables)
      .where(and(eq(labPayables.orgId, orgId), eq(labPayables.id, id), isNull(labPayables.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listLabPayables(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; status?: string; limit?: number; offset?: number;
  }): Promise<LabPayable[]> {
    const cond: SQL[] = [eq(labPayables.orgId, orgId), isNull(labPayables.deletedAt)];
    if (opts.branchId) cond.push(eq(labPayables.branchId, opts.branchId));
    if (opts.status) cond.push(eq(labPayables.status, opts.status as LabPayable['status']));
    return tx.select().from(labPayables).where(and(...cond))
      .orderBy(labPayables.dueDate)
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  /* Apply a payment — updates paid/outstanding/status atomically (caller validates). */
  async applyLabPayment(tx: DbClient, orgId: string, id: string, input: {
    paidAmount: string; outstandingAmount: string; status: LabPayable['status'];
  }): Promise<LabPayable | null> {
    try {
      const rows = await tx.update(labPayables).set({
        paidAmount: input.paidAmount,
        outstandingAmount: input.outstandingAmount,
        status: input.status,
        updatedAt: new Date(),
      }).where(and(eq(labPayables.orgId, orgId), eq(labPayables.id, id), isNull(labPayables.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }

  async updateLabPayableStatus(tx: DbClient, orgId: string, id: string, status: LabPayable['status']): Promise<LabPayable | null> {
    const rows = await tx.update(labPayables).set({ status, updatedAt: new Date() })
      .where(and(eq(labPayables.orgId, orgId), eq(labPayables.id, id), isNull(labPayables.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /* ================= COMMISSION_LEDGER ================= */
  async createCommission(tx: DbClient, orgId: string, input: {
    commissionCode: string; branchId: string; doctorId: string; period: string;
    grossRevenue: string; eligibleDirectCosts: string; commissionBase: string; rate: string;
    commissionAmount: string; adjustment?: string; netPayable: string; paidAmount?: string;
    outstandingAmount: string; status?: string; externalRef?: string | null; notes?: string | null;
  }): Promise<CommissionLedger> {
    try {
      const rows = await tx.insert(commissionLedger).values({
        orgId,
        branchId: input.branchId,
        doctorId: input.doctorId,
        commissionCode: input.commissionCode,
        period: input.period,
        grossRevenue: input.grossRevenue,
        eligibleDirectCosts: input.eligibleDirectCosts,
        commissionBase: input.commissionBase,
        rate: input.rate,
        commissionAmount: input.commissionAmount,
        adjustment: input.adjustment ?? '0',
        netPayable: input.netPayable,
        paidAmount: input.paidAmount ?? '0',
        outstandingAmount: input.outstandingAmount,
        status: (input.status as CommissionLedger['status']) ?? 'calculated',
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findCommissionById(tx: DbClient, orgId: string, id: string): Promise<CommissionLedger | null> {
    const rows = await tx.select().from(commissionLedger)
      .where(and(eq(commissionLedger.orgId, orgId), eq(commissionLedger.id, id), isNull(commissionLedger.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /* Idempotency: one ledger row per doctor+period (final guard = service check). */
  async findCommissionByDoctorPeriod(tx: DbClient, orgId: string, doctorId: string, period: string): Promise<CommissionLedger | null> {
    const rows = await tx.select().from(commissionLedger)
      .where(and(
        eq(commissionLedger.orgId, orgId),
        eq(commissionLedger.doctorId, doctorId),
        eq(commissionLedger.period, period),
        isNull(commissionLedger.deletedAt),
      )).limit(1);
    return rows[0] ?? null;
  }

  async listCommissions(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; doctorId?: string; period?: string; status?: string; limit?: number; offset?: number;
  }): Promise<CommissionLedger[]> {
    const cond: SQL[] = [eq(commissionLedger.orgId, orgId), isNull(commissionLedger.deletedAt)];
    if (opts.branchId) cond.push(eq(commissionLedger.branchId, opts.branchId));
    if (opts.doctorId) cond.push(eq(commissionLedger.doctorId, opts.doctorId));
    if (opts.period) cond.push(eq(commissionLedger.period, opts.period));
    if (opts.status) cond.push(eq(commissionLedger.status, opts.status as CommissionLedger['status']));
    return tx.select().from(commissionLedger).where(and(...cond))
      .orderBy(desc(commissionLedger.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  /* Optimistic-locking status transition (version guard). */
  async updateCommissionStatus(tx: DbClient, orgId: string, id: string, expectedVersion: number, status: CommissionLedger['status']): Promise<CommissionLedger | null> {
    const rows = await tx.update(commissionLedger)
      .set({ status, updatedAt: new Date(), version: sql`${commissionLedger.version} + 1` })
      .where(and(
        eq(commissionLedger.orgId, orgId),
        eq(commissionLedger.id, id),
        eq(commissionLedger.version, expectedVersion),
        isNull(commissionLedger.deletedAt),
      )).returning();
    return rows[0] ?? null;
  }

  /* ================= COMMISSION_PAYOUTS ================= */
  async createPayout(tx: DbClient, orgId: string, input: {
    branchId: string; commissionLedgerId: string; payoutDate: string; amount: string;
    method?: string | null; externalRef?: string | null; notes?: string | null;
  }): Promise<CommissionPayout> {
    try {
      const rows = await tx.insert(commissionPayouts).values({
        orgId,
        branchId: input.branchId,
        commissionLedgerId: input.commissionLedgerId,
        payoutDate: input.payoutDate,
        amount: input.amount,
        method: input.method ?? null,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async listPayoutsForLedger(tx: DbClient, orgId: string, ledgerId: string): Promise<CommissionPayout[]> {
    return tx.select().from(commissionPayouts)
      .where(and(
        eq(commissionPayouts.orgId, orgId),
        eq(commissionPayouts.commissionLedgerId, ledgerId),
        isNull(commissionPayouts.deletedAt),
      )).orderBy(desc(commissionPayouts.payoutDate));
  }

  /**
   * P1-1 — Atomically apply a commission payout via a SINGLE guarded UPDATE.
   * The increment + overpayment guard are one SQL statement, so two concurrent
   * payouts serialize on the row and the loser matches 0 rows → clean 409
   * (never a raw 500 / negative outstanding / deadlock). Status computed in-SQL
   * (paid when outstanding reaches 0). Returns null on guard mismatch.
   */
  async lockCommissionForUpdate(tx: DbClient, orgId: string, id: string): Promise<CommissionLedger | null> {
    const rows = await tx.select().from(commissionLedger)
      .where(and(eq(commissionLedger.orgId, orgId), eq(commissionLedger.id, id), isNull(commissionLedger.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /* P1-1 — persist the post-payout ledger state (paid/outstanding/status) atomically. */
  async applyCommissionPayoutToLedger(tx: DbClient, orgId: string, id: string, payment: string): Promise<CommissionLedger | null> {
    try {
      const rows = (await tx.execute(sql`
        UPDATE commission_ledger
        SET
          paid_amount = paid_amount + ${payment}::numeric,
          outstanding_amount = net_payable - (paid_amount + ${payment}::numeric),
          status = CASE
            WHEN (net_payable - (paid_amount + ${payment}::numeric)) <= 0 THEN 'paid'::commission_status
            ELSE status
          END,
          version = version + 1,
          updated_at = now()
        WHERE org_id = ${orgId}
          AND id = ${id}
          AND deleted_at IS NULL
          AND status != 'cancelled'
          AND status != 'paid'
          AND (paid_amount + ${payment}::numeric) <= net_payable
        RETURNING *
      `)) as unknown as { rows: CommissionLedger[] };
      return rows.rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }

  /**
   * P1-3 — Atomic lab payment via a SINGLE guarded UPDATE. The increment and
   * the overpayment guard are one SQL statement, so two concurrent payments
   * serialize on the row and the losing request matches 0 rows → clean 409
   * (never a raw DB error / negative outstanding). The DB check constraints
   * remain the final backstop.
   */
  async applyLabPaymentAtomic(tx: DbClient, orgId: string, id: string, payment: string): Promise<LabPayable | null> {
    try {
      const rows = (await tx.execute(sql`
        UPDATE lab_payables
        SET
          paid_amount = paid_amount + ${payment}::numeric,
          outstanding_amount = amount - (paid_amount + ${payment}::numeric),
          status = CASE
            WHEN (paid_amount + ${payment}::numeric) >= amount THEN 'PAID'::lab_payable_status
            ELSE 'PARTIALLY_PAID'::lab_payable_status
          END,
          updated_at = now()
        WHERE org_id = ${orgId}
          AND id = ${id}
          AND deleted_at IS NULL
          AND status IN ('OUTSTANDING', 'PARTIALLY_PAID')
          AND (paid_amount + ${payment}::numeric) <= amount
        RETURNING *
      `)) as unknown as { rows: LabPayable[] };
      return rows.rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }
}
