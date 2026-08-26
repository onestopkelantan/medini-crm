import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { seed } from '@infrastructure/database/seed';

/**
 * Sprint 2A T4 — production Panel seed verification (live PG).
 *
 * Verifies the 3 canonical seed panels (AIA PANEL, MEDNEFITS, PMCARE) against
 * the CANONICAL org. Deterministic on a clean DB: PNL-0001/0002/0003.
 * Idempotent: repeated seed runs never duplicate and never overwrite.
 * Insurance seed intentionally absent (initial state = no records).
 *
 * CLEAN-DB GUARD: this spec only asserts exact code values when the canonical
 * org's panel table is empty at the start of the run; otherwise it verifies
 * idempotency + no-overwrite semantics without assuming code numbers.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[seed-payors] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const CANONICAL_ORG = '00000000-0000-0000-0000-000000000001';
const SEED_NAMES = ['AIA PANEL', 'MEDNEFITS', 'PMCARE'];

interface RawRows { rows: Array<Record<string, unknown>> }

async function seedPanels(admin: ReturnType<typeof createFreshDatabase>['db']) {
  const r = await admin.execute(
    sql`SELECT code, name, status, source FROM panel_companies
        WHERE org_id = ${CANONICAL_ORG} AND deleted_at IS NULL
        AND name IN ('AIA PANEL','MEDNEFITS','PMCARE') ORDER BY name`,
  );
  return (r as unknown as RawRows).rows as unknown as Array<{
    code: string; name: string; status: string; source: string;
  }>;
}

describe('Sprint 2A T4 — production Panel seed (live PG)', () => {
  dbIt('seed provisions exactly the 3 canonical panels (Active, source=seed)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const before = await seedPanels(admin.db);
    await seed(ADMIN_URL);
    const after = await seedPanels(admin.db);
    expect(after.map((p) => p.name).sort()).toEqual([...SEED_NAMES].sort());
    for (const p of after) {
      expect(p.status).toBe('Active');
      expect(p.source).toBe('seed');
      expect(p.code).toMatch(/^PNL-\d{4}$/);
    }
    /* codes unique across the 3 */
    expect(new Set(after.map((p) => p.code)).size).toBe(3);
    /* clean-DB determinism: when the table started empty, codes are 0001-0003 */
    if (before.length === 0) {
      expect(after.map((p) => p.code).sort()).toEqual(['PNL-0001', 'PNL-0002', 'PNL-0003']);
    }
    await admin.close();
  });

  dbIt('repeated seed is idempotent: no duplicates, no overwrite of existing rows', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await seed(ADMIN_URL);
    const first = await seedPanels(admin.db);
    expect(first).toHaveLength(3);
    /* capture codes, then rerun twice */
    const codesBefore = first.map((p) => `${p.name}:${p.code}`).sort();
    await seed(ADMIN_URL);
    await seed(ADMIN_URL);
    const after = await seedPanels(admin.db);
    expect(after).toHaveLength(3);
    expect(after.map((p) => `${p.name}:${p.code}`).sort()).toEqual(codesBefore);
    /* total canonical panel count stays exactly 3 (no dupes from reruns) */
    const total = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM panel_companies
          WHERE org_id = ${CANONICAL_ORG} AND deleted_at IS NULL`,
    );
    expect((total as unknown as RawRows).rows[0]!.n).toBe(3);
    await admin.close();
  });

  dbIt('seed does not touch user-edited fields on rerun (ON CONFLICT DO NOTHING)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await seed(ADMIN_URL);
    /* simulate a user edit on a seeded row */
    await admin.db.execute(
      sql`UPDATE panel_companies SET pic = 'User Edited PIC'
          WHERE org_id = ${CANONICAL_ORG} AND name = 'MEDNEFITS'`,
    );
    await seed(ADMIN_URL);
    const r = await admin.db.execute(
      sql`SELECT pic FROM panel_companies WHERE org_id = ${CANONICAL_ORG} AND name = 'MEDNEFITS'`,
    );
    expect((r as unknown as RawRows).rows[0]!.pic).toBe('User Edited PIC');
    /* restore canonical state (seed rows should carry no test edit) */
    await admin.db.execute(
      sql`UPDATE panel_companies SET pic = NULL
          WHERE org_id = ${CANONICAL_ORG} AND name = 'MEDNEFITS'`,
    );
    await admin.close();
  });

  dbIt('insurance seed intentionally absent: insurance_companies stays empty for canonical org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await seed(ADMIN_URL);
    const r = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM insurance_companies WHERE org_id = ${CANONICAL_ORG}`,
    );
    expect((r as unknown as RawRows).rows[0]!.n).toBe(0);
    await admin.close();
  });
});
