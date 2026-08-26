import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  expenseCategories, paymentMethods, financeAlertRules,
  ExpenseCategory, PaymentMethod, FinanceAlertRule,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';

/**
 * FinanceConfigRepository — managed finance config lists (expense categories,
 * payment methods) and alert-rule definitions. Every method takes the runAs
 * `tx` first; RLS enforces the branch boundary (hq all, branch_manager branch).
 */
@Injectable()
export class FinanceConfigRepository {
  /* ---- expense categories ---- */
  async createCategory(tx: DbClient, values: typeof expenseCategories.$inferInsert): Promise<ExpenseCategory> {
    try {
      return (await tx.insert(expenseCategories).values(values).returning())[0]!;
    } catch (e) { throw toDomainError(e); }
  }
  async findCategory(tx: DbClient, orgId: string, id: string): Promise<ExpenseCategory | null> {
    const r = await tx.select().from(expenseCategories)
      .where(and(eq(expenseCategories.orgId, orgId), eq(expenseCategories.id, id), isNull(expenseCategories.deletedAt))).limit(1);
    return r[0] ?? null;
  }
  async listCategories(tx: DbClient, orgId: string, branchId: string | null, status?: string | null): Promise<ExpenseCategory[]> {
    const c = [eq(expenseCategories.orgId, orgId), isNull(expenseCategories.deletedAt)];
    if (branchId) c.push(eq(expenseCategories.branchId, branchId));
    if (status) c.push(eq(expenseCategories.status, status as never));
    return tx.select().from(expenseCategories).where(and(...c)).orderBy(desc(expenseCategories.createdAt));
  }
  async updateCategory(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<ExpenseCategory | null> {
    const r = await tx.update(expenseCategories).set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(expenseCategories.orgId, orgId), eq(expenseCategories.id, id), isNull(expenseCategories.deletedAt))).returning();
    return r[0] ?? null;
  }

  /* ---- payment methods ---- */
  async createMethod(tx: DbClient, values: typeof paymentMethods.$inferInsert): Promise<PaymentMethod> {
    try {
      return (await tx.insert(paymentMethods).values(values).returning())[0]!;
    } catch (e) { throw toDomainError(e); }
  }
  async findMethod(tx: DbClient, orgId: string, id: string): Promise<PaymentMethod | null> {
    const r = await tx.select().from(paymentMethods)
      .where(and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, id), isNull(paymentMethods.deletedAt))).limit(1);
    return r[0] ?? null;
  }
  async listMethods(tx: DbClient, orgId: string, branchId: string | null, status?: string | null): Promise<PaymentMethod[]> {
    const c = [eq(paymentMethods.orgId, orgId), isNull(paymentMethods.deletedAt)];
    if (branchId) c.push(eq(paymentMethods.branchId, branchId));
    if (status) c.push(eq(paymentMethods.status, status as never));
    return tx.select().from(paymentMethods).where(and(...c)).orderBy(desc(paymentMethods.createdAt));
  }
  async updateMethod(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<PaymentMethod | null> {
    const r = await tx.update(paymentMethods).set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, id), isNull(paymentMethods.deletedAt))).returning();
    return r[0] ?? null;
  }

  /* ---- alert rules ---- */
  async createRule(tx: DbClient, values: typeof financeAlertRules.$inferInsert): Promise<FinanceAlertRule> {
    try {
      return (await tx.insert(financeAlertRules).values(values).returning())[0]!;
    } catch (e) { throw toDomainError(e); }
  }
  async findRule(tx: DbClient, orgId: string, id: string): Promise<FinanceAlertRule | null> {
    const r = await tx.select().from(financeAlertRules)
      .where(and(eq(financeAlertRules.orgId, orgId), eq(financeAlertRules.id, id), isNull(financeAlertRules.deletedAt))).limit(1);
    return r[0] ?? null;
  }
  async listRules(tx: DbClient, orgId: string, branchId: string | null): Promise<FinanceAlertRule[]> {
    const c = [eq(financeAlertRules.orgId, orgId), isNull(financeAlertRules.deletedAt)];
    if (branchId) c.push(eq(financeAlertRules.branchId, branchId));
    return tx.select().from(financeAlertRules).where(and(...c)).orderBy(desc(financeAlertRules.createdAt));
  }
  async updateRule(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<FinanceAlertRule | null> {
    const r = await tx.update(financeAlertRules).set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(financeAlertRules.orgId, orgId), eq(financeAlertRules.id, id), isNull(financeAlertRules.deletedAt))).returning();
    return r[0] ?? null;
  }
}
