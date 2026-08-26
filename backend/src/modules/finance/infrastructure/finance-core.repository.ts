import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql, gte, lte, SQL } from 'drizzle-orm';
import {
  saleRecords, SaleRecord,
  expenses, Expense,
  recurringCommitments, RecurringCommitment,
  financeAlerts, FinanceAlert,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';

/**
 * FinanceCoreRepository — stateless data access for S4-T2 operational records:
 * sale_records, expenses, recurring_commitments, finance_alerts.
 *
 * Every method takes the runAs() transaction so RLS applies (hq=all, bm=branch).
 * org_id is ALWAYS server-derived from the authenticated principal.
 * toDomainError maps unique/check violations to domain errors.
 */

/* ---------- Sale records ---------- */
export interface CreateSaleInput {
  saleCode: string;
  branchId: string;
  patientId?: string | null;
  externalRef?: string | null;
  sourceSystem?: string;
  amount: string;
  saleDate: string;
  status?: string;
  notes?: string | null;
}

@Injectable()
export class FinanceCoreRepository {
  /* ================= SALE_RECORDS ================= */
  async createSale(tx: DbClient, orgId: string, input: CreateSaleInput): Promise<SaleRecord> {
    try {
      const rows = await tx.insert(saleRecords).values({
        orgId,
        branchId: input.branchId,
        patientId: input.patientId ?? null,
        saleCode: input.saleCode,
        externalRef: input.externalRef ?? null,
        sourceSystem: input.sourceSystem ?? 'pos',
        amount: input.amount,
        saleDate: input.saleDate,
        status: (input.status as SaleRecord['status']) ?? 'recorded',
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findSaleById(tx: DbClient, orgId: string, id: string): Promise<SaleRecord | null> {
    const rows = await tx.select().from(saleRecords)
      .where(and(eq(saleRecords.orgId, orgId), eq(saleRecords.id, id), isNull(saleRecords.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSaleByExternalRef(tx: DbClient, orgId: string, externalRef: string): Promise<SaleRecord | null> {
    const rows = await tx.select().from(saleRecords)
      .where(and(eq(saleRecords.orgId, orgId), eq(saleRecords.externalRef, externalRef), isNull(saleRecords.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listSales(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from?: string; to?: string; limit?: number; offset?: number;
  }): Promise<SaleRecord[]> {
    const cond: SQL[] = [eq(saleRecords.orgId, orgId), isNull(saleRecords.deletedAt)];
    if (opts.branchId) cond.push(eq(saleRecords.branchId, opts.branchId));
    if (opts.from) cond.push(gte(saleRecords.saleDate, opts.from));
    if (opts.to) cond.push(lte(saleRecords.saleDate, opts.to));
    return tx.select().from(saleRecords).where(and(...cond))
      .orderBy(desc(saleRecords.saleDate))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  /* Revenue aggregation (management read-model). */
  async revenueSummary(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from?: string; to?: string;
  }): Promise<{ total: string; count: number }> {
    const cond: SQL[] = [eq(saleRecords.orgId, orgId), isNull(saleRecords.deletedAt), eq(saleRecords.status, 'confirmed')];
    if (opts.branchId) cond.push(eq(saleRecords.branchId, opts.branchId));
    if (opts.from) cond.push(gte(saleRecords.saleDate, opts.from));
    if (opts.to) cond.push(lte(saleRecords.saleDate, opts.to));
    const rows = await tx.select({
      total: sql<string>`COALESCE(SUM(${saleRecords.amount}), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    }).from(saleRecords).where(and(...cond));
    return { total: rows[0]!.total, count: rows[0]!.count };
  }

  /* ================= EXPENSES ================= */
  async createExpense(tx: DbClient, orgId: string, input: {
    expenseCode: string; branchId: string; category: string; subcategory?: string | null;
    payee: string; amount: string; expenseDate: string; dueDate?: string | null;
    status?: string; recurringId?: string | null; externalRef?: string | null; notes?: string | null;
  }): Promise<Expense> {
    try {
      const rows = await tx.insert(expenses).values({
        orgId,
        branchId: input.branchId,
        expenseCode: input.expenseCode,
        category: input.category,
        subcategory: input.subcategory ?? null,
        payee: input.payee,
        amount: input.amount,
        expenseDate: input.expenseDate,
        dueDate: input.dueDate ?? null,
        status: (input.status as Expense['status']) ?? 'draft',
        recurringId: input.recurringId ?? null,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findExpenseById(tx: DbClient, orgId: string, id: string): Promise<Expense | null> {
    const rows = await tx.select().from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.id, id), isNull(expenses.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listExpenses(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; category?: string; status?: string; limit?: number; offset?: number;
  }): Promise<Expense[]> {
    const cond: SQL[] = [eq(expenses.orgId, orgId), isNull(expenses.deletedAt)];
    if (opts.branchId) cond.push(eq(expenses.branchId, opts.branchId));
    if (opts.category) cond.push(eq(expenses.category, opts.category));
    if (opts.status) cond.push(eq(expenses.status, opts.status as Expense['status']));
    return tx.select().from(expenses).where(and(...cond))
      .orderBy(desc(expenses.expenseDate))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  async updateExpenseStatus(tx: DbClient, orgId: string, id: string, status: Expense['status']): Promise<Expense | null> {
    const rows = await tx.update(expenses).set({ status, updatedAt: new Date() })
      .where(and(eq(expenses.orgId, orgId), eq(expenses.id, id), isNull(expenses.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  async updateExpense(tx: DbClient, orgId: string, id: string, input: {
    category?: string; subcategory?: string | null; payee?: string; amount?: string;
    expenseDate?: string; dueDate?: string | null; notes?: string | null;
  }): Promise<Expense | null> {
    try {
      const rows = await tx.update(expenses).set({
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.subcategory !== undefined ? { subcategory: input.subcategory } : {}),
        ...(input.payee !== undefined ? { payee: input.payee } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.expenseDate !== undefined ? { expenseDate: input.expenseDate } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      }).where(and(eq(expenses.orgId, orgId), eq(expenses.id, id), isNull(expenses.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }

  /* Expense analytics: category breakdown. */
  async expenseByCategory(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from?: string; to?: string;
  }): Promise<Array<{ category: string; total: string; count: number }>> {
    const cond: SQL[] = [eq(expenses.orgId, orgId), isNull(expenses.deletedAt)];
    if (opts.branchId) cond.push(eq(expenses.branchId, opts.branchId));
    if (opts.from) cond.push(gte(expenses.expenseDate, opts.from));
    if (opts.to) cond.push(lte(expenses.expenseDate, opts.to));
    return tx.select({
      category: expenses.category,
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    }).from(expenses).where(and(...cond)).groupBy(expenses.category)
      .orderBy(desc(sql`SUM(${expenses.amount})`));
  }

  /* ================= RECURRING ================= */
  async createRecurring(tx: DbClient, orgId: string, input: {
    recurringCode: string; branchId: string; name: string; category: string; amount: string;
    frequency: string; nextDueDate: string; status?: string; autoCreate?: boolean;
    externalRef?: string | null; notes?: string | null;
  }): Promise<RecurringCommitment> {
    try {
      const rows = await tx.insert(recurringCommitments).values({
        orgId,
        branchId: input.branchId,
        recurringCode: input.recurringCode,
        name: input.name,
        category: input.category,
        amount: input.amount,
        frequency: input.frequency,
        nextDueDate: input.nextDueDate,
        status: (input.status as RecurringCommitment['status']) ?? 'active',
        autoCreate: input.autoCreate ?? false,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findRecurringById(tx: DbClient, orgId: string, id: string): Promise<RecurringCommitment | null> {
    const rows = await tx.select().from(recurringCommitments)
      .where(and(eq(recurringCommitments.orgId, orgId), eq(recurringCommitments.id, id), isNull(recurringCommitments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listRecurring(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; status?: string; limit?: number; offset?: number;
  }): Promise<RecurringCommitment[]> {
    const cond: SQL[] = [eq(recurringCommitments.orgId, orgId), isNull(recurringCommitments.deletedAt)];
    if (opts.branchId) cond.push(eq(recurringCommitments.branchId, opts.branchId));
    if (opts.status) cond.push(eq(recurringCommitments.status, opts.status as RecurringCommitment['status']));
    return tx.select().from(recurringCommitments).where(and(...cond))
      .orderBy(recurringCommitments.nextDueDate)
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  async updateRecurring(tx: DbClient, orgId: string, id: string, input: {
    name?: string; category?: string; amount?: string; frequency?: string;
    nextDueDate?: string; status?: RecurringCommitment['status']; autoCreate?: boolean; notes?: string | null;
  }): Promise<RecurringCommitment | null> {
    try {
      const rows = await tx.update(recurringCommitments).set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.nextDueDate !== undefined ? { nextDueDate: input.nextDueDate } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.autoCreate !== undefined ? { autoCreate: input.autoCreate } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      }).where(and(eq(recurringCommitments.orgId, orgId), eq(recurringCommitments.id, id), isNull(recurringCommitments.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }

  /* ================= FINANCE_ALERTS ================= */
  async createAlert(tx: DbClient, orgId: string, input: {
    branchId: string; alertType: string; severity: FinanceAlert['severity'];
    title: string; message: string; entityType?: string | null; entityId?: string | null;
    amount?: string | null; dueDate?: string | null;
  }): Promise<FinanceAlert> {
    try {
      const rows = await tx.insert(financeAlerts).values({
        orgId,
        branchId: input.branchId,
        alertType: input.alertType,
        severity: input.severity,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        amount: input.amount ?? null,
        dueDate: input.dueDate ?? null,
        status: 'open',
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async listAlerts(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; status?: string; severity?: string; limit?: number; offset?: number;
  }): Promise<FinanceAlert[]> {
    const cond: SQL[] = [eq(financeAlerts.orgId, orgId), isNull(financeAlerts.deletedAt)];
    if (opts.branchId) cond.push(eq(financeAlerts.branchId, opts.branchId));
    if (opts.status) cond.push(eq(financeAlerts.status, opts.status as FinanceAlert['status']));
    if (opts.severity) cond.push(eq(financeAlerts.severity, opts.severity as FinanceAlert['severity']));
    return tx.select().from(financeAlerts).where(and(...cond))
      .orderBy(desc(financeAlerts.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  async updateAlertStatus(tx: DbClient, orgId: string, id: string, input: {
    status: FinanceAlert['status']; acknowledgedBy?: string | null; resolvedBy?: string | null;
  }): Promise<FinanceAlert | null> {
    const set: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
    if (input.status === 'acknowledged') {
      set.acknowledgedAt = new Date();
      set.acknowledgedBy = input.acknowledgedBy ?? null;
    }
    if (input.status === 'resolved') {
      set.resolvedAt = new Date();
      set.resolvedBy = input.resolvedBy ?? null;
    }
    const rows = await tx.update(financeAlerts).set(set)
      .where(and(eq(financeAlerts.orgId, orgId), eq(financeAlerts.id, id), isNull(financeAlerts.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
