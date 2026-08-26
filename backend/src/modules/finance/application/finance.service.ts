import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import { FinanceCoreRepository } from '../infrastructure/finance-core.repository';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { canTransitionExpense, isExpenseCategory } from '../domain/expense-lifecycle';
import { canTransitionRecurring, advanceNextDue } from '../domain/recurring-lifecycle';
import { severityForDaysUntilDue, daysUntilDue } from '../domain/radar-rules';
import {
  SaleRecord, Expense, RecurringCommitment, FinanceAlert,
} from '../../../infrastructure/database/schema';

const moneySchema = z.string().regex(/^\d+(\.\d{1,4})?$/, 'amount must be a non-negative decimal');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const createSaleSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid().nullish(),
  externalRef: z.string().max(128).nullish(),
  sourceSystem: z.string().max(32).default('pos'),
  amount: moneySchema,
  saleDate: dateSchema,
  notes: z.string().max(512).nullish(),
});

const createExpenseSchema = z.object({
  branchId: z.string().uuid(),
  category: z.string().refine(isExpenseCategory, 'unknown expense category'),
  subcategory: z.string().max(128).nullish(),
  payee: z.string().trim().min(1).max(256),
  amount: moneySchema,
  expenseDate: dateSchema,
  dueDate: dateSchema.nullish(),
  recurringId: z.string().uuid().nullish(),
  externalRef: z.string().max(128).nullish(),
  notes: z.string().max(512).nullish(),
});

const updateExpenseSchema = z.object({
  category: z.string().refine(isExpenseCategory, 'unknown expense category').optional(),
  subcategory: z.string().max(128).nullish(),
  payee: z.string().trim().min(1).max(256).optional(),
  amount: moneySchema.optional(),
  expenseDate: dateSchema.optional(),
  dueDate: dateSchema.nullish(),
  notes: z.string().max(512).nullish(),
});

const expenseStatusSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'paid', 'rejected', 'cancelled']),
});

const createRecurringSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(256),
  category: z.string().max(64),
  amount: moneySchema,
  frequency: z.enum(['Weekly', 'Monthly', 'Yearly', 'Custom']),
  nextDueDate: dateSchema,
  autoCreate: z.boolean().optional(),
  externalRef: z.string().max(128).nullish(),
  notes: z.string().max(512).nullish(),
});

const updateRecurringSchema = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  category: z.string().max(64).optional(),
  amount: moneySchema.optional(),
  frequency: z.enum(['Weekly', 'Monthly', 'Yearly', 'Custom']).optional(),
  nextDueDate: dateSchema.optional(),
  autoCreate: z.boolean().optional(),
  notes: z.string().max(512).nullish(),
});

const recurringStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']),
});

const alertStatusSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
});

