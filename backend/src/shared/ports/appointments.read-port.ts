import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { appointments, Appointment } from '../../infrastructure/database/schema';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';

/**
 * AppointmentsReadPort — sanctioned CROSS-MODULE read boundary for the
 * appointments domain (dashboard reads through this, never the repository).
 * READ-ONLY: no inserts/updates/deletes.
 */
@Injectable()
export class AppointmentsReadPort {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  private requireDb(): Database {
    if (!this.db) throw new Error('Database not configured');
    return this.db;
  }

  /** Count appointments on a date for a branch (HQ: branchId null = org-wide), optionally filtered by status. */
  async countByDate(
    tx: DbClient, orgId: string, branchId: string | null, date: string, statuses?: string[],
  ): Promise<number> {
    const conds = [
      eq(appointments.orgId, orgId),
      eq(appointments.scheduledDate, date),
      isNull(appointments.deletedAt),
    ];
    if (branchId) conds.push(eq(appointments.branchId, branchId));
    if (statuses?.length) {
      conds.push(inArray(appointments.status, statuses as Appointment['status'][]));
    }
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(...conds));
    return rows[0]?.n ?? 0;
  }

  /** Status breakdown for a date (HQ: branchId null = org-wide). */
  async statusBreakdown(
    tx: DbClient, orgId: string, branchId: string | null, date: string,
  ): Promise<Array<{ status: string; n: number }>> {
    const conds = [
      eq(appointments.orgId, orgId),
      eq(appointments.scheduledDate, date),
      isNull(appointments.deletedAt),
    ];
    if (branchId) conds.push(eq(appointments.branchId, branchId));
    const rows = await tx
      .select({ status: appointments.status, n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(...conds))
      .groupBy(appointments.status);
    return rows.map((r) => ({ status: r.status, n: r.n }));
  }

  /* ---------------- S9 (Reports) — additive aggregate reads ---------------- */

  /** S9: per-day appointment counts by status over a range (trend series). */
  async dailySeries(
    tx: DbClient, orgId: string, branchId: string | null, from: string, to: string,
  ): Promise<Array<{ date: string; status: string; n: number }>> {
    const conds = [
      eq(appointments.orgId, orgId),
      sql`${appointments.scheduledDate} >= ${from}`,
      sql`${appointments.scheduledDate} <= ${to}`,
      isNull(appointments.deletedAt),
    ];
    if (branchId) conds.push(eq(appointments.branchId, branchId));
    const rows = await tx
      .select({ date: appointments.scheduledDate, status: appointments.status, n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(...conds))
      .groupBy(appointments.scheduledDate, appointments.status)
      .orderBy(appointments.scheduledDate);
    return rows.map((r) => ({ date: r.date, status: r.status, n: r.n }));
  }

  /** S9: per-doctor completed appointments over a range (production table). */
  async doctorProduction(
    tx: DbClient, orgId: string, branchId: string | null, from: string, to: string,
  ): Promise<Array<{ doctorId: string; completed: number }>> {
    const conds = [
      eq(appointments.orgId, orgId),
      sql`${appointments.scheduledDate} >= ${from}`,
      sql`${appointments.scheduledDate} <= ${to}`,
      eq(appointments.status, 'completed'),
      isNull(appointments.deletedAt),
      sql`${appointments.doctorId} IS NOT NULL`,
    ];
    if (branchId) conds.push(eq(appointments.branchId, branchId));
    const rows = await tx
      .select({ doctorId: appointments.doctorId, completed: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(...conds))
      .groupBy(appointments.doctorId);
    return rows
      .filter((r) => r.doctorId !== null)
      .map((r) => ({ doctorId: r.doctorId as string, completed: r.completed }));
  }
}
