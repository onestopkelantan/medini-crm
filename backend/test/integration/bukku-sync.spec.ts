import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { Principal } from '@core/auth/principal';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { AccountingPort, PullInvoicesQuery } from '@shared/ports/accounting.port';
import { FinanceCoreRepository } from '@modules/finance/infrastructure/finance-core.repository';
import { BukkuSyncService } from '@modules/finance/application/bukku-sync.service';
import { ConfigService } from '@nestjs/config';

/**
 * FASA 1C — ujian integrasi sync Bukku + padanan harian (MySQL langsung).
 *
 * Ini menguji LALUAN SEBENAR melalui pangkalan data: idempotensi dijamin oleh
 * kekangan unik DB (bukan oleh kod kami), dan padanan benar-benar membaca
 * baris yang ditulis.
 *
 * Kegagalan yang dijaga:
 *   - tarik dua kali menghasilkan DUA rekod (wang dikira dua kali)
 *   - invois 'void' dikira sebagai hasil
 *   - padanan mengira CRM sebagai nombor rasmi
 *   - beza kecil (satu sen) terlepas
 *
 * Skip dengan jujur apabila DB tidak dapat dicapai — bukan lulus palsu.
 */

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? ADMIN_URL;

const TEST_ORG = '99999999-9999-9999-9999-9999999998a0';
const TEST_BRANCH_A = '99999999-9999-9999-9999-9999999998a1';
const TEST_BRANCH_B = '99999999-9999-9999-9999-9999999998a2';

const probe = Promise.all([pingDatabase(ADMIN_URL), pingDatabase(RUNTIME_URL)]).then(
  ([a, b]) => {
    const ok = a && b;
    if (!ok) console.warn('[bukku-sync] MySQL unreachable — SKIPPING (honest skip).');
    return ok;
  },
);

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!(await probe)) ctx.skip();
    await fn();
  });
}

type Db = ReturnType<typeof createFreshDatabase>['db'];

const hq = (): Principal => ({
  staffId: '99999999-9999-9999-9999-9999999998b1',
  username: 'sync-test',
  name: 'Sync Test',
  role: 'hq',
  orgId: TEST_ORG,
  branchId: null,
  doctorId: null,
});

const branchManager = (): Principal => ({
  ...hq(),
  role: 'branch_manager',
  branchId: TEST_BRANCH_A,
});

/** Adapter Bukku tiruan — membolehkan ujian tanpa rangkaian. */
class FakeBukku extends AccountingPort {
  public pages: unknown[] = [];
  public pulls = 0;
  constructor(private readonly configured = true) {
    super();
  }
  isConfigured() {
    return this.configured;
  }
  async push() {
    return { ok: true as const, status: 'synced' as const };
  }
  async pull() {
    return { records: [] };
  }
  async pullInvoices(_q: PullInvoicesQuery): Promise<unknown> {
    const page = this.pages[this.pulls] ?? { paging: { total: 0 }, transactions: [] };
    this.pulls += 1;
    return page;
  }
}

async function purge(admin: Db): Promise<void> {
  await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM branches WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM organizations WHERE id = ${TEST_ORG}`);
}

async function fixture(admin: Db): Promise<void> {
  await purge(admin);
  await admin.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${TEST_ORG}, 'Bukku Sync Test')
  `);
  await admin.execute(sql`
    INSERT INTO branches (id, org_id, code, short_name, full_name, status)
    VALUES (${TEST_BRANCH_A}, ${TEST_ORG}, 'st', 'Setia Tropika', 'Setia Tropika', 'active')
  `);
  await admin.execute(sql`
    INSERT INTO branches (id, org_id, code, short_name, full_name, status)
    VALUES (${TEST_BRANCH_B}, ${TEST_ORG}, 'bi', 'Bukit Indah', 'Bukit Indah', 'active')
  `);
}

/** Sediakan service dengan flag sync HIDUP dan adapter tiruan. */
function makeService(db: Db, fake: FakeBukku): BukkuSyncService {
  const ctx = new DbContextService(db);
  const audit = new AuditService(new InMemoryAuditAdapter());
  const config = {
    get: (k: string) => (k === 'integrations.bukku.syncEnabled' ? true : undefined),
  } as unknown as ConfigService;
  return new BukkuSyncService(
    ctx,
    new FinanceCoreRepository(),
    audit,
    fake,
    config,
    db,
  );
}