/**
 * FinanceService — S4-T2 operational finance domain services:
 * sale/revenue records, expenses, recurring commitments, finance alerts.
 *
 * Scope model: hq = org-wide, branch_manager = own branch. Writes require
 * hq or branch_manager (RLS WITH CHECK is the DB backstop; service asserts
 * role first for a clean 403). doctor/branch_admin = NONE (fail-closed).
 * org_id is ALWAYS from the authenticated Principal — never from the body.
 *
 * Every mutation runs inside runAs() with the audit write on the SAME
 * transaction (Blocker-1 contract). CRM is NOT the POS — sale_records store
 * external POS references only; no payment processing.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: FinanceCoreRepository,
    private readonly audit: AuditService,
  ) {}

  private assertCanAccess(p: Principal): void {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Finance access is restricted to HQ and branch managers');
    }
  }

  /** Branch the caller may write to: bm is forced to their own branch. */
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

  /* ================= SALE / REVENUE RECORDS ================= */
  async recordSale(principal: Principal, raw: unknown): Promise<SaleRecord> {
    this.assertCanAccess(principal);
    const parsed = createSaleSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.resolveBranch(principal, input.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Idempotency: an external POS reference maps to at most one sale record. */
      if (input.externalRef) {
        const dup = await this.repo.findSaleByExternalRef(tx, principal.orgId, input.externalRef);
        if (dup) throw new ConflictError('Sale with this external reference already recorded');
      }
      const saleCode = await new OrgAllocator(tx).nextSaleCode(principal.orgId);
      const sale = await this.repo.createSale(tx, principal.orgId, { ...input, branchId, saleCode });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'sale_recorded', entity: 'sale_records', entityId: sale.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: { code: sale.saleCode, amount: sale.amount, externalRef: sale.externalRef },
      }, tx);
      return sale;
    });
  }

  async listSales(principal: Principal, q: { branchId?: string; from?: string; to?: string; limit?: number; offset?: number }): Promise<SaleRecord[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listSales(tx, principal.orgId, { ...q, branchId }));
  }

  async revenueSummary(principal: Principal, q: { branchId?: string; from?: string; to?: string }) {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.revenueSummary(tx, principal.orgId, { ...q, branchId }));
  }

  /* ================= EXPENSES ================= */
  async createExpense(principal: Principal, raw: unknown): Promise<Expense> {
    this.assertCanAccess(principal);
    const parsed = createExpenseSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.resolveBranch(principal, input.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      const expenseCode = await new OrgAllocator(tx).nextExpenseCode(principal.orgId);
      const expense = await this.repo.createExpense(tx, principal.orgId, { ...input, branchId, expenseCode });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'expense_created', entity: 'expenses', entityId: expense.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: { code: expense.expenseCode, category: expense.category, amount: expense.amount, payee: expense.payee },
      }, tx);
      return expense;
    });
  }

  async listExpenses(principal: Principal, q: { branchId?: string; category?: string; status?: string; limit?: number; offset?: number }): Promise<Expense[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listExpenses(tx, principal.orgId, { ...q, branchId }));
  }

  async expenseByCategory(principal: Principal, q: { branchId?: string; from?: string; to?: string }) {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.expenseByCategory(tx, principal.orgId, { ...q, branchId }));
  }

  async updateExpense(principal: Principal, id: string, raw: unknown): Promise<Expense> {
    this.assertCanAccess(principal);
    const parsed = updateExpenseSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findExpenseById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Expense', id);
      this.resolveBranch(principal, before.branchId);
      const updated = await this.repo.updateExpense(tx, principal.orgId, id, input);
      if (!updated) throw new NotFoundError('Expense', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'expense_updated', entity: 'expenses', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { category: before.category, amount: before.amount, payee: before.payee },
        after: { category: updated.category, amount: updated.amount, payee: updated.payee },
      }, tx);
      return updated;
    });
  }

  async changeExpenseStatus(principal: Principal, id: string, raw: unknown): Promise<Expense> {
    this.assertCanAccess(principal);
    const parsed = expenseStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findExpenseById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Expense', id);
      this.resolveBranch(principal, before.branchId);
      if (!canTransitionExpense(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before; /* no-op */
      const updated = await this.repo.updateExpenseStatus(tx, principal.orgId, id, target);
      if (!updated) throw new NotFoundError('Expense', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `expense_${target}`, entity: 'expenses', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }

  /* ================= RECURRING COMMITMENTS ================= */
  async createRecurring(principal: Principal, raw: unknown): Promise<RecurringCommitment> {
    this.assertCanAccess(principal);
    const parsed = createRecurringSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const branchId = this.resolveBranch(principal, input.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      const recurringCode = await new OrgAllocator(tx).nextRecurringCode(principal.orgId);
      const rec = await this.repo.createRecurring(tx, principal.orgId, { ...input, branchId, recurringCode });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'recurring_created', entity: 'recurring_commitments', entityId: rec.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: { code: rec.recurringCode, name: rec.name, amount: rec.amount, frequency: rec.frequency },
      }, tx);
      return rec;
    });
  }

  async listRecurring(principal: Principal, q: { branchId?: string; status?: string; limit?: number; offset?: number }): Promise<RecurringCommitment[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listRecurring(tx, principal.orgId, { ...q, branchId }));
  }

  async updateRecurring(principal: Principal, id: string, raw: unknown): Promise<RecurringCommitment> {
    this.assertCanAccess(principal);
    const parsed = updateRecurringSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findRecurringById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('RecurringCommitment', id);
      this.resolveBranch(principal, before.branchId);
      const updated = await this.repo.updateRecurring(tx, principal.orgId, id, input);
      if (!updated) throw new NotFoundError('RecurringCommitment', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'recurring_updated', entity: 'recurring_commitments', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { name: before.name, amount: before.amount, nextDueDate: before.nextDueDate },
        after: { name: updated.name, amount: updated.amount, nextDueDate: updated.nextDueDate },
      }, tx);
      return updated;
    });
  }

  async changeRecurringStatus(principal: Principal, id: string, raw: unknown): Promise<RecurringCommitment> {
    this.assertCanAccess(principal);
    const parsed = recurringStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findRecurringById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('RecurringCommitment', id);
      this.resolveBranch(principal, before.branchId);
      if (!canTransitionRecurring(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before;
      const updated = await this.repo.updateRecurring(tx, principal.orgId, id, { status: target });
      if (!updated) throw new NotFoundError('RecurringCommitment', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `recurring_${target}`, entity: 'recurring_commitments', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }

  /* Advance next due date (e.g. after generating the period's expense). */
  async advanceRecurring(principal: Principal, id: string): Promise<RecurringCommitment> {
    this.assertCanAccess(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findRecurringById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('RecurringCommitment', id);
      this.resolveBranch(principal, before.branchId);
      const next = advanceNextDue(new Date(before.nextDueDate), before.frequency);
      const updated = await this.repo.updateRecurring(tx, principal.orgId, id, {
        nextDueDate: next.toISOString().slice(0, 10),
      });
      if (!updated) throw new NotFoundError('RecurringCommitment', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'recurring_advanced', entity: 'recurring_commitments', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { nextDueDate: before.nextDueDate }, after: { nextDueDate: updated.nextDueDate },
      }, tx);
      return updated;
    });
  }

  /* ================= FINANCE ALERTS (RADAR) ================= */
  async listAlerts(principal: Principal, q: { branchId?: string; status?: string; severity?: string; limit?: number; offset?: number }): Promise<FinanceAlert[]> {
    this.assertCanAccess(principal);
    const branchId = this.scopedBranch(principal, q.branchId ?? null);
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.listAlerts(tx, principal.orgId, { ...q, branchId }));
  }

  async updateAlertStatus(principal: Principal, id: string, raw: unknown): Promise<FinanceAlert> {
    this.assertCanAccess(principal);
    const parsed = alertStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.listAlerts(tx, principal.orgId, {});
      const found = before.find((a) => a.id === id);
      if (!found) throw new NotFoundError('FinanceAlert', id);
      this.resolveBranch(principal, found.branchId);
      if (found.status === target) return found;
      const updated = await this.repo.updateAlertStatus(tx, principal.orgId, id, {
        status: target,
        acknowledgedBy: target === 'acknowledged' ? principal.staffId : null,
        resolvedBy: target === 'resolved' ? principal.staffId : null,
      });
      if (!updated) throw new NotFoundError('FinanceAlert', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `alert_${target}`, entity: 'finance_alerts', entityId: id,
        orgId: principal.orgId, branchId: found.branchId, source: 'api',
        before: { status: found.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }

  /**
   * Generate radar alerts from current finance records (management attention).
   * DATA → RULE → ALERT. Scans expenses (due soon/overdue) + recurring due.
   * Idempotent per entity+type+day (skips if an open alert already exists today).
   */
  async generateRadar(principal: Principal): Promise<{ created: number }> {
    this.assertCanAccess(principal);
    const today = new Date();
    let created = 0;
    return this.dbCtx.runAs(principal, async (tx) => {
      const branchId = this.scopedBranch(principal, null);
      const expenses = await this.repo.listExpenses(tx, principal.orgId, { branchId, limit: 500 });
      const recurring = await this.repo.listRecurring(tx, principal.orgId, { branchId, status: 'active', limit: 500 });
      const existingOpen = await this.repo.listAlerts(tx, principal.orgId, { branchId, status: 'open', limit: 500 });
      const openKey = new Set(existingOpen.map((a) => `${a.entityType}:${a.entityId}:${a.alertType}`));

      const maybeAlert = async (
        entityType: string, entityId: string, alertType: string,
        severity: FinanceAlert['severity'], title: string, message: string,
        amount: string | null, dueDate: string | null, bId: string,
      ) => {
        const key = `${entityType}:${entityId}:${alertType}`;
        if (openKey.has(key)) return;
        await this.repo.createAlert(tx, principal.orgId, {
          branchId: bId, alertType, severity, title, message,
          entityType, entityId, amount, dueDate,
        });
        created++;
      };

      for (const e of expenses) {
        if (!e.dueDate || e.status === 'paid' || e.status === 'cancelled') continue;
        const days = daysUntilDue(new Date(e.dueDate), today);
        if (days > 7) continue; /* outside radar window */
        const sev = severityForDaysUntilDue(days);
        await maybeAlert(
          'expense', e.id, days < 0 ? 'overdue_record' : 'expense_due', sev,
          days < 0 ? `Expense overdue: ${e.payee}` : `Expense due soon: ${e.payee}`,
          `${e.category} expense ${e.expenseCode} of RM ${e.amount} is ${days < 0 ? `${-days}d overdue` : `due in ${days}d`}.`,
          e.amount, e.dueDate, e.branchId,
        );
      }

      for (const r of recurring) {
        const days = daysUntilDue(new Date(r.nextDueDate), today);
        if (days > 7) continue;
        const sev = severityForDaysUntilDue(days);
        await maybeAlert(
          'recurring', r.id, days < 0 ? 'overdue_record' : 'expense_due', sev,
          days < 0 ? `Recurring overdue: ${r.name}` : `Recurring due soon: ${r.name}`,
          `Recurring ${r.name} (${r.recurringCode}) of RM ${r.amount} is ${days < 0 ? `${-days}d overdue` : `due in ${days}d`}.`,
          r.amount, r.nextDueDate, r.branchId,
        );
      }

      return { created };
    });
  }
}
