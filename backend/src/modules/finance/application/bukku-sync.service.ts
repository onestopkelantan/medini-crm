import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';

import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, ValidationError } from '../../../shared/errors/errors';
import { AuditService } from '../../../shared/audit/audit.service';
import { AccountingPort } from '../../../shared/ports/accounting.port';
import { DATABASE } from '../../../infrastructure/database/database.module';
import { Database } from '../../../infrastructure/database/database';
import { saleRecords, branches } from '../../../infrastructure/database/schema';
import { FinanceCoreRepository } from '../infrastructure/finance-core.repository';
import { translateBatch, readInvoicePage } from '../domain/bukku-invoice';
import {
  matchDay, summarise, sortBySeverity, type DailyMatch, type DailyFigure,
} from '../domain/reconciliation';

/** Maksimum halaman yang akan ditarik dalam satu sync — pagar anti-gelung. */
const MAX_PAGES = 20;
/** page_size maksimum yang Bukku benarkan. */
const PAGE_SIZE = 100;

export interface SyncSalesResult {
  fetched: number;
  created: number;
  skipped: number;
  rejected: Array<{ reason: string; externalRef: string | null }>;
  from: string;
  to: string;
}

export interface BukkuStatus {
  configured: boolean;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  lastCreated: number;
  lastError: string | null;
  totalSyncedSales: number;
}

export interface ReconciliationView {
  from: string;
  to: string;
  summary: ReturnType<typeof summarise>;
  days: Array<DailyMatch & { branchName: string }>;
}

/**
 * Bentuk minimum rantaian Drizzle yang `resolveSyncBranch` gunakan, ditaip
 * dengan tepat supaya hasil akhir (selepas `limit`) ialah baris cawangan.
 * `tx` datang sebagai `unknown`; menaipnya setakat ini mengelak `any`.
 */
interface BranchRowQuery {
  select(columns: unknown): this;
  from(table: unknown): this;
  where(condition: unknown): this;
  orderBy(...columns: unknown[]): this;
  limit(n: number): Promise<Array<{ id: string }>>;
}

/**
 * BukkuSyncService — tarik jualan dari Bukku, dan padankannya dengan CRM.
 *
 * Dua tanggungjawab, satu sebab: mereka berkongsi takrif "hari" dan "cawangan".
 * Memisahkannya akan membenarkan mereka perlahan-lahan tidak sependapat.
 *
 * Peraturan:
 *   - HQ sahaja. Ini data seluruh organisasi.
 *   - Idempotensi melalui `external_ref` (id invois Bukku). Tarik 10 kali,
 *     tetap satu rekod.
 *   - Nombor rasmi ialah Bukku. CRM dibaca hanya untuk perbandingan.
 *   - Sync MATI secara lalai (`BUKKU_SYNC_ENABLED`). Sistem tanpa kredensial
 *     tidak boleh sesekali cuba dan gagal senyap.
 */
