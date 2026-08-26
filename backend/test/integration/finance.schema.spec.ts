import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createDatabase,
  closeDatabase,
} from '@infrastructure/database/database';

/**
 * S4-T1 Finance Foundation — schema verification (live PG).
 * Verifies migration 0009 applied: tables, sequences, RLS, FKs, unique
 * constraints, check constraints (money >= 0, commission formula, lab
 * overpayment guard), indexes, grants, and payment_status extension.
 *
 * Uses the same probe pattern as database.spec.ts — honest skip if DB down,
 * never a false pass.
 */
const URL =
  process.env.DATABASE_URL ??
  'postgres://medini:***@localhost:5433/medini_dev';

const probe: Promise<boolean> = pingDatabase(URL).then((ok) => {
  if (!ok) {
    console.warn('[finance.schema] PostgreSQL not reachable — SKIPPING (honest skip).');
  }
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const available = await probe;
    if (!available) ctx.skip();
    await fn();
  });
}

interface RawRows {
  rows: Array<Record<string, unknown>>;
}

const FINANCE_TABLES = [
  'sale_records', 'expenses', 'recurring_commitments', 'treatment_costs',
  'lab_payables', 'commission_ledger', 'commission_payouts', 'finance_alerts',
  'external_invoice_refs', 'bukku_sync_records', 'reconciliation_records',
];

