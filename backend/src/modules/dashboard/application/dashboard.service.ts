import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql } from 'drizzle-orm';

import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';
import { DATABASE } from '../../../infrastructure/database/database.module';
import { Database } from '../../../infrastructure/database/database';
import { branches, saleRecords } from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { AppointmentsReadPort } from '../../../shared/ports/appointments.read-port';
import { FinanceReadPort } from '../../../shared/ports/finance.read-port';
import {
  branchHealth,
  orgSummary,
  sortByAttention,
  type AppointmentStatus,
  type BranchRawCounts,
  type BranchHealth,
  type OrgSummary,
} from '../domain/branch-health';
import { resolveDashboardPeriod, isDashboardPeriod, type DashboardPeriod } from '../domain/period';
import { buildLiveFeed, type LiveFeed } from '../domain/live-feed';
import {
  appointmentPulse, patientMix, receivables, freshness, branchBehaviour,
  type AppointmentPulse, type PatientMix, type ReceivablesState, type Freshness, type BranchBehaviour,
} from '../domain/pulse';
export interface DashboardContext {
  date: string;
  branchId: string;
  patients: { total: number };
  appointments: {
    total: number;
    byStatus: Array<{ status: string; n: number }>;
    queueActive: number;
    completed: number;
  };
}

/** YYYY-MM-DD dalam masa TEMPATAN pelayan (bukan UTC). */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Bilangan hari dalam julat, inklusif. */
function spanDays(from: string, to: string): number {
  return Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000) + 1;
}

/** Anjak tarikh ISO beberapa hari (boleh negatif). */
function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RevenueTrend {
  period: DashboardPeriod;
  from: string;
  to: string;
  /** Satu titik untuk setiap hari dalam julat, termasuk hari tanpa jualan. */
  points: Array<{ date: string; revenue: string }>;
  total: string;
  /** Peratus perubahan berbanding tempoh sebelumnya. null bila tiada asas. */
  changePct: number | null;
}

/**
 * FASA 1G — lima kad nadi bisnes untuk papan HQ.
 *
 * Setiap kad membawa `freshness` sendiri. Ini bukan hiasan: angka jualan
 * yang sync semalam mesti kelihatan berbeza daripada temujanji yang dikira
 * saat ini, jika tidak HQ akan membuat keputusan atas data yang lapuk
 * tanpa menyedarinya.
 */
export interface PulseCards {
  totalSales: { amount: string; changePct: number | null; freshness: Freshness; source: 'bukku' | 'mixed' };
  appointments: AppointmentPulse & { freshness: Freshness };
  todaySales: { amount: string; branches: number; freshness: Freshness };
  patientMix: PatientMix & { freshness: Freshness };
  receivables: ReceivablesState & { freshness: Freshness };
  branchBehaviour: BranchBehaviour;
}

export interface DashboardOverview {
  period: DashboardPeriod;
  from: string;
  to: string;
  scope: { type: 'org'; role: string };
  summary: OrgSummary;
  branches: Array<BranchHealth & { name: string; code: string }>;
  alerts: {
    lowAttendance: string[];
    noData: string[];
    outstandingLab: string;
    outstandingCommission: string;
    openAlerts: number;
  };
}

