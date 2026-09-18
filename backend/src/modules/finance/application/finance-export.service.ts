import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, eq, gte, isNull, lte, isNotNull, asc } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, ValidationError } from '../../../shared/errors/errors';
import { expenses, recurringCommitments } from '../../../infrastructure/database/schema';
import { CalendarEvent, toIcs, toCsv } from '../../../shared/export/calendar-export.util';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const querySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  branchId: z.string().uuid().optional(),
  format: z.enum(['ics', 'csv']).default('ics'),
});

export interface ExportPayload {
  content: string;
  mimeType: string;
  filename: string;
}

/**
 * FinanceExportService — export the finance "calendar" (upcoming money dates:
 * expense due dates + recurring-commitment next-due dates) as .ics or CSV.
 * Read-only. Access = HQ + branch_manager (finance view); hq all, bm own branch.
 */
@Injectable()
export class FinanceExportService {
  constructor(private readonly dbCtx: DbContextService) {}

  private assertAccess(p: Principal): void {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Finance access is restricted to HQ and branch managers');
    }
  }
  private scopedBranch(p: Principal, requested?: string | null): string | null {
    return p.role === 'hq' ? (requested ?? null) : p.branchId;
  }

  async export(principal: Principal, rawQuery: Record<string, unknown>): Promise<ExportPayload> {
    this.assertAccess(principal);
    const parsed = querySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ValidationError(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])));
    }
    const q = parsed.data;
    const branchId = this.scopedBranch(principal, q.branchId);

    const { due, recurring } = await this.dbCtx.runAs(principal, async (tx) => {
      const ec = [eq(expenses.orgId, principal.orgId), isNull(expenses.deletedAt), isNotNull(expenses.dueDate)];
      if (branchId) ec.push(eq(expenses.branchId, branchId));
      if (q.from) ec.push(gte(expenses.dueDate, q.from));
      if (q.to) ec.push(lte(expenses.dueDate, q.to));

      const rc = [eq(recurringCommitments.orgId, principal.orgId), isNull(recurringCommitments.deletedAt)];
      if (branchId) rc.push(eq(recurringCommitments.branchId, branchId));
      if (q.from) rc.push(gte(recurringCommitments.nextDueDate, q.from));
      if (q.to) rc.push(lte(recurringCommitments.nextDueDate, q.to));

      const dueRows = await tx.select().from(expenses).where(and(...ec)).orderBy(asc(expenses.dueDate));
      const recRows = await tx.select().from(recurringCommitments).where(and(...rc)).orderBy(asc(recurringCommitments.nextDueDate));
      return { due: dueRows, recurring: recRows };
    });

    if (q.format === 'csv') {
      const rows = [
        ...due.map((e: typeof expenses.$inferSelect) => ({ type: 'expense_due', date: e.dueDate, ref: e.expenseCode, name: e.payee, amount: e.amount, status: e.status })),
        ...recurring.map((r: typeof recurringCommitments.$inferSelect) => ({ type: 'recurring', date: r.nextDueDate, ref: r.recurringCode, name: r.name, amount: r.amount, status: r.status })),
      ];
      return {
        content: toCsv(rows, ['type', 'date', 'ref', 'name', 'amount', 'status']),
        mimeType: 'text/csv; charset=utf-8',
        filename: 'finance-calendar.csv',
      };
    }

    const events: CalendarEvent[] = [
      ...due.map((e: typeof expenses.$inferSelect): CalendarEvent => ({
        uid: `exp-${e.id}@medini`,
        summary: `Expense due: ${e.payee} (${e.amount})`,
        description: `Ref ${e.expenseCode} · category ${e.category} · status ${e.status}`,
        allDayDate: e.dueDate!,
      })),
      ...recurring.map((r: typeof recurringCommitments.$inferSelect): CalendarEvent => ({
        uid: `rec-${r.id}@medini`,
        summary: `Recurring: ${r.name} (${r.amount})`,
        description: `Ref ${r.recurringCode} · ${r.frequency} · status ${r.status}`,
        allDayDate: r.nextDueDate,
      })),
    ];
    return { content: toIcs(events, 'Medini Finance Calendar'), mimeType: 'text/calendar; charset=utf-8', filename: 'finance-calendar.ics' };
  }
}
