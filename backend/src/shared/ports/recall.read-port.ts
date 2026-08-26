import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql, SQL } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { recallCases } from '../../infrastructure/database/schema';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';

/**
 * RecallReadPort — sanctioned CROSS-MODULE read boundary for the marketing
 * domain's recall pipeline (S9, Q7). Lives in shared so Reports can read
 * recall aggregates WITHOUT importing marketing infrastructure
 * (module-boundary rule). READ-ONLY: no inserts/updates/deletes. The caller
 * supplies the runAs() transaction so RLS applies.
 */
@Injectable()
export class RecallReadPort {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  private requireDb(): Database {
    if (!this.db) throw new Error('Database not configured');
    return this.db;
  }

  /** S9: recall case counts by status, due-date within [from, to]
   * (branchId null = org-wide). Feeds the canonical recall_rate KPI. */
  async recallStats(
    tx: DbClient, orgId: string, branchId: string | null, from: string, to: string,
  ): Promise<{ open: number; completed: number; cancelled: number }> {
    const cond: SQL[] = [
      eq(recallCases.orgId, orgId),
      isNull(recallCases.deletedAt),
      sql`${recallCases.dueDate} >= ${from}`,
      sql`${recallCases.dueDate} <= ${to}`,
    ];
    if (branchId) cond.push(eq(recallCases.branchId, branchId));
    const rows = await tx
      .select({ status: recallCases.status, n: sql<number>`count(*)::int` })
      .from(recallCases)
      .where(and(...cond))
      .groupBy(recallCases.status);
    const out = { open: 0, completed: 0, cancelled: 0 };
    for (const r of rows) {
      if (r.status === 'open') out.open = r.n;
      else if (r.status === 'completed') out.completed = r.n;
      else if (r.status === 'cancelled') out.cancelled = r.n;
    }
    return out;
  }
}
