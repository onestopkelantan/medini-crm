import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import { FinanceClinicalRepository } from '../infrastructure/finance-clinical.repository';
import { ClinicalReadPort } from '../../../shared/ports/clinical.read-port';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import {
  canTransitionLabPayable,
} from '../domain/lab-payable-lifecycle';
import { canTransitionCommission } from '../domain/commission-status';
import {
  computeCommission, sumEligibleDirectCosts, COMMISSION_CONFIG,
} from '../domain/commission-engine';
import {
  TreatmentCost, LabPayable, CommissionLedger, CommissionPayout,
} from '../../../infrastructure/database/schema';

const moneySchema = z.string().regex(/^\d+(\.\d{1,4})?$/, 'amount must be a non-negative decimal');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const createCostSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  planId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  treatmentId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(256),
  quantity: z.number().int().positive().default(1),
  unitCost: moneySchema,
  costDate: dateSchema,
  externalRef: z.string().max(128).nullish(),
  notes: z.string().max(512).nullish(),
});

const createLabPayableSchema = z.object({
  branchId: z.string().uuid(),
  treatmentCostId: z.string().uuid().nullish(),
  labName: z.string().trim().min(1).max(256),
  caseRef: z.string().max(128).nullish(),
  externalInvoiceRef: z.string().max(128).nullish(),
  amount: moneySchema,
  dueDate: dateSchema,
  externalRef: z.string().max(128).nullish(),
  notes: z.string().max(512).nullish(),
});

const labPaymentSchema = z.object({
  amount: moneySchema.refine((v) => parseFloat(v) > 0, 'payment amount must be positive'),
});