@Injectable()
export class BukkuSyncService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly core: FinanceCoreRepository,
    private readonly audit: AuditService,
    private readonly accounting: AccountingPort,
    private readonly config: ConfigService,
    @Inject(DATABASE) private readonly db: Database | null,
  ) {}

  private get syncEnabled(): boolean {
    return this.config.get<boolean>('integrations.bukku.syncEnabled') === true;
  }

  private assertHq(p: Principal): void {
    if (p.role !== 'hq') throw new ForbiddenError('Sync Bukku adalah untuk HQ sahaja');
  }

  /** Status sambungan — untuk UI. Tidak pernah mendedahkan kunci API. */
  async status(principal: Principal): Promise<BukkuStatus> {
    this.assertHq(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await tx
        .select({ n: sql<number>`count(*)`, last: sql<string | null>`max(${saleRecords.createdAt})` })
        .from(saleRecords)
        .where(
          and(
            eq(saleRecords.orgId, principal.orgId),
            eq(saleRecords.sourceSystem, 'bukku'),
            isNull(saleRecords.deletedAt),
          ),
        );
      return {
        configured: this.accounting.isConfigured(),
        syncEnabled: this.syncEnabled,
        lastSyncedAt: rows[0]?.last ?? null,
        lastCreated: 0,
        lastError: null,
        totalSyncedSales: rows[0]?.n ?? 0,
      };
    });
  }

  /**
   * Tarik invois Bukku untuk satu julat tarikh dan simpan sebagai jualan.
   *
   * Pesanan operasi penting: HTTP berlaku SEBELUM transaksi DB dibuka. Tidak
   * ada kunci baris yang dipegang semasa menunggu rangkaian.
   */
  async syncSales(
    principal: Principal,
    input: { from: string; to: string },
  ): Promise<SyncSalesResult> {
    this.assertHq(principal);

    if (!this.syncEnabled) {
      throw new ForbiddenError(
        'Sync Bukku dimatikan. Tetapkan BUKKU_SYNC_ENABLED=true untuk mengaktifkan.',
      );
    }
    if (!this.accounting.isConfigured()) {
      throw new ValidationError(
        { config: ['Bukku belum dikonfigurasi (BUKKU_API_KEY dan BUKKU_COMPANY_SUBDOMAIN diperlukan)'] },
        'Bukku belum dikonfigurasi',
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
      throw new ValidationError({ from: ['from dan to mesti dalam format YYYY-MM-DD'] });
    }
    if (input.from > input.to) {
      throw new ValidationError({ from: ['from tidak boleh selepas to'] });
    }

    /* ---------- 1. Tarik SEMUA halaman (di luar transaksi DB) ---------- */
    const collected: unknown[] = [];
    let page = 1;
    let total: number | null = null;

    while (page <= MAX_PAGES) {
      const body = await this.accounting.pullInvoices({
        from: input.from,
        to: input.to,
        page,
        pageSize: PAGE_SIZE,
      });
      const parsed = readInvoicePage(body);
      collected.push(...parsed.transactions);
      if (total === null) total = parsed.total;

      /* Berhenti apabila halaman tidak penuh, atau kita sudah ada semua. */
      if (parsed.transactions.length < PAGE_SIZE) break;
      if (total !== null && collected.length >= total) break;
      page += 1;
    }

    /* ---------- 2. Terjemah (fungsi pure, boleh diuji) ---------- */
    const { sales, rejected } = translateBatch(collected);

    /* ---------- 3. Simpan idempoten ---------- */
    const saved = await this.dbCtx.runAs(principal, async (tx) => {
      /* Cawangan tunggal untuk sync: Bukku tidak menyatakan cawangan dalam
         invois. Buat masa ini semua jualan Bukku masuk ke satu cawangan
         "belum ditanda"; pemetaan sebenar akan ditambah apabila Medini HQ
         memberikan cara penandaan cawangan. */
      const branchId = await this.resolveSyncBranch(tx, principal.orgId);

      let created = 0;
      let skipped = 0;

      for (const sale of sales) {
        const existing = await this.core.findSaleByExternalRef(tx as never, principal.orgId, sale.externalRef);
        if (existing) {
          skipped += 1;
          continue;
        }
        await this.core.createSale(tx as never, principal.orgId, {
          branchId,
          saleCode: sale.saleCode,
          externalRef: sale.externalRef,
          sourceSystem: 'bukku',
          amount: sale.amount,
          saleDate: sale.saleDate,
          status: sale.status,
          notes: 'Sync dari Bukku',
        });
        created += 1;
      }

      await this.audit.record(
        {
          actorId: principal.staffId,
          actorRole: principal.role,
          action: 'bukku_sync_sales',
          entity: 'sale_records',
          entityId: branchId,
          orgId: principal.orgId,
          branchId,
          source: 'api',
          after: { from: input.from, to: input.to, fetched: collected.length, created, skipped },
        },
        tx as never,
      );

      return { created, skipped, branchId };
    });

    return {
      fetched: collected.length,
      created: saved.created,
      skipped: saved.skipped,
      rejected,
      from: input.from,
      to: input.to,
    };
  }

  /**
   * Padanan harian: Bukku berbanding CRM, per cawangan.
   *
   * Nombor rasmi ialah Bukku (`source_system='bukku'`). CRM ialah apa-apa
   * jualan lain (`source_system <> 'bukku'`).
   */
  async reconcile(
    principal: Principal,
    input: { from: string; to: string },
  ): Promise<ReconciliationView> {
    this.assertHq(principal);

    return this.dbCtx.runAs(principal, async (tx) => {
      const branchRows = await tx
        .select({ id: branches.id, shortName: branches.shortName })
        .from(branches)
        .where(and(eq(branches.orgId, principal.orgId), isNull(branches.deletedAt), eq(branches.status, 'active')))
        .orderBy(branches.shortName);

      /* Kumpulkan jumlah harian per cawangan per sumber.
         Hanya 'confirmed' dikira — 'void'/'recorded' bukan hasil rasmi. */
      const totals = await tx
        .select({
          branchId: saleRecords.branchId,
          saleDate: saleRecords.saleDate,
          sourceSystem: saleRecords.sourceSystem,
          total: sql<string>`COALESCE(SUM(${saleRecords.amount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(saleRecords)
        .where(
          and(
            eq(saleRecords.orgId, principal.orgId),
            isNull(saleRecords.deletedAt),
            eq(saleRecords.status, 'confirmed'),
            sql`${saleRecords.saleDate} >= ${input.from}`,
            sql`${saleRecords.saleDate} <= ${input.to}`,
          ),
        )
        .groupBy(saleRecords.branchId, saleRecords.saleDate, saleRecords.sourceSystem);

      /* Bina peta: branchId|date|source → angka. */
      const key = (b: string, d: string, s: string) => `${b}|${d}|${s}`;
      const map = new Map<string, DailyFigure>();
      for (const t of totals) {
        const k = key(t.branchId, t.saleDate, t.sourceSystem);
        const prev = map.get(k);
        if (prev) {
          map.set(k, { ...prev, amount: (Number(prev.amount) + Number(t.total)).toFixed(4), count: prev.count + t.count });
        } else {
          map.set(k, { branchId: t.branchId, date: t.saleDate, amount: t.total, count: t.count });
        }
      }

      /* Hasilkan satu baris per (cawangan × hari) dalam julat. */
      const days: Array<DailyMatch & { branchName: string }> = [];
      for (const b of branchRows) {
        for (const date of eachDate(input.from, input.to)) {
          const bukku = map.get(key(b.id, date, 'bukku')) ?? null;
          const crm = sumNonBukku(map, b.id, date, key);
          const m = matchDay(bukku, crm, date, b.id);
          days.push({ ...m, branchName: b.shortName });
        }
      }

      return {
        from: input.from,
        to: input.to,
        summary: summarise(days),
        days: sortBySeverity(days),
      };
    });
  }

  /** Cawangan untuk jualan Bukku. Tukar bila Medini HQ beri pemetaan. */
  private async resolveSyncBranch(tx: unknown, orgId: string): Promise<string> {
    const rows = await (tx as BranchRowQuery)
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.orgId, orgId), isNull(branches.deletedAt), eq(branches.status, 'active')))
      .orderBy(branches.shortName)
      .limit(1);
    const id = rows[0]?.id;
    if (!id) throw new ValidationError({ branch: ['Tiada cawangan aktif untuk menerima sync Bukku'] });
    return id;
  }
}

/** Senarai tarikh YYYY-MM-DD inklusif antara from dan to. */
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > 400) break; /* pagar: julat terlalu besar */
  }
  return out;
}

/** Jumlahkan semua sumber BUKAN bukku untuk satu cawangan+harian. */
function sumNonBukku(
  map: Map<string, DailyFigure>,
  branchId: string,
  date: string,
  _key: (b: string, d: string, s: string) => string,
): DailyFigure | null {
  let total = 0;
  let count = 0;
  for (const [k, fig] of map.entries()) {
    const [b, d, s] = k.split('|');
    if (b === branchId && d === date && s !== 'bukku') {
      total += Number(fig.amount);
      count += fig.count;
    }
  }
  if (count === 0) return null;
  return { branchId, date, amount: total.toFixed(4), count };
}
