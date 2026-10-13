import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { appointments, Appointment, staff, branches } from '../../infrastructure/database/schema';
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
      .select({ n: sql<number>`count(*)` })
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
      .select({ status: appointments.status, n: sql<number>`count(*)` })
      .from(appointments)
      .where(and(...conds))
      .groupBy(appointments.status);
    return rows.map((r: { status: string; n: number }) => ({ status: r.status, n: r.n }));
  }

  /* ---------------- FASA 1A (Dashboard HQ) — per-branch aggregates ------- */

  /**
   * Status breakdown per branch over a date range (FASA 1A).
   *
   * WHY a range and not a single date: HQ's health measure is "did patients
   * turn up", and one day is noise — a public holiday empties every branch,
   * a Monday fills one. A range is the smallest honest window.
   *
   * Branch filter is deliberately absent: HQ needs EVERY branch, and RLS has
   * already scoped the transaction. A branch user's RLS yields exactly one
   * branch's rows, so the same call serves both roles.
   */
  async statusByBranch(
    tx: DbClient, orgId: string, from: string, to: string,
  ): Promise<Array<{ branchId: string; status: string; n: number }>> {
    const rows = await tx
      .select({
        branchId: appointments.branchId,
        status: appointments.status,
        n: sql<number>`count(*)`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.orgId, orgId),
          sql`${appointments.scheduledDate} >= ${from}`,
          sql`${appointments.scheduledDate} <= ${to}`,
          isNull(appointments.deletedAt),
        ),
      )
      .groupBy(appointments.branchId, appointments.status);
    return rows.map((r: { branchId: string; status: string; n: number }) => ({
      branchId: r.branchId,
      status: r.status,
      n: r.n,
    }));
  }



  /**
   * FASA 1G — temujanji mengikut cawangan untuk julat TARIKH YANG SUDAH LALU.
   *
   * Mengira no-show untuk hari yang masih berjalan akan menuduh pesakit
   * yang cuma datang lewat. Pemanggil bertanggungjawab memastikan `to`
   * sudah berlalu sebelum menggunakan hasilnya untuk sebarang penilaian.
   */
  async rangeWithNames(
    tx: DbClient, orgId: string, from: string, to: string,
  ): Promise<Array<{ branchId: string; branchName: string; status: string }>> {
    const rows = await tx
      .select({
        branchId: appointments.branchId,
        branchName: branches.shortName,
        status: appointments.status,
      })
      .from(appointments)
      .leftJoin(branches, eq(appointments.branchId, branches.id))
      .where(
        and(
          eq(appointments.orgId, orgId),
          sql`${appointments.scheduledDate} >= ${from}`,
          sql`${appointments.scheduledDate} <= ${to}`,
          isNull(appointments.deletedAt),
        ),
      );
    return rows.map((r: { branchId: string; branchName: string | null; status: string }) => ({
      branchId: r.branchId,
      branchName: r.branchName ?? "—",
      status: r.status,
    }));
  }

  /* ---------------- FASA 1F (Dashboard live) — aktiviti hari ini -------- */

  /**
   * Temujanji hari ini untuk semua cawangan, dengan nama pesakit, doktor
   * dan cawangan.
   *
   * Satu query menyertai staff + branches supaya panel boleh memaparkan
   * nama sebenar, bukan id. Tanpa ini UI perlu membuat 14 panggilan
   * tambahan — satu untuk setiap cawangan — hanya untuk mendapatkan nama.
   *
   * RLS sudah mengehadkan skop: HQ nampak semua, branch nampak satu.
   */
  async todayWithNames(
    tx: DbClient, orgId: string, date: string,
  ): Promise<Array<{
    id: string; time: string; patientName: string;
    doctorName: string | null; branchName: string; status: string;
  }>> {
    const rows = await tx
      .select({
        id: appointments.id,
        time: appointments.scheduledTime,
        patientName: appointments.patientName,
        doctorName: staff.name,
        branchName: branches.shortName,
        status: appointments.status,
      })
      .from(appointments)
      .leftJoin(staff, eq(appointments.doctorId, staff.id))
      .leftJoin(branches, eq(appointments.branchId, branches.id))
      .where(
        and(
          eq(appointments.orgId, orgId),
          eq(appointments.scheduledDate, date),
          isNull(appointments.deletedAt),
        ),
      )
      .orderBy(appointments.scheduledTime);
    return rows.map((r: { id: string; time: string; patientName: string; doctorName: string | null; branchName: string | null; status: string }) => ({
      id: r.id,
      time: String(r.time).slice(0, 5),
      patientName: r.patientName,
      doctorName: r.doctorName,
      branchName: r.branchName ?? "—",
      status: r.status,
    }));
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
      .select({ date: appointments.scheduledDate, status: appointments.status, n: sql<number>`count(*)` })
      .from(appointments)
      .where(and(...conds))
      .groupBy(appointments.scheduledDate, appointments.status)
      .orderBy(appointments.scheduledDate);
    return rows.map((r: { date: string; status: string; n: number }) => ({ date: r.date, status: r.status, n: r.n }));
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
      .select({ doctorId: appointments.doctorId, completed: sql<number>`count(*)` })
      .from(appointments)
      .where(and(...conds))
      .groupBy(appointments.doctorId);
    return rows
      .filter((r: { doctorId: string | null; completed: number }) => r.doctorId !== null)
      .map((r: { doctorId: string | null; completed: number }) => ({ doctorId: r.doctorId as string, completed: r.completed }));
  }
}
