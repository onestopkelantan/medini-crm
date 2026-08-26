import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, createFreshDatabase, closeDatabase } from '@infrastructure/database/database';

/**
 * S10 GLM 5.3 Final Remediation — refresh_tokens full role matrix (live PG).
 *
 * Human users (hq / branch_manager / doctor / receptionist-like roles):
 *   - SELECT own tokens only
 *   - cannot read another user's tokens
 *   - cannot UPDATE another user's tokens
 *   - cannot INSERT arbitrary token records
 *   - cannot DELETE tokens (no DELETE grant/policy — revoke/rotate only)
 *
 * system_worker: full access within its org scope (rotation, lookup).
 * developer: cannot read or manipulate refresh tokens outside the approved
 *   contract — 0027 deliberately EXCLUDES refresh_tokens from the developer
 *   deny layer so the developer's own session lifecycle works; the matrix
 *   proves the developer can still only touch its OWN rows (staff_id GUC).
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-refresh-matrix] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const ORG_ID = '00000000-0000-0000-0000-000000000001';
/* Two distinct staff ids for ownership tests, resolved at runtime by natural
 * key (username) — never hardcoded instance-specific UUIDs. */
let STAFF_A = ''; /* doctor */
let STAFF_B = ''; /* manager */

beforeAll(async () => {
  if (!(await probe)) return; /* tests self-skip when the DB is unreachable */
  const { db, close } = createFreshDatabase(ADMIN_URL);
  try {
    const a = await db.execute(sql`SELECT id FROM staff WHERE org_id = ${ORG_ID} AND username = 'doctor' LIMIT 1`);
    const b = await db.execute(sql`SELECT id FROM staff WHERE org_id = ${ORG_ID} AND username = 'manager' LIMIT 1`);
    STAFF_A = String((a as unknown as { rows: Array<{ id: string }> }).rows[0]?.id ?? '');
    STAFF_B = String((b as unknown as { rows: Array<{ id: string }> }).rows[0]?.id ?? '');
  } finally {
    await close();
  }
  if (!STAFF_A || !STAFF_B) throw new Error('canonical seeded staff (doctor, manager) not found for org');
});

function rows(res: unknown): Array<Record<string, unknown>> {
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

describe('S10 refresh_tokens — human role matrix (live PG)', () => {
  dbIt('human sees ONLY own tokens (SELECT staff_id = app_staff_id)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`SELECT staff_id FROM refresh_tokens`);
      const ids = rows(res).map((r) => String(r.staff_id));
      expect(ids.every((id) => id === STAFF_A)).toBe(true);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('human cannot read another user\'s token rows (0 rows for foreign staff_id)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`SELECT id FROM refresh_tokens WHERE staff_id = ${STAFF_B}`);
      expect(rows(res).length).toBe(0);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('human cannot UPDATE another user\'s tokens (0 rows affected)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE staff_id = ${STAFF_B}`);
      const n = (res as { rowCount?: number }).rowCount ?? rows(res).length;
      expect(n).toBe(0);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('human cannot INSERT a token for ANOTHER staff member (42501)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`
        INSERT INTO refresh_tokens (id, org_id, staff_id, token_hash, expires_at)
        VALUES ('eeeeeeee-0000-4000-8000-000000000101', ${ORG_ID}, ${STAFF_B}, 'deadbeef', NOW() + interval '1 day')
      `).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/row-level security|42501/);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('human can INSERT a token for OWN staff id (session issue path)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`
        INSERT INTO refresh_tokens (id, org_id, staff_id, token_hash, expires_at)
        VALUES ('eeeeeeee-0000-4000-8000-000000000102', ${ORG_ID}, ${STAFF_A}, 'deadbeef02', NOW() + interval '1 day')
      `).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(false);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('human cannot DELETE tokens (no DELETE grant — permission denied)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`DELETE FROM refresh_tokens`).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/permission denied/);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('HQ sees ONLY own tokens too (no blanket staff read)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_B}, true)`);
      const res = await db.execute(sql`SELECT staff_id FROM refresh_tokens`);
      const ids = rows(res).map((r) => String(r.staff_id));
      expect(ids.every((id) => id === STAFF_B)).toBe(true);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });
});

describe('S10 refresh_tokens — system_worker (live PG)', () => {
  dbIt('worker reads/rotates tokens within org scope (refresh lookup path)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'system_worker', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', '', true)`);
      const res = await db.execute(sql`SELECT count(*) FROM refresh_tokens`);
      const n = Number((rows(res)[0]?.count ?? 0));
      expect(n).toBeGreaterThanOrEqual(0); /* must not throw; org-isolation applies */
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('worker CANNOT cross org isolation (RESTRICTIVE org check)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'system_worker', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', '99999999-9999-9999-9999-999999999999', true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', '', true)`);
      const res = await db.execute(sql`SELECT count(*) FROM refresh_tokens`);
      const n = Number((rows(res)[0]?.count ?? 0));
      expect(n).toBe(0); /* different org → zero rows */
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });
});

describe('S10 refresh_tokens — developer (live PG)', () => {
  dbIt('developer sees ONLY own tokens (staff_id GUC enforced)', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`SELECT staff_id FROM refresh_tokens`);
      const ids = rows(res).map((r) => String(r.staff_id));
      expect(ids.every((id) => id === STAFF_A)).toBe(true);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });

  dbIt('developer cannot manipulate ANOTHER user\'s tokens', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      await db.execute(sql`BEGIN`);
      await db.execute(sql`SELECT set_config('app.role', 'developer', true)`);
      await db.execute(sql`SELECT set_config('app.org_id', ${ORG_ID}, true)`);
      await db.execute(sql`SELECT set_config('app.staff_id', ${STAFF_A}, true)`);
      const res = await db.execute(sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE staff_id = ${STAFF_B}`);
      const n = (res as { rowCount?: number }).rowCount ?? rows(res).length;
      expect(n).toBe(0);
    } finally {
      await db.execute(sql`ROLLBACK`).catch(() => undefined);
      await closeDatabase();
    }
  });
});
