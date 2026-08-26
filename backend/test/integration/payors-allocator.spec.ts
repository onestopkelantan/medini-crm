import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';
import { OrgAllocator } from '@shared/allocators/org-allocator';

/**
 * Sprint 2A T2 — payor allocator extension (live PG).
 * Proves PNL/INS codes use the same org-safe, concurrency-safe sequence
 * mechanism as MRN/APT, WITHOUT regressing the existing allocators.
 * Honest skip (ctx.skip) when the DB is genuinely unreachable.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[payor-allocator] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const ORG_A = '99999999-9999-9999-9999-9999999999b1';
const ORG_B = '99999999-9999-9999-9999-9999999999b2';

function keyOf(org: string): string {
  return org.replace(/-/g, '').slice(-8).toLowerCase();
}

async function ensureSequences(admin: ReturnType<typeof createFreshDatabase>['db'], orgs: string[]): Promise<void> {
  for (const org of orgs) {
    const key = keyOf(org);
    for (const prefix of ['mrn', 'apt', 'pnl', 'ins']) {
      await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_${prefix}_${key}`)} START WITH 1`);
      await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_${prefix}_${key}`)} RESTART WITH 1`);
    }
  }
}

describe('Sprint 2A T2 — payor code allocation (live PG)', () => {
  dbIt('PNL codes start at PNL-0001 and increment for a fresh org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextPanelCode(ORG_A)).toBe('PNL-0001');
    expect(await a.nextPanelCode(ORG_A)).toBe('PNL-0002');
    await close();
  });

  dbIt('INS codes start at INS-0001 and increment for a fresh org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextInsuranceCode(ORG_A)).toBe('INS-0001');
    expect(await a.nextInsuranceCode(ORG_A)).toBe('INS-0002');
    await close();
  });

  dbIt('10 concurrent Panel code requests never collide', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => new OrgAllocator(db).nextPanelCode(ORG_A)),
    );
    expect(new Set(results).size).toBe(10);
    expect(results.every((c) => /^PNL-\d{4}$/.test(c))).toBe(true);
    await close();
  });

  dbIt('10 concurrent Insurance code requests never collide', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => new OrgAllocator(db).nextInsuranceCode(ORG_A)),
    );
    expect(new Set(results).size).toBe(10);
    expect(results.every((c) => /^INS-\d{4}$/.test(c))).toBe(true);
    await close();
  });

  dbIt('PNL/INS codes are org-isolated (both orgs start at 0001)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A, ORG_B]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextPanelCode(ORG_A)).toBe('PNL-0001');
    expect(await a.nextPanelCode(ORG_B)).toBe('PNL-0001');
    expect(await a.nextInsuranceCode(ORG_A)).toBe('INS-0001');
    expect(await a.nextInsuranceCode(ORG_B)).toBe('INS-0001');
    await close();
  });

  /* ---- Regression: existing allocators must be unchanged ---- */
  dbIt('MRN regression: allocation unchanged after allocator extension', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextMrn(ORG_A)).toBe('MDN-0001');
    expect(await a.nextMrn(ORG_A)).toBe('MDN-0002');
    await close();
  });

  dbIt('APT regression: allocation unchanged after allocator extension', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextAptCode(ORG_A)).toBe('APT-0001');
    expect(await a.nextAptCode(ORG_A)).toBe('APT-0002');
    await close();
  });

  dbIt('sequences are independent: PNL allocation does not consume MRN/APT/INS counters', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextPanelCode(ORG_A)).toBe('PNL-0001');
    expect(await a.nextMrn(ORG_A)).toBe('MDN-0001');
    expect(await a.nextAptCode(ORG_A)).toBe('APT-0001');
    expect(await a.nextInsuranceCode(ORG_A)).toBe('INS-0001');
    await close();
  });
});
