import { Injectable } from '@nestjs/common';
import { eq, and, isNull, sql, SQL } from 'drizzle-orm';
import {
  saleRecords, expenses, commissionLedger, labPayables, financeAlerts,
} from '../../infrastructure/database/schema';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';

/**
 * FinanceReadPort — sanctioned CROSS-MODULE read boundary for the finance
 * domain (Sprint 4 S4-T4). Lives in shared so Dashboard / Reports / patient
 * 360 can read finance aggregates WITHOUT importing finance infrastructure
 * (module-boundary rule). READ-ONLY: no inserts/updates/deletes. The caller
 * supplies the runAs() transaction so RLS applies.
 */
@Injectable()
export class FinanceReadPort {
  /** Confirmed revenue total for a branch/org over an optional date range. */
  async revenueTotal(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from?: string; to?: string;
  }): Promise<string> {
    const cond: SQL[] = [eq(saleRecords.orgId, orgId), isNull(saleRecords.deletedAt), eq(saleRecords.status, 'confirmed')];
    if (opts.branchId) cond.push(eq(saleRecords.branchId, opts.branchId));
    if (opts.from) cond.push(sql`${saleRecords.saleDate} >= ${opts.from}`);
    if (opts.to) cond.push(sql`${saleRecords.saleDate} <= ${opts.to}`);
    const rows = await tx.select({ total: sql<string>`COALESCE(SUM(${saleRecords.amount}), 0)::text` })
      .from(saleRecords).where(and(...cond));
    return rows[0]!.total;
  }

  /** Outstanding lab payable total (operational cost monitoring). */
  async outstandingLabPayables(tx: DbClient, orgId: string, branchId?: string | null): Promise<string> {
    const cond: SQL[] = [eq(labPayables.orgId, orgId), isNull(labPayables.deletedAt), sql`${labPayables.status} != 'VOID'`];
    if (branchId) cond.push(eq(labPayables.branchId, branchId));
    const rows = await tx.select({ total: sql<string>`COALESCE(SUM(${labPayables.outstandingAmount}), 0)::text` })
      .from(labPayables).where(and(...cond));
    return rows[0]!.total;
  }

  /** Open finance alert count (radar attention). */
  async openAlertCount(tx: DbClient, orgId: string, branchId?: string | null): Promise<number> {
    const cond: SQL[] = [eq(financeAlerts.orgId, orgId), isNull(financeAlerts.deletedAt), eq(financeAlerts.status, 'open')];
    if (branchId) cond.push(eq(financeAlerts.branchId, branchId));
    const rows = await tx.select({ n: sql<number>`COUNT(*)::int` })
      .from(financeAlerts).where(and(...cond));
    return rows[0]!.n;
  }

  /** Outstanding doctor commission total. */
  async outstandingCommission(tx: DbClient, orgId: string, branchId?: string | null): Promise<string> {
    const cond: SQL[] = [eq(commissionLedger.orgId, orgId), isNull(commissionLedger.deletedAt), sql`${commissionLedger.status} != 'cancelled'`];
    if (branchId) cond.push(eq(commissionLedger.branchId, branchId));
    const rows = await tx.select({ total: sql<string>`COALESCE(SUM(${commissionLedger.outstandingAmount}), 0)::text` })
      .from(commissionLedger).where(and(...cond));
    return rows[0]!.total;
  }

  /** Total expenses over an optional range. */
  async expenseTotal(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from?: string; to?: string;
  }): Promise<string> {
    const cond: SQL[] = [eq(expenses.orgId, orgId), isNull(expenses.deletedAt)];
    if (opts.branchId) cond.push(eq(expenses.branchId, opts.branchId));
    if (opts.from) cond.push(sql`${expenses.expenseDate} >= ${opts.from}`);
    if (opts.to) cond.push(sql`${expenses.expenseDate} <= ${opts.to}`);
    const rows = await tx.select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text` })
      .from(expenses).where(and(...cond));
    return rows[0]!.total;
  }

  /* ---------------- S9 (Reports) — additive aggregate reads ---------------- */

  /** S9: Confirmed revenue per branch over a range (scope: pass branchId to
   * pin one branch, or omit for org-wide per-branch rows). Canonical revenue
   * rule unchanged: status='confirmed', soft-delete excluded. */
  async revenueByBranch(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from?: string; to?: string;
  }): Promise<Array<{ branchId: string; revenue: string }>> {
    const cond: SQL[] = [eq(saleRecords.orgId, orgId), isNull(saleRecords.deletedAt), eq(saleRecords.status, 'confirmed')];
    if (opts.branchId) cond.push(eq(saleRecords.branchId, opts.branchId));
    if (opts.from) cond.push(sql`${saleRecords.saleDate} >= ${opts.from}`);
    if (opts.to) cond.push(sql`${saleRecords.saleDate} <= ${opts.to}`);
    const rows = await tx
      .select({ branchId: saleRecords.branchId, revenue: sql<string>`COALESCE(SUM(${saleRecords.amount}), 0)::text` })
      .from(saleRecords).where(and(...cond)).groupBy(saleRecords.branchId);
    return rows.map((r) => ({ branchId: r.branchId, revenue: r.revenue }));
  }

  /** S9: Confirmed revenue per day over a range (trend series). */
  async revenueDailySeries(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; from: string; to: string;
  }): Promise<Array<{ date: string; revenue: string }>> {
    const cond: SQL[] = [
      eq(saleRecords.orgId, orgId), isNull(saleRecords.deletedAt), eq(saleRecords.status, 'confirmed'),
      sql`${saleRecords.saleDate} >= ${opts.from}`, sql`${saleRecords.saleDate} <= ${opts.to}`,
    ];
    if (opts.branchId) cond.push(eq(saleRecords.branchId, opts.branchId));
    const rows = await tx
      .select({ date: saleRecords.saleDate, revenue: sql<string>`COALESCE(SUM(${saleRecords.amount}), 0)::text` })
      .from(saleRecords).where(and(...cond)).groupBy(saleRecords.saleDate).orderBy(saleRecords.saleDate);
    return rows.map((r) => ({ date: r.date, revenue: r.revenue }));
  }
}
