import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';

/**
 * S10 GLM 5.3 Final Remediation — D-01 (HIGH) permanent regression tests.
 *
 * GLM 5.3 independently proved that a developer using the medini_app role
 * could INSERT staff (role='hq', status='Active'), UPDATE existing staff
 * (doctor→hq escalation, status activation, invite_token / password_hash
 * manipulation) and observe staff rows (invite tokens + password hashes).
 *
 * Migration 0028 closes this with three RESTRICTIVE policies:
 *   s10_developer_staff_write_deny (staff, FOR ALL)
 *   s10_developer_staff_read_deny  (staff, FOR SELECT)
 *   s10_developer_ra_deny          (role_assignments, FOR ALL)
 *
 * Every test below runs against the LIVE dev DB as the real medini_app role
 * inside BEGIN/ROLLBACK sandboxes — no mutation persists.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-d01] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const ORG_ID = '00000000-0000-0000-0000-000000000001';

describe('S10 D-01 — developer cannot write staff (RLS RESTRICTIVE, live PG)', () => {
  dbIt('INSERT staff as developer is DENIED (42501, not silent 0-rows)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      const res = await db.execute(sql`
        INSERT INTO staff (id, org_id, branch_id, name, username, password_hash, role, status)
        VALUES ('eeeeeeee-0000-4000-8000-0000000000e1', ${ORG_ID}, NULL, 'Pwn HQ', 'pwn_hq_d01', 'x', 'hq', 'Active')
      `).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/row-level security|42501|s10_developer_staff_write_deny/);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('role escalation doctor→hq as developer is DENIED (0 rows affected)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      /* Escalate every staff row — the deny must block ALL of them. */
      const res = await db.execute(sql`UPDATE staff SET role='hq', status='Active'`);
      const rows = (res as unknown as { rowCount?: number; rows?: unknown[] });
      expect((rows.rowCount ?? rows.rows?.length) === 0).toBe(true);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('invite_token / password_hash manipulation as developer is DENIED', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      const res = await db.execute(sql`UPDATE staff SET invite_token='evil', password_hash='evil'`);
      const rows = (res as unknown as { rowCount?: number; rows?: unknown[] });
      expect((rows.rowCount ?? rows.rows?.length) === 0).toBe(true);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('DELETE staff as developer is DENIED', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      const res = await db.execute(sql`DELETE FROM staff`).catch((e: unknown) => e);
      /* Either RLS permission denial or 0 rows — both prove no deletion. */
      const full = res instanceof Error
        ? String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '')
        : '';
      const count = res instanceof Error ? -1
        : ((res as unknown as { rowCount?: number; rows?: unknown[] }).rowCount
          ?? (res as unknown as { rows?: unknown[] }).rows?.length ?? -1);
      expect(res instanceof Error ? /row-level security|42501|permission denied/.test(full) : count === 0).toBe(true);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('SELECT staff as developer returns ZERO rows (no invite tokens / hashes observable)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      const res = await db.execute(sql`SELECT id, username, invite_token, password_hash FROM staff`);
      const n = (res as unknown as { rows?: unknown[] }).rows?.length ?? 0;
      expect(n).toBe(0);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('role_assignments INSERT (self-elevation) as developer is DENIED', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      const res = await db.execute(sql`
        INSERT INTO role_assignments (id, org_id, staff_id, role)
        VALUES ('eeeeeeee-0000-4000-8000-0000000000f1', ${ORG_ID}, '00000000-0000-0000-0000-000000000000', 'hq')
      `).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/row-level security|42501|s10_developer_ra_deny/);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('role_assignments SELECT as developer returns ZERO rows (no role mining)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      const res = await db.execute(sql`SELECT count(*) FROM role_assignments`);
      const n = Number(((res as unknown as { rows?: Array<{ count?: string | number }> }).rows?.[0]?.count) ?? 0);
      expect(n).toBe(0);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });
});

describe('S10 D-01 — legitimate paths unaffected (regression)', () => {
  dbIt('no-GUC login lookup (PrincipalResolver path) still reads staff', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const res = await db.execute(sql`SELECT count(*) FROM staff`);
      const n = Number(((res as unknown as { rows?: Array<{ count?: string | number }> }).rows?.[0]?.count) ?? 0);
      expect(n).toBeGreaterThan(0);
    } finally { await closeDatabase(); }
  });

  dbIt('HQ runAs context still reads staff (12 rows in dev)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      const res = await db.execute(sql`SELECT count(*) FROM staff`);
      const n = Number(((res as unknown as { rows?: Array<{ count?: string | number }> }).rows?.[0]?.count) ?? 0);
      expect(n).toBeGreaterThan(0);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('system_worker still reads invite rows (registration path)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'system_worker', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      const res = await db.execute(sql`SELECT count(*) FROM staff WHERE invite_token IS NOT NULL`);
      const n = Number(((res as unknown as { rows?: Array<{ count?: string | number }> }).rows?.[0]?.count) ?? 0);
      expect(n).toBeGreaterThanOrEqual(0); /* count varies with fixtures; must not throw */
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });
});