describe('S4-T1 Finance Foundation (live PG)', () => {
  dbIt('migration state tracked: drizzle journal >= 9 OR manual-apply evidence (index 0010)', async () => {
    const db = createDatabase(URL);
    /* Drizzle-kit environments populate drizzle.__drizzle_migrations; CI applies
     * migrations manually via psql (by design — "surfaces real errors"), so the
     * tracking table does not exist there. Both environments must prove the
     * migration state is complete: journal count >= 9, or (manual apply) the
     * 0010 P1-remediation unique index is present — the latest-migration proof. */
    const probe = (await db.execute(
      sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_journal`,
    )) as unknown as RawRows;
    const hasJournal = probe.rows[0]!.has_journal === true;
    if (hasJournal) {
      const r = (await db.execute(
        sql`SELECT COUNT(*)::int AS c FROM drizzle.__drizzle_migrations`,
      )) as unknown as RawRows;
      expect(Number(r.rows[0]!.c)).toBeGreaterThanOrEqual(9);
    } else {
      const idx = (await db.execute(
        sql`SELECT COUNT(*)::int AS c FROM pg_indexes WHERE indexname = 'commission_ledger_org_doctor_period_uq'`,
      )) as unknown as RawRows;
      expect(Number(idx.rows[0]!.c)).toBe(1);
    }
    await closeDatabase();
  });

  dbIt('all 11 finance tables exist', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${sql.raw(`ARRAY['${FINANCE_TABLES.join("','")}']::text[]`)})
    `)) as unknown as RawRows;
    expect(r.rows.length).toBe(11);
    await closeDatabase();
  });

  dbIt('7 finance allocator sequences exist (sal/exp/rec/cst/lab/com/ext)', async () => {
    const db = createDatabase(URL);
    /* Scope to the CANONICAL org (00000001) — P1 remediation tests create
     * per-org sequences for throwaway test orgs on the shared dev DB. */
    const r = (await db.execute(sql`
      SELECT sequence_name FROM information_schema.sequences
      WHERE sequence_schema = 'public'
      AND sequence_name ~ 'medini_(sal|exp|rec|cst|lab|com|ext)_00000001$'
    `)) as unknown as RawRows;
    expect(r.rows.length).toBe(7);
    await closeDatabase();
  });

  dbIt('payment_status extended (confirmed_by/confirmed_at/external_ref/source_system)', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'payment_status'
      AND column_name IN ('confirmed_by', 'confirmed_at', 'external_ref', 'source_system')
    `)) as unknown as RawRows;
    expect(r.rows.length).toBe(4);
    await closeDatabase();
  });

  dbIt('RLS enabled+forced on all finance tables', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${sql.raw(`ARRAY['${FINANCE_TABLES.join("','")}']::text[]`)})
    `)) as unknown as RawRows;
    expect(r.rows.length).toBe(11);
    r.rows.forEach((row) => {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    });
    await closeDatabase();
  });

  dbIt('each finance table has an RLS policy', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${sql.raw(`ARRAY['${FINANCE_TABLES.join("','")}']::text[]`)})
    `)) as unknown as RawRows;
    const tables = new Set(r.rows.map((x) => x.tablename));
    expect(tables.size).toBe(11);
    await closeDatabase();
  });

  dbIt('foreign keys present on finance tables', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY'
      AND table_name IN ('sale_records','expenses','treatment_costs','lab_payables','commission_ledger','commission_payouts','external_invoice_refs','reconciliation_records')
    `)) as unknown as RawRows;
    expect(Number(r.rows[0]!.c)).toBeGreaterThanOrEqual(12);
    await closeDatabase();
  });

  dbIt('unique constraints present (org code + external ref idempotency)', async () => {
    const db = createDatabase(URL);
    /* unique indexes are the source of truth (drizzle uniqueIndex → unique idx);
     * count via pg_index joined to pg_class, not information_schema (which omits
     * some index-backed constraints depending on definition order). */
    const r = (await db.execute(sql`
      SELECT c.relname AS table_name, COUNT(*)::int AS c
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE i.indisunique AND n.nspname = 'public'
      AND c.relname IN ('sale_records','expenses','recurring_commitments','treatment_costs','lab_payables','commission_ledger','external_invoice_refs','bukku_sync_records')
      GROUP BY c.relname
    `)) as unknown as RawRows;
    const total = r.rows.reduce((a, x) => a + Number(x.c), 0);
    expect(total).toBeGreaterThanOrEqual(10);
    await closeDatabase();
  });

  dbIt('money check constraints (amount >= 0) present', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_type = 'CHECK'
      AND constraint_name LIKE '%positive%'
      AND table_name IN ('sale_records','expenses','recurring_commitments','treatment_costs','lab_payables','commission_ledger','commission_payouts','external_invoice_refs')
    `)) as unknown as RawRows;
    expect(r.rows.length).toBeGreaterThanOrEqual(10);
    await closeDatabase();
  });

  dbIt('commission ledger LOCKED formula check constraints (base/amount/net/outstanding)', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'commission_ledger' AND constraint_name LIKE '%calc%'
    `)) as unknown as RawRows;
    const names = r.rows.map((x) => String(x.constraint_name));
    expect(names.some((n) => n.includes('base_calc'))).toBe(true);
    expect(names.some((n) => n.includes('amount_calc'))).toBe(true);
    expect(names.some((n) => n.includes('net_payable_calc'))).toBe(true);
    expect(names.some((n) => n.includes('outstanding_calc'))).toBe(true);
    await closeDatabase();
  });

  dbIt('lab_payables overpayment guard (paid_amount <= amount) present', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'lab_payables' AND constraint_name LIKE '%overpayment%'
    `)) as unknown as RawRows;
    expect(r.rows.length).toBe(1);
    await closeDatabase();
  });

  dbIt('commission rate range guard (0..1) present', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'commission_ledger' AND constraint_name LIKE '%rate_range%'
    `)) as unknown as RawRows;
    expect(r.rows.length).toBe(1);
    await closeDatabase();
  });

  dbIt('indexes present on finance tables', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY(${sql.raw(`ARRAY['${FINANCE_TABLES.join("','")}']::text[]`)})
    `)) as unknown as RawRows;
    expect(Number(r.rows[0]!.c)).toBeGreaterThanOrEqual(30);
    await closeDatabase();
  });

  dbIt('medini_app has SELECT/INSERT/UPDATE grants (no DELETE) on finance tables', async () => {
    const db = createDatabase(URL);
    const r = (await db.execute(sql`
      SELECT table_name, privilege_type FROM information_schema.table_privileges
      WHERE grantee = 'medini_app' AND table_name = ANY(${sql.raw(`ARRAY['${FINANCE_TABLES.join("','")}']::text[]`)})
    `)) as unknown as RawRows;
    const byTable: Record<string, Set<string>> = {};
    r.rows.forEach((x) => {
      const t = String(x.table_name);
      byTable[t] = byTable[t] ?? new Set();
      byTable[t].add(String(x.privilege_type));
    });
    expect(Object.keys(byTable).length).toBe(11);
    Object.values(byTable).forEach((privs) => {
      expect(privs.has('SELECT')).toBe(true);
      expect(privs.has('INSERT')).toBe(true);
      expect(privs.has('UPDATE')).toBe(true);
      expect(privs.has('DELETE')).toBe(false);
    });
    await closeDatabase();
  });
});