const invoice = (id: number, date: string, amount: number, status = 'ready', number = `IV-${id}`) => ({
  id, number, date, amount, status,
});

describe('FASA 1C — sync jualan Bukku (integrasi MySQL)', () => {
  let admin: Db;

  beforeAll(async () => {
    if (!(await probe)) return;
    admin = createFreshDatabase(ADMIN_URL).db;
    await fixture(admin);
  });

  dbIt('menyimpan invois Bukku sebagai jualan confirmed', async () => {
    const fake = new FakeBukku();
    fake.pages = [{ paging: { total: 1 }, transactions: [invoice(101, '2026-09-24', 8500)] }];
    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, fake);

    const r = await svc.syncSales(hq(), { from: '2026-09-24', to: '2026-09-24' });
    expect(r.fetched).toBe(1);
    expect(r.created).toBe(1);

    const rows = await admin.execute(sql`
      SELECT amount, status, source_system, external_ref FROM sale_records
      WHERE org_id = ${TEST_ORG} AND external_ref = '101'
    `);
    const row = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows[0]!;
    expect(String(row.amount)).toBe('8500.0000');
    expect(String(row.status)).toBe('confirmed');
    expect(String(row.source_system)).toBe('bukku');
  });

  dbIt('tarik DUA KALI tidak menghasilkan pendua (idempotensi)', async () => {
    /* Ini ujian paling penting: kalau gagal, setiap sync menggandakan hasil. */
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    const fake = new FakeBukku();
    fake.pages = [{ paging: { total: 1 }, transactions: [invoice(201, '2026-09-24', 1000)] }];

    const svc1 = makeService(createFreshDatabase(RUNTIME_URL).db, fake);
    await svc1.syncSales(hq(), { from: '2026-09-24', to: '2026-09-24' });

    const fake2 = new FakeBukku();
    fake2.pages = [{ paging: { total: 1 }, transactions: [invoice(201, '2026-09-24', 1000)] }];
    const svc2 = makeService(createFreshDatabase(RUNTIME_URL).db, fake2);
    const r2 = await svc2.syncSales(hq(), { from: '2026-09-24', to: '2026-09-24' });

    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(1);

    const count = await admin.execute(sql`
      SELECT COUNT(*) AS n FROM sale_records WHERE org_id = ${TEST_ORG} AND external_ref = '201'
    `);
    expect(Number((count as unknown as { rows: Array<Record<string, unknown>> }).rows[0]!.n)).toBe(1);
  });

  dbIt('invois void disimpan sebagai cancelled, bukan hasil', async () => {
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    const fake = new FakeBukku();
    fake.pages = [{ paging: { total: 1 }, transactions: [invoice(301, '2026-09-24', 500, 'void')] }];
    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, fake);
    await svc.syncSales(hq(), { from: '2026-09-24', to: '2026-09-24' });

    const rows = await admin.execute(sql`
      SELECT status FROM sale_records WHERE org_id = ${TEST_ORG} AND external_ref = '301'
    `);
    expect(String((rows as unknown as { rows: Array<Record<string, unknown>> }).rows[0]!.status)).toBe('cancelled');
  });

  dbIt('menolak jualan apabila sync dimatikan (flag)', async () => {
    const fake = new FakeBukku();
    const ctx = new DbContextService(createFreshDatabase(RUNTIME_URL).db);
    const config = { get: () => false } as unknown as ConfigService;
    const svc = new BukkuSyncService(
      ctx, new FinanceCoreRepository(), new AuditService(new InMemoryAuditAdapter()),
      fake, config, createFreshDatabase(RUNTIME_URL).db,
    );
    await expect(svc.syncSales(hq(), { from: '2026-09-24', to: '2026-09-24' })).rejects.toThrow();
  });

  dbIt('branch manager TIDAK boleh sync (HQ sahaja)', async () => {
    const fake = new FakeBukku();
    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, fake);
    await expect(
      svc.syncSales(branchManager(), { from: '2026-09-24', to: '2026-09-24' }),
    ).rejects.toThrow();
  });

  dbIt('menolak julat tarikh yang tidak sah', async () => {
    const fake = new FakeBukku();
    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, fake);
    await expect(svc.syncSales(hq(), { from: '24-09-2026', to: '2026-09-24' })).rejects.toThrow();
    await expect(svc.syncSales(hq(), { from: '2026-09-25', to: '2026-09-24' })).rejects.toThrow();
  });
});

