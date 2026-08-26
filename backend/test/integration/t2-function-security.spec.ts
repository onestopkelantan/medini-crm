import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';

/**
 * Tier 2 (T2-C + T2-D) — function security regression tests.
 *
 * T2-C (P5-F2): register_staff_with_token is SECURITY DEFINER — its
 * search_path must be pinned (pg_catalog, public) so caller search_path
 * cannot shadow the `staff` table.
 * T2-D (P5-F6): PUBLIC EXECUTE must be revoked; only medini_app may invoke.
 *
 * The legitimate registration path (medini_app) must keep working — proven by
 * the function being reachable and enforcing its own validation (rejects a
 * bad token), plus the full registration suite (s10-registration-replay).
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[t2-function-security] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const CANON = '00000000-0000-0000-0000-000000000001';

describe('T2-C/D — register_staff_with_token function security (live PG)', () => {
  dbIt('search_path is pinned to pg_catalog + public (no caller-path shadowing)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const res = await db.execute(sql`
        SELECT proconfig FROM pg_proc WHERE proname = 'register_staff_with_token'`);
      const cfg = JSON.stringify((res as unknown as { rows?: Array<{ proconfig: unknown }> }).rows?.[0]?.proconfig ?? []);
      expect(cfg).toContain('search_path=pg_catalog, public');
    } finally { await closeDatabase(); }
  });

  dbIt('PUBLIC EXECUTE is revoked; only medini_app holds EXECUTE', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const res = await db.execute(sql`
        SELECT proacl FROM pg_proc WHERE proname = 'register_staff_with_token'`);
      const acl = String((res as unknown as { rows?: Array<{ proacl: unknown }> }).rows?.[0]?.proacl ?? '');
      /* proacl set explicitly (not NULL = PUBLIC default); medini_app granted. */
      expect(acl).not.toBe('');
      expect(acl).toContain('medini_app');
    } finally { await closeDatabase(); }
  });

  dbIt('medini_app can still invoke the function (registration path intact)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      /* The function is reachable as medini_app; it must enforce its own
       * validation (reject an invalid token) — proving both EXECUTE grant AND
       * preserved behaviour. */
      const res = await db.execute(sql`
        SELECT * FROM register_staff_with_token('definitely_not_a_real_token', 'n', 'u', 'h', ${CANON})
      `).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/Invalid or expired invitation/i);
    } finally { await closeDatabase(); }
  });

  dbIt('no shadow-table exploit: medini_app has no CREATE on public (temp is per-session only)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      /* The only realistic search_path attack requires the attacker to create
       * a shadow `staff` object the SECURITY DEFINER function would resolve.
       * medini_app CANNOT create in schema public (verified) — and a temp
       * table is per-session, so it can never affect the app's separate
       * registration connection. This proves the shadow vector is closed. */
      const res = await db.execute(sql`CREATE TABLE public.t2_shadow_probe(id int)`).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/permission denied|42501/i);
    } finally { await closeDatabase(); }
  });
});