/**
 * DashboardService — READ-ONLY aggregation.
 *
 * Dua wajah, satu kod:
 *   - HQ      → 'overview': SETIAP cawangan, boleh dibanding
 *   - Branch  → 'context' : cawangan sendiri, hari ini
 *
 * Peraturan yang dipegang:
 *   - Semua fakta melalui read-port domain pemilik. Tidak sekali pun sentuh
 *     repositori modul lain.
 *   - Skop ditentukan server dari principal. Tiada branchId dari klien.
 *   - Tidak menulis apa-apa. Tiada audit (lihat sahaja).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly patients: PatientsReadPort,
    private readonly appointments: AppointmentsReadPort,
    private readonly finance: FinanceReadPort,
    @Inject(DATABASE) private readonly db: Database | null,
  ) {}

  /* ------------------------------------------------------------------ */
  /* WAJAH BRANCH — ditambah dengan hasil + trend (kekal serasi ke belakang) */
  /* ------------------------------------------------------------------ */

  async context(principal: Principal, date: string): Promise<DashboardContext> {
    const branchId = principal.role === 'hq' ? null : principal.branchId;
    if (!branchId && principal.role !== 'hq') {
      throw new ForbiddenError('No branch context — access denied');
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const [patientTotal, apptTotal, byStatus] = await Promise.all([
        this.patients.countPatients(tx as never, principal.orgId, branchId),
        this.appointments.countByDate(tx as never, principal.orgId, branchId, date),
        this.appointments.statusBreakdown(tx as never, principal.orgId, branchId, date),
      ]);
      const queueActive = byStatus
        .filter((s) => ['checked-in', 'waiting', 'called', 'in-progress'].includes(s.status))
        .reduce((acc, s) => acc + s.n, 0);
      const completed = byStatus.find((s) => s.status === 'completed')?.n ?? 0;
      return {
        date,
        branchId: branchId ?? principal.orgId,
        patients: { total: patientTotal },
        appointments: { total: apptTotal, byStatus, queueActive, completed },
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* WAJAH HQ — panorama semua cawangan                                  */
  /* ------------------------------------------------------------------ */

  async overview(principal: Principal, rawPeriod?: string): Promise<DashboardOverview> {
    if (principal.role !== 'hq') {
      throw new ForbiddenError('Dashboard overview is HQ-only');
    }
    const period = this.periodOf(rawPeriod);
    const { from, to } = resolveDashboardPeriod(period);

    return this.dbCtx.runAs(principal, async (tx) => {
      const branchRows = await this.listBranches(tx, principal.orgId);
      const branchIds = branchRows.map((b) => b.id);

      const [statusRows, revenueRows, revenueTotal, outstandingLab, outstandingCommission, openAlerts] =
        await Promise.all([
          this.appointments.statusByBranch(tx as never, principal.orgId, from, to),
          this.finance.revenueByBranch(tx as never, principal.orgId, { from, to }),
          this.finance.revenueTotal(tx as never, principal.orgId, { from, to }),
          this.finance.outstandingLabPayables(tx as never, principal.orgId),
          this.finance.outstandingCommission(tx as never, principal.orgId),
          this.finance.openAlertCount(tx as never, principal.orgId),
        ]);

      /* Kumpulkan status per cawangan. */
      const statusMap = new Map<string, Partial<Record<AppointmentStatus, number>>>();
      for (const id of branchIds) statusMap.set(id, {});
      for (const r of statusRows) {
        const bucket = statusMap.get(r.branchId) ?? {};
        bucket[r.status as AppointmentStatus] = (bucket[r.status as AppointmentStatus] ?? 0) + r.n;
        statusMap.set(r.branchId, bucket);
      }

      const revenueMap = new Map(revenueRows.map((r) => [r.branchId, r.revenue]));

      const startedCount = branchRows.filter((b) => {
        const c = statusMap.get(b.id) ?? {};
        return Object.values(c).some((v) => (v ?? 0) > 0);
      }).length;

      /* Purata hasil dikira dari cawangan yang SUDAH bermula sahaja.
         Kalau dibahagi 14 (termasuk yang belum mula), setiap cawangan aktif
         akan nampak "bawah purata" — menuduh tanpa sebab. */
      const avgRevenue = startedCount > 0 ? Number(revenueTotal) / startedCount : 0;

      const health = branchRows.map((b) => {
        const raw: BranchRawCounts = {
          branchId: b.id,
          byStatus: statusMap.get(b.id) ?? {},
          revenue: revenueMap.get(b.id) ?? '0',
          patientTotal: 0,
        };
        const h = branchHealth(raw, avgRevenue);
        return { ...h, name: b.shortName, code: b.code };
      });

      const sorted = sortByAttention(health);
      const summary = orgSummary(health);

      return {
        period,
        from,
        to,
        scope: { type: 'org' as const, role: principal.role },
        summary,
        branches: sorted,
        alerts: {
          lowAttendance: sorted
            .filter((h) => h.band === 'amber' || h.band === 'red')
            .map((h) => h.name),
          noData: sorted.filter((h) => h.band === 'not-started').map((h) => h.name),
          outstandingLab,
          outstandingCommission,
          openAlerts,
        },
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* GRAF TREND — jualan rasmi harian                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Siri jualan harian untuk graf.
   *
   * Sumber: `sale_records` (Bukku + POS). Sebelum Bukku disambung ini
   * menunjukkan campuran sumber — sama seperti kad Jumlah Hasil.
   *
   * Hari TANPA jualan tetap dipulangkan sebagai sifar. Kalau tidak, graf
   * akan melompat dari 20 Sep terus ke 24 Sep dan kelihatan seperti satu
   * garis menaik yang lancar — padahal ada tiga hari klinik tutup.
   */
  async revenueTrend(principal: Principal, rawPeriod?: string): Promise<RevenueTrend> {
    if (principal.role !== 'hq') throw new ForbiddenError('Dashboard overview is HQ-only');
    const period = this.periodOf(rawPeriod);
    const { from, to } = resolveDashboardPeriod(period);

    /* Tempoh sebelumnya, untuk peratus perubahan. */
    const spanDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
    const prevTo = new Date(new Date(from).getTime() - 86_400_000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(from).getTime() - spanDays * 86_400_000).toISOString().slice(0, 10);

    return this.dbCtx.runAs(principal, async (tx) => {
      const [series, prev] = await Promise.all([
        this.finance.revenueDailySeries(tx as never, principal.orgId, { from, to }),
        this.finance.revenueTotal(tx as never, principal.orgId, { from: prevFrom, to: prevTo }),
      ]);

      const byDate = new Map(series.map((r) => [r.date, r.revenue]));
      const points: Array<{ date: string; revenue: string }> = [];
      for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86_400_000)) {
        const key = d.toISOString().slice(0, 10);
        points.push({ date: key, revenue: byDate.get(key) ?? '0.0000' });
      }

      const total = points.reduce((acc, p) => acc + Number(p.revenue), 0);
      const prevTotal = Number(prev);
      const changePct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;

      return { period, from, to, points, total: total.toFixed(4), changePct };
    });
  }

  /* ------------------------------------------------------------------ */
  /* PANEL MASA-NYATA                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Aktiviti yang sedang berlaku di semua cawangan.
   *
   * `now` boleh disuntik untuk ujian. Untuk pengeluaran ia adalah masa
   * pelayan — dan itulah yang betul, kerana semua cawangan berada dalam
   * zon masa yang sama.
   */
  async live(principal: Principal, now: Date = new Date()): Promise<LiveFeed> {
    if (principal.role !== 'hq') throw new ForbiddenError('Dashboard overview is HQ-only');
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.appointments.todayWithNames(tx as never, principal.orgId, today);
      return buildLiveFeed(
        rows.map((r) => ({
          id: r.id, time: r.time, patientName: r.patientName,
          doctorName: r.doctorName, branchName: r.branchName,
          status: r.status, minutesFromNow: 0,
        })),
        now,
      );
    });
  }

  /* ------------------------------------------------------------------ */
  /* FASA 1G — LIMA KAD NADI BISNES                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Lima kad: jualan tempoh, temujanji hari ini, jualan hari ini,
   * pesakit baharu, belum dikutip.
   *
   * Semua bacaan dijalankan selari. Dashboard yang mengambil masa tiga
   * saat untuk muncul sudah gagal pada tujuannya — ia sepatutnya memberi
   * isyarat dalam sepuluh saat pertama.
   */
  async pulse(principal: Principal, rawPeriod?: string, now: Date = new Date()): Promise<PulseCards> {
    if (principal.role !== 'hq') throw new ForbiddenError('Dashboard is HQ-only');
    const period = this.periodOf(rawPeriod);
    const { from, to } = resolveDashboardPeriod(period);
    const today = isoDate(now);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* BERURUTAN, bukan Promise.all.
       *
       * Satu transaksi MySQL memegang SATU sambungan. Menghantar tujuh
       * query serentak pada sambungan yang sama menyebabkan hasilnya
       * tidak boleh dipercayai - kaunter pulang sifar tanpa sebarang ralat
       * dilog, jadi kegagalan itu senyap dan mustahil dikesan dari UI.
       */
      const salesTotal = await this.finance.revenueTotal(tx as never, principal.orgId, { from, to });
      const salesPrev = await this.finance.revenueTotal(tx as never, principal.orgId, {
        from: shiftDays(from, -spanDays(from, to)),
        to: shiftDays(from, -1),
      });
      const todaySales = await this.finance.revenueTotal(tx as never, principal.orgId, { from: today, to: today });
      const todayAppts = await this.appointments.todayWithNames(tx as never, principal.orgId, today);
      const newPatients = await this.patients.countNewInPeriod(tx as never, principal.orgId, from, to);
      const visits = await this.patients.countVisitsInPeriod(tx as never, principal.orgId, from, to);
      const bukkuStatus = await this.bukkuFreshness(tx as never, principal.orgId);

      /* Perlakuan cawangan hanya bermakna untuk hari yang SUDAH TUTUP.
         Kalau tempoh masih berjalan, kami hadkan kepada semalam. */
      const behaviourTo = to < today ? to : shiftDays(today, -1);
      const behaviour = behaviourTo >= from
        ? branchBehaviour(
            (await this.appointments.rangeWithNames(tx as never, principal.orgId, from, behaviourTo))
              .map((r) => ({ branchId: r.branchId, name: r.branchName, status: r.status })),
          )
        : { rows: [], total: { booked: 0, completed: 0, noShow: 0, noShowPct: null } };

      const salesNow = Number(salesTotal);
      const salesThen = Number(salesPrev);
      const b = bukkuStatus;

      const salesFresh: Freshness = freshness(b.lastSyncedAt, now);
      const liveFresh: Freshness = { asOf: now.toISOString(), stale: false, hoursOld: 0 };

      /* Belum dikutip: sumber sebenar ialah invois Bukku. Sebelum ia
         disambung, jawapan jujur ialah "tidak tahu" — bukan RM0. */
      /* Belum dikutip memerlukan jumlah invois tertunggak dari Bukku.
         Medan itu belum ada sehingga API disambung, jadi kita lapor
         'tidak tahu' - yang jujur - dan bukan RM0 yang mengelirukan. */
      const recv: ReceivablesState = receivables(null, 0, null);

      return {
        totalSales: {
          amount: salesTotal,
          changePct: salesThen > 0 ? Math.round(((salesNow - salesThen) / salesThen) * 1000) / 10 : null,
          freshness: salesFresh,
          source: b.configured && b.syncEnabled ? 'bukku' : 'mixed',
        },
        appointments: { ...appointmentPulse(todayAppts, now), freshness: liveFresh },
        todaySales: { amount: todaySales, branches: 0, freshness: salesFresh },
        patientMix: { ...patientMix(newPatients, visits), freshness: salesFresh },
        receivables: { ...recv, freshness: salesFresh } as ReceivablesState & { freshness: Freshness },
        branchBehaviour: behaviour,
      };
    });
  }


  /**
   * Bila Bukku terakhir sync - untuk label kesegaran pada kad.
   *
   * Dashboard hanya perlukan cap masa dan bilangan invois. Ia tidak perlu
   * tahu bagaimana sync berfungsi; itu urusan modul Finance.
   */
  private async bukkuFreshness(
    tx: never, orgId: string,
  ): Promise<{ configured: boolean; syncEnabled: boolean; lastSyncedAt: string | null; totalSyncedSales: number }> {
    const rows = await (tx as unknown as {
      select: (a: Record<string, unknown>) => {
        from: (t: unknown) => { where: (c: unknown) => Promise<Array<{ n: number; last: string | null }>> };
      };
    })
      .select({ n: sql`count(*)`, last: sql`max(${saleRecords.createdAt})` })
      .from(saleRecords)
      .where(and(
        eq(saleRecords.orgId, orgId),
        eq(saleRecords.sourceSystem, 'bukku'),
        isNull(saleRecords.deletedAt),
      ));
    return {
      configured: false,
      syncEnabled: false,
      lastSyncedAt: rows[0]?.last ?? null,
      totalSyncedSales: Number(rows[0]?.n ?? 0),
    };
  }

  /* ------------------------------------------------------------------ */

  private async listBranches(
    tx: DbClient,
    orgId: string,
  ): Promise<Array<{ id: string; code: string; shortName: string }>> {
    const rows = await tx
      .select({ id: branches.id, code: branches.code, shortName: branches.shortName })
      .from(branches)
      .where(and(eq(branches.orgId, orgId), isNull(branches.deletedAt), eq(branches.status, 'active')))
      .orderBy(branches.shortName);
    return rows;
  }

  private periodOf(raw?: string): DashboardPeriod {
    if (raw === undefined) return '7D';
    if (!isDashboardPeriod(raw)) {
      throw new ForbiddenError(`invalid period '${raw}' (allowed: today/7D/30D/MTD)`);
    }
    return raw;
  }
}