describe('FASA 1C — padanan harian (integrasi MySQL)', () => {
  let admin: Db;

  beforeAll(async () => {
    if (!(await probe)) return;
    admin = createFreshDatabase(ADMIN_URL).db;
    await fixture(admin);
  });

  /** Masukkan jualan terus — membolehkan ujian padanan tanpa sync. */
  const sale = async (
    branchId: string, amount: string, source: string, ref: string | null, date = '2026-09-24', status = 'confirmed',
  ) => {
    await admin.execute(sql`
      INSERT INTO sale_records (id, org_id, branch_id, sale_code, external_ref, source_system, amount, sale_date, status)
      VALUES (UUID(), ${TEST_ORG}, ${branchId}, ${'T-' + ref + '-' + source}, ${ref}, ${source}, ${amount}, ${date}, ${status})
    `);
  };

  dbIt('mengesan beza antara Bukku dan CRM', async () => {
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    await sale(TEST_BRANCH_A, '8500.0000', 'bukku', 'b1');
    await sale(TEST_BRANCH_A, '8000.0000', 'manual', null);

    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, new FakeBukku());
    const view = await svc.reconcile(hq(), { from: '2026-09-24', to: '2026-09-24' });

    const rowA = view.days.find((d) => d.branchId === TEST_BRANCH_A)!;
    expect(rowA.status).toBe('mismatch');
    expect(rowA.bukku).toBe('8500.0000');
    expect(rowA.message).toContain('lebih di Bukku');
    expect(Number(view.summary.absoluteDifference)).toBe(500);
    /* Nombor rasmi = Bukku sahaja. */
    expect(Number(view.summary.bukkuTotal)).toBe(8500);
  });

  dbIt('mengesan beza SATU SEN', async () => {
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    await sale(TEST_BRANCH_A, '1000.0000', 'bukku', 'b2');
    await sale(TEST_BRANCH_A, '999.9900', 'manual', null);

    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, new FakeBukku());
    const view = await svc.reconcile(hq(), { from: '2026-09-24', to: '2026-09-24' });
    const rowA = view.days.find((d) => d.branchId === TEST_BRANCH_A)!;
    expect(rowA.status).toBe('mismatch');
    expect(rowA.message).toContain('RM0.01');
  });

  dbIt('cawangan belum key-in = not-submitted', async () => {
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    await sale(TEST_BRANCH_A, '3200.0000', 'bukku', 'b3');

    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, new FakeBukku());
    const view = await svc.reconcile(hq(), { from: '2026-09-24', to: '2026-09-24' });
    const rowA = view.days.find((d) => d.branchId === TEST_BRANCH_A)!;
    expect(rowA.status).toBe('not-submitted');
    expect(rowA.message).toContain('Belum di-key-in');
  });

  dbIt('padan sempurna = matched, tiada mesej', async () => {
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    await sale(TEST_BRANCH_A, '5000.0000', 'bukku', 'b4');
    await sale(TEST_BRANCH_A, '5000.0000', 'manual', null);

    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, new FakeBukku());
    const view = await svc.reconcile(hq(), { from: '2026-09-24', to: '2026-09-24' });
    const rowA = view.days.find((d) => d.branchId === TEST_BRANCH_A)!;
    expect(rowA.status).toBe('matched');
    expect(rowA.message).toBeNull();
    expect(Number(view.summary.absoluteDifference)).toBe(0);
  });

  dbIt('jualan void/recorded TIDAK dikira dalam padanan', async () => {
    await admin.execute(sql`DELETE FROM sale_records WHERE org_id = ${TEST_ORG}`);
    await sale(TEST_BRANCH_A, '9999.0000', 'bukku', 'b5', '2026-09-24', 'cancelled');
    await sale(TEST_BRANCH_A, '100.0000', 'bukku', 'b6', '2026-09-24', 'confirmed');

    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, new FakeBukku());
    const view = await svc.reconcile(hq(), { from: '2026-09-24', to: '2026-09-24' });
    /* Hanya 100 yang dikira — 9999 dibatalkan. */
    expect(Number(view.summary.bukkuTotal)).toBe(100);
  });

  dbIt('branch manager TIDAK boleh lihat padanan (HQ sahaja)', async () => {
    const svc = makeService(createFreshDatabase(RUNTIME_URL).db, new FakeBukku());
    await expect(
      svc.reconcile(branchManager(), { from: '2026-09-24', to: '2026-09-24' }),
    ).rejects.toThrow();
  });
});
