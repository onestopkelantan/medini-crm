import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';

/**
 * Tier 2 (T2-A / FAMILY-1) — permanent regression tests for org isolation on
 * the identity tables (staff, role_assignments). Migration 0029 closes the
 * cross-org READ leak at the DB layer (previously only closed at the API).
 *
 * Design under test: `app_org_id() IS NULL OR org_id = app_org_id()` —
 * SELECT-only RESTRICTIVE. NULL-org is inert (no-GUC login path unaffected);
 * an authenticated runAs context is org-scoped.
 *
 * Every test runs as the real medini_app role inside BEGIN/ROLLBACK — no
 * mutation persists.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[t2-org-isolation] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const CANON = '00000000-0000-0000-0000-000000000001';
/* A scratch org that owns NO rows in the canonical sense (used by S7 tests). */
const TESTORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000701';

function n(res: unknown): number {
  return Number(((res as { rows?: Array<{ c?: string | number }> }).rows?.[0]?.c) ?? 0);
}

describe('T2-A — staff org isolation (RLS, live PG)', () => {
  dbIt('hq on a non-canonical org sees ONLY that org staff (cross-org read denied)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${TESTORG}, true)`);
      const own = await db.execute(sql`SELECT count(*) AS c FROM staff`);
      const total = await db.execute(sql`SELECT count(*) AS c FROM staff WHERE org_id = ${TESTORG}`);
      /* every visible row belongs to the GUC org (no cross-org leak) */
      expect(n(own)).toBe(n(total));
    } finally { await db.execute(sql`ROLLBACK`).catch(() => undefined); await closeDatabase(); }
  });

  dbIt('hq on canonical org sees canonical staff (single-tenant behaviour intact)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${CANON}, true)`);
      const vis = await db.execute(sql`SELECT count(*) AS c FROM staff`);
      const canon = await db.execute(sql`SELECT count(*) AS c FROM staff WHERE org_id = ${CANON}`);
      expect(n(vis)).toBe(n(canon));
      expect(n(vis)).toBeGreaterThan(0);
    } finally { await db.execute(sql`ROLLBACK`).catch(() => undefined); await closeDatabase(); }
  });

  dbIt('no-GUC pre-auth login lookup still reads staff (org deny inert without GUC)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      /* No GUC set at all — the PrincipalResolver/login path. */
      const res = await db.execute(sql`SELECT count(*) AS c FROM staff`);
      expect(n(res)).toBeGreaterThan(0);
    } finally { await closeDatabase(); }
  });

  dbIt('cross-org staff UPDATE affects 0 rows (USING makes foreign rows invisible)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${TESTORG}, true)`);
      const res = await db.execute(sql`UPDATE staff SET name = name WHERE org_id = ${CANON}`);
      const cnt = (res as { rowCount?: number }).rowCount ?? (res as { rows?: unknown[] }).rows?.length ?? -1;
      expect(cnt).toBe(0);
    } finally { await db.execute(sql`ROLLBACK`).catch(() => undefined); await closeDatabase(); }
  });
});

describe('T2-A — role_assignments org isolation (RLS, live PG)', () => {
  dbIt('non-canonical org sees 0 cross-org role assignments', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${TESTORG}, true)`);
      const vis = await db.execute(sql`SELECT count(*) AS c FROM role_assignments`);
      const own = await db.execute(sql`SELECT count(*) AS c FROM role_assignments WHERE org_id = ${TESTORG}`);
      expect(n(vis)).toBe(n(own));
    } finally { await db.execute(sql`ROLLBACK`).catch(() => undefined); await closeDatabase(); }
  });

  dbIt('canonical org role assignments remain visible to canonical hq', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${CANON}, true)`);
      const vis = await db.execute(sql`SELECT count(*) AS c FROM role_assignments`);
      expect(n(vis)).toBeGreaterThan(0);
    } finally { await db.execute(sql`ROLLBACK`).catch(() => undefined); await closeDatabase(); }
  });
});