const labStatusSchema = z.object({
  status: z.enum(['DRAFT', 'OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'VOID']),
});

const commissionCalcSchema = z.object({
  branchId: z.string().uuid(),
  doctorId: z.string().uuid(),
  period: z.string().trim().min(1).max(32),
  grossRevenue: moneySchema,
  costsByCategory: z.record(z.string(), moneySchema).default({}),
  adjustment: moneySchema.optional(),
  externalRef: z.string().max(128).nullish(),
  notes: z.string().max(512).nullish(),
});

const commissionStatusSchema = z.object({
  status: z.enum(['calculated', 'pending_review', 'approved', 'scheduled', 'paid', 'cancelled']),
  version: z.number().int().positive(),
});

const payoutSchema = z.object({
  payoutDate: dateSchema,
  amount: moneySchema.refine((v) => parseFloat(v) > 0, 'payout amount must be positive'),
  method: z.string().max(32).nullish(),
  externalRef: z.string().max(128).nullish(),
  notes: z.string().max(512).nullish(),
});

/**
 * ClinicalFinanceService — S4-T3: treatment costs, lab payables, commission.
 *
 * Clinical owns the Treatment Case; Finance owns the financial cost record.
 * Plan/encounter/patient references are validated through ClinicalReadPort
 * (READ-ONLY) — Finance NEVER mutates clinical tables.
 *
 * Commission Engine is the CRM source of truth for doctor commission
 * (LOCKED formula, default rate 0.40, doctor-only beneficiary, eligible
 * direct costs = Lab Cost / X-Ray / Add-on only).
 *
 * Scope: hq=org-wide, branch_manager=own branch. Writes hq/bm. Audit same-tx.
 */
@Injectable()
export class ClinicalFinanceService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: FinanceClinicalRepository,
    private readonly clinical: ClinicalReadPort,
    private readonly audit: AuditService,
  ) {}

  private assertCanAccess(p: Principal): void {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Finance access is restricted to HQ and branch managers');
    }
  }

  private resolveBranch(p: Principal, requested: string): string {
    if (p.role === 'hq') return requested;
    if (p.branchId && requested !== p.branchId) {
      throw new ForbiddenError('Branch manager cannot write outside own branch');
    }
    return requested;
  }

  private scopedBranch(p: Principal, requested?: string | null): string | null {
    if (p.role === 'hq') return requested ?? null;
    return p.branchId;
  }

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }

  private round4(n: number): string {
    return (Math.round(n * 10000) / 10000).toFixed(4);
  }

  /* ================= TREATMENT COST ================= */
  async createTreatmentCost(principal: Principal, raw: unknown): Promise<TreatmentCost> {
    this.assertCanAccess(principal);
    const parsed = createCostSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.resolveBranch(principal, input.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Validate Clinical references via READ-ONLY port (no clinical mutation). */
      const plan = await this.clinical.getPlanById(tx, principal.orgId, input.planId);
      if (!plan) throw new NotFoundError('TreatmentPlan', input.planId);
      if (plan.patientId !== input.patientId) {
        throw new ValidationError({ patientId: ['patient does not match the treatment plan'] });
      }
      if (input.encounterId) {
        const enc = await this.clinical.getEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc) throw new NotFoundError('Encounter', input.encounterId);
      }

      const totalCost = this.round4(parseFloat(input.unitCost) * input.quantity);
      const costCode = await new OrgAllocator(tx).nextCostCode(principal.orgId);
      const cost = await this.repo.createCost(tx, principal.orgId, {
        ...input, branchId, costCode, totalCost,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'treatment_cost_created', entity: 'treatment_costs', entityId: cost.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: { code: cost.costCode, planId: cost.planId, totalCost: cost.totalCost, quantity: cost.quantity },
      }, tx);
      return cost;
    });
  }

  async listTreatmentCosts(principal: Principal, q: { branchId?: string; planId?: string; patientId?: string; limit?: number; offset?: number }): Promise<TreatmentCost[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listCosts(tx, principal.orgId, { ...q, branchId }));
  }

  async topTreatments(principal: Principal, q: { branchId?: string; limit?: number }) {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.topTreatments(tx, principal.orgId, { ...q, branchId }));
  }

  /* ================= LAB PAYABLE ================= */
  async createLabPayable(principal: Principal, raw: unknown): Promise<LabPayable> {
    this.assertCanAccess(principal);
    const parsed = createLabPayableSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.resolveBranch(principal, input.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      if (input.treatmentCostId) {
        const cost = await this.repo.findCostById(tx, principal.orgId, input.treatmentCostId);
        if (!cost) throw new NotFoundError('TreatmentCost', input.treatmentCostId);
      }
      const labCode = await new OrgAllocator(tx).nextLabCode(principal.orgId);
      const payable = await this.repo.createLabPayable(tx, principal.orgId, {
        ...input, branchId, labCode,
        paidAmount: '0',
        outstandingAmount: input.amount,
        status: 'DRAFT',
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'lab_payable_created', entity: 'lab_payables', entityId: payable.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: { code: payable.labCode, labName: payable.labName, amount: payable.amount, dueDate: payable.dueDate },
      }, tx);
      return payable;
    });
  }

  async listLabPayables(principal: Principal, q: { branchId?: string; status?: string; limit?: number; offset?: number }): Promise<LabPayable[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listLabPayables(tx, principal.orgId, { ...q, branchId }));
  }

  /**
   * P1-3 — Apply a payment to a lab payable via a SINGLE atomic guarded UPDATE.
   * The increment + overpayment guard are one SQL statement, so concurrent
   * payments serialize on the row and the loser matches 0 rows → clean 409
   * (never a raw 500 / negative outstanding). Status computed in-SQL. VOID /
   * DRAFT / zero-outstanding / overpay all rejected with 409, no partial
   * mutation. Audit in the same transaction.
   */
  async applyLabPayment(principal: Principal, id: string, raw: unknown): Promise<LabPayable> {
    this.assertCanAccess(principal);
    const parsed = labPaymentSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const payment = parseFloat(parsed.data.amount);
    if (payment <= 0) throw new ValidationError({ amount: ['payment amount must be positive'] });

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Read current state (for branch-scope check + friendly errors). */
      const before = await this.repo.findLabPayableById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('LabPayable', id);
      this.resolveBranch(principal, before.branchId);
      if (before.status === 'VOID') throw new ConflictError('Cannot pay a VOID lab payable');
      if (before.status === 'DRAFT') throw new ConflictError('Lab payable must be OUTSTANDING before payment');
      if (before.status === 'PAID') throw new ConflictError('Lab payable already fully paid');
      if (parseFloat(before.outstandingAmount) <= 0) {
        throw new ConflictError('Lab payable has no outstanding amount');
      }
      if (payment > parseFloat(before.outstandingAmount)) {
        throw new ConflictError(`Overpayment blocked: payment ${payment} exceeds outstanding ${before.outstandingAmount}`);
      }

      /* Atomic guarded UPDATE — the concurrency-safe write path. */
      const updated = await this.repo.applyLabPaymentAtomic(tx, principal.orgId, id, this.round4(payment));
      if (!updated) {
        /* 0 rows: a concurrent payment won the row race, or state changed. */
        throw new ConflictError('Lab payment conflict — concurrent payment or state change; reload and retry');
      }

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'lab_payment_applied', entity: 'lab_payables', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { paidAmount: before.paidAmount, outstandingAmount: before.outstandingAmount, status: before.status },
        after: { paidAmount: updated.paidAmount, outstandingAmount: updated.outstandingAmount, status: updated.status },
      }, tx);
      return updated;
    });
  }

  async changeLabPayableStatus(principal: Principal, id: string, raw: unknown): Promise<LabPayable> {
    this.assertCanAccess(principal);
    const parsed = labStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findLabPayableById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('LabPayable', id);
      this.resolveBranch(principal, before.branchId);
      if (!canTransitionLabPayable(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before;
      const updated = await this.repo.updateLabPayableStatus(tx, principal.orgId, id, target);
      if (!updated) throw new NotFoundError('LabPayable', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `lab_payable_${target.toLowerCase()}`, entity: 'lab_payables', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }

  /* ================= COMMISSION (LOCKED formula) ================= */
  /**
   * Calculate + persist a doctor commission ledger row. Idempotent per
   * doctor+period (existing open ledger → 409). Uses the LOCKED Commission
   * Engine (base = grossRevenue − eligibleDirectCosts; amount = base × rate).
   * Eligible direct costs are summed from Lab Cost / X-Ray / Add-on ONLY.
   */
  async calculateCommission(principal: Principal, raw: unknown): Promise<CommissionLedger> {
    this.assertCanAccess(principal);
    const parsed = commissionCalcSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.resolveBranch(principal, input.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Idempotency: one ledger per doctor+period. */
      const existing = await this.repo.findCommissionByDoctorPeriod(tx, principal.orgId, input.doctorId, input.period);
      if (existing) {
        throw new ConflictError(`Commission already calculated for doctor ${input.doctorId} period ${input.period} (${existing.commissionCode})`);
      }

      const eligible = sumEligibleDirectCosts(
        Object.fromEntries(Object.entries(input.costsByCategory).map(([k, v]) => [k, parseFloat(v)])),
      );
      const comp = computeCommission(parseFloat(input.grossRevenue), eligible, COMMISSION_CONFIG.RATE);
      const adjustment = input.adjustment ? parseFloat(input.adjustment) : 0;
      const netPayable = comp.commissionAmount - adjustment;

      const commissionCode = await new OrgAllocator(tx).nextCommissionCode(principal.orgId);
      const ledger = await this.repo.createCommission(tx, principal.orgId, {
        branchId,
        doctorId: input.doctorId,
        commissionCode,
        period: input.period,
        grossRevenue: comp.grossRevenue.toFixed(4),
        eligibleDirectCosts: comp.eligibleDirectCosts.toFixed(4),
        commissionBase: comp.commissionBase.toFixed(4),
        rate: comp.rate.toFixed(4),
        commissionAmount: comp.commissionAmount.toFixed(4),
        adjustment: adjustment.toFixed(4),
        netPayable: this.round4(netPayable),
        paidAmount: '0',
        outstandingAmount: this.round4(netPayable),
        status: 'calculated',
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'commission_calculated', entity: 'commission_ledger', entityId: ledger.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: {
          code: ledger.commissionCode, doctorId: ledger.doctorId, period: ledger.period,
          grossRevenue: ledger.grossRevenue, eligibleDirectCosts: ledger.eligibleDirectCosts,
          commissionBase: ledger.commissionBase, rate: ledger.rate, commissionAmount: ledger.commissionAmount,
        },
      }, tx);
      return ledger;
    });
  }

  async listCommissions(principal: Principal, q: { branchId?: string; doctorId?: string; period?: string; status?: string; limit?: number; offset?: number }): Promise<CommissionLedger[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listCommissions(tx, principal.orgId, { ...q, branchId }));
  }

  /** Status transition with optimistic locking (version guard). */
  async changeCommissionStatus(principal: Principal, id: string, raw: unknown): Promise<CommissionLedger> {
    this.assertCanAccess(principal);
    const parsed = commissionStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const { status: target, version } = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findCommissionById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('CommissionLedger', id);
      this.resolveBranch(principal, before.branchId);
      if (!canTransitionCommission(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before;
      if (before.version !== version) {
        throw new ConflictError(`Concurrent modification: expected version ${before.version}, got ${version}`);
      }
      const updated = await this.repo.updateCommissionStatus(tx, principal.orgId, id, version, target);
      if (!updated) throw new ConflictError('Concurrent modification detected — reload and retry');
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `commission_${target}`, entity: 'commission_ledger', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status, version: before.version }, after: { status: target, version: updated.version },
      }, tx);
      return updated;
    });
  }

  /**
   * P1-1 — Record a payout against a commission ledger as ONE atomic financial
   * operation: lock the ledger (SELECT ... FOR UPDATE), validate (no overpay),
   * update paid/outstanding (+status), insert the payout row, and write the
   * audit — all in the SAME transaction. Any failure rolls back ALL, so a
   * payout row can never exist without its ledger update. Overpayment → 409.
   * Concurrent payouts serialize on the row lock.
   */
  async recordPayout(principal: Principal, ledgerId: string, raw: unknown): Promise<CommissionPayout> {
    this.assertCanAccess(principal);
    const parsed = payoutSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Read current state (for branch-scope check + friendly errors). */
      const ledger = await this.repo.lockCommissionForUpdate(tx, principal.orgId, ledgerId);
      if (!ledger) throw new NotFoundError('CommissionLedger', ledgerId);
      this.resolveBranch(principal, ledger.branchId);
      if (ledger.status === 'cancelled') throw new ConflictError('Cannot pay a cancelled commission');
      if (ledger.status === 'paid') throw new ConflictError('Commission already fully paid');

      const payment = parseFloat(input.amount);
      const outstanding = parseFloat(ledger.outstandingAmount);

      if (payment <= 0) throw new ValidationError({ amount: ['payout amount must be positive'] });
      if (payment > outstanding) {
        throw new ConflictError(`Overpayment blocked: payout ${payment} exceeds outstanding ${outstanding}`);
      }

      /* 1) Atomic guarded UPDATE (same tx) — the concurrency-safe write path. */
      const updated = await this.repo.applyCommissionPayoutToLedger(tx, principal.orgId, ledgerId, this.round4(payment));
      if (!updated) {
        /* 0 rows: a concurrent payout won the row race, or state changed. */
        throw new ConflictError('Commission payout conflict — concurrent payout or state change; reload and retry');
      }

      /* 2) Insert the payout row (same tx). */
      const payout = await this.repo.createPayout(tx, principal.orgId, {
        branchId: ledger.branchId,
        commissionLedgerId: ledgerId,
        payoutDate: input.payoutDate,
        amount: input.amount,
        method: input.method ?? null,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      });

      /* 3) Audit (same tx — Blocker-1). */
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'commission_payout_recorded', entity: 'commission_payouts', entityId: payout.id,
        orgId: principal.orgId, branchId: ledger.branchId, source: 'api',
        before: { paidAmount: ledger.paidAmount, outstandingAmount: ledger.outstandingAmount, status: ledger.status },
        after: {
          payoutAmount: payout.amount, paidAmount: updated.paidAmount,
          outstandingAmount: updated.outstandingAmount, status: updated.status,
        },
      }, tx);
      return payout;
    });
  }

  async listPayouts(principal: Principal, ledgerId: string): Promise<CommissionPayout[]> {
    this.assertCanAccess(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const ledger = await this.repo.findCommissionById(tx, principal.orgId, ledgerId);
      if (!ledger) throw new NotFoundError('CommissionLedger', ledgerId);
      return this.repo.listPayoutsForLedger(tx, principal.orgId, ledgerId);
    });
  }
}
