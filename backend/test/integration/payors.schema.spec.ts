import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';

/**
 * Sprint 2A T1 — payor master data: database & security foundation (live PG).
 *
 * Verifies migration 0006 only: schema, enum, indexes, grants, RLS policies.
 * NO service/CRUD logic exists in T1 — tables are exercised with raw SQL.
 * Honest skip (ctx.skip) when the DB is genuinely unreachable.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[payors-schema] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

/* Throwaway orgs — never touch canonical data. */
const ORG_A = '99999999-9999-9999-9999-9999999999a1';
const ORG_B = '99999999-9999-9999-9999-9999999999a2';

interface RawRows { rows: Array<Record<string, unknown>> }

async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM panel_companies WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM insurance_companies WHERE org_id IN (${ORG_A}, ${ORG_B})`);
}

/** Run fn inside a transaction with the given app role GUC (mirrors runAs). */
function asRole<T>(
  db: ReturnType<typeof createFreshDatabase>['db'],
  role: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.role', ${role}, true)`);
    await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
    return fn(tx);
  });
}

describe('Sprint 2A T1 — payor schema foundation (live PG)', () => {
  /* ---- Schema ---- */
  dbIt('tables + enum + indexes exist after migration 0006', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const tables = await admin.db.execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN ('panel_companies','insurance_companies')
          ORDER BY table_name`,
    );
    expect((tables as unknown as RawRows).rows.map((r) => r.table_name))
      .toEqual(['insurance_companies', 'panel_companies']);

    const en = await admin.db.execute(
      sql`SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'payor_status' ORDER BY e.enumsortorder`,
    );
    expect((en as unknown as RawRows).rows.map((r) => r.enumlabel)).toEqual(['Active', 'Inactive']);

    const idx = await admin.db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE tablename IN ('panel_companies','insurance_companies')
          ORDER BY indexname`,
    );
    const names = (idx as unknown as RawRows).rows.map((r) => r.indexname);
    expect(names).toEqual(expect.arrayContaining([
      'panel_companies_org_code_uq', 'panel_companies_org_name_uq', 'panel_companies_org_status_idx',
      'insurance_companies_org_code_uq', 'insurance_companies_org_name_uq', 'insurance_companies_org_status_idx',
    ]));
    await admin.close();
  });

  dbIt('ADR-004 guard: no invoice/payment/revenue/outstanding/bukku columns on payor tables', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const cols = await admin.db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name IN ('panel_companies','insurance_companies')
          AND column_name ~ '(invoice|payment|amount|revenue|outstanding|bukku|claim|treatment|branch)'`,
    );
    expect((cols as unknown as RawRows).rows).toHaveLength(0);
    await admin.close();
  });

  dbIt('RLS is ENABLED + FORCED on both tables', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const r = await admin.db.execute(
      sql`SELECT relname FROM pg_class
          WHERE relname IN ('panel_companies','insurance_companies')
          AND relrowsecurity = true AND relforcerowsecurity = true
          ORDER BY relname`,
    );
    expect((r as unknown as RawRows).rows.map((x) => x.relname))
      .toEqual(['insurance_companies', 'panel_companies']);
    await admin.close();
  });

  /* ---- Role matrix at DB level ---- */
  dbIt('hq: read + write allowed', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const inserted = await asRole(db, 'hq', async (tx) => {
      const rows = await tx.execute(
        sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T001', 'HQ Panel')
            RETURNING id::text AS id`,
      );
      return (rows as unknown as RawRows).rows[0]!.id;
    });
    expect(inserted).toBeTruthy();
    const seen = await asRole(db, 'hq', async (tx) => {
      const rows = await tx.execute(sql`SELECT name FROM panel_companies WHERE org_id = ${ORG_A}`);
      return (rows as unknown as RawRows).rows.map((r) => r.name);
    });
    expect(seen).toContain('HQ Panel');
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('branch_manager: read allowed, write DENIED (WITH CHECK hq-only)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T002', 'BM Visible')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const seen = await asRole(db, 'branch_manager', async (tx) => {
      const rows = await tx.execute(sql`SELECT name FROM panel_companies WHERE org_id = ${ORG_A}`);
      return (rows as unknown as RawRows).rows.map((r) => r.name);
    });
    expect(seen).toContain('BM Visible');
    await expect(
      asRole(db, 'branch_manager', async (tx) => {
        await tx.execute(
          sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T003', 'BM Write')`,
        );
      }),
    ).rejects.toThrow();
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('branch_admin (reception): read DENIED, write DENIED', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T004', 'Hidden From Reception')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const seen = await asRole(db, 'branch_admin', async (tx) => {
      const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM panel_companies WHERE org_id = ${ORG_A}`);
      return (rows as unknown as RawRows).rows[0]!.n;
    });
    expect(seen).toBe(0);
    await expect(
      asRole(db, 'branch_admin', async (tx) => {
        await tx.execute(
          sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T005', 'Reception Write')`,
        );
      }),
    ).rejects.toThrow();
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('doctor: read DENIED, write DENIED (no accidental Finance/Panel access)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO insurance_companies (org_id, code, name) VALUES (${ORG_A}, 'INS-T001', 'Hidden From Doctor')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const seen = await asRole(db, 'doctor', async (tx) => {
      const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM insurance_companies WHERE org_id = ${ORG_A}`);
      return (rows as unknown as RawRows).rows[0]!.n;
    });
    expect(seen).toBe(0);
    await expect(
      asRole(db, 'doctor', async (tx) => {
        await tx.execute(
          sql`INSERT INTO insurance_companies (org_id, code, name) VALUES (${ORG_A}, 'INS-T002', 'Doctor Write')`,
        );
      }),
    ).rejects.toThrow();
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('fail-closed: no app context → zero rows visible', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T006', 'No Context Row')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    /* plain transaction WITHOUT set_config — app_role() IS NULL → deny */
    const n = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM panel_companies WHERE org_id = ${ORG_A}`);
      return (rows as unknown as RawRows).rows[0]!.n;
    });
    expect(n).toBe(0);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Uniqueness + grants ---- */
  dbIt('case-insensitive name uniqueness per org (Active + Inactive both count)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name, status) VALUES (${ORG_A}, 'PNL-T007', 'AIA PANEL', 'Inactive')`,
    );
    /* different case + inactive original → still duplicate */
    await expect(
      admin.db.execute(
        sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T008', 'aia panel')`,
      ),
    ).rejects.toThrow();
    /* different org → allowed */
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_B}, 'PNL-T009', 'AIA PANEL')`,
    );
    await purge(admin.db);
    await admin.close();
  });

  dbIt('DELETE is not granted to the runtime role (soft-delete contract)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-T010', 'Undeletable')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    await expect(
      asRole(db, 'hq', async (tx) => {
        await tx.execute(sql`DELETE FROM panel_companies WHERE org_id = ${ORG_A}`);
      }),
    ).rejects.toThrow();
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('allocator sequences exist for the canonical org (medini_pnl_/medini_ins_00000001)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const r = await admin.db.execute(
      sql`SELECT sequencename FROM pg_sequences WHERE sequencename IN ('medini_pnl_00000001','medini_ins_00000001') ORDER BY sequencename`,
    );
    expect((r as unknown as RawRows).rows.map((x) => x.sequencename))
      .toEqual(['medini_ins_00000001', 'medini_pnl_00000001']);
    await admin.close();
  });

  dbIt('existing RLS-scoped tables unchanged (patients/appointments policies intact)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const r = await admin.db.execute(
      sql`SELECT tablename, policyname FROM pg_policies
          WHERE tablename IN ('patients','appointments','payment_status','branches',
                              'patient_relationships','patient_timeline_events')
          ORDER BY tablename`,
    );
    /* 6 existing policies must still be present — T1 adds, never removes */
    expect((r as unknown as RawRows).rows.length).toBeGreaterThanOrEqual(6);
    await admin.close();
  });
});
