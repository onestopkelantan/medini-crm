import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { OrgAllocator } from '@shared/allocators/org-allocator';

/**
 * Sprint 3 (S3-A) — clinical allocator extension (live PG).
 * Proves ENC/TPL/TRT codes use the same org-safe, concurrency-safe sequence
 * mechanism as MRN/APT/PNL/INS WITHOUT regressing the existing allocators.
 * Mirrors payors-allocator.spec.ts. Honest skip when DB unreachable.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[clinical-allocator] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const ORG_A = '99999999-9999-9999-9999-9999999999d1';
const ORG_B = '99999999-9999-9999-9999-9999999999d2';

function keyOf(org: string): string {
  return org.replace(/-/g, '').slice(-8).toLowerCase();
}

async function ensureSequences(admin: ReturnType<typeof createFreshDatabase>['db'], orgs: string[]): Promise<void> {
  for (const org of orgs) {
    const key = keyOf(org);
    for (const prefix of ['mrn', 'apt', 'pnl', 'ins', 'enc', 'tpl', 'trt']) {
      await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_${prefix}_${key}`)} START WITH 1`);
      await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_${prefix}_${key}`)} RESTART WITH 1`);
    }
  }
}

describe('Sprint 3 S3-A — clinical code allocation (live PG)', () => {
  dbIt('ENC/TPL/TRT codes start at 0001 and increment for a fresh org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextEncounterCode(ORG_A)).toBe('ENC-0001');
    expect(await a.nextEncounterCode(ORG_A)).toBe('ENC-0002');
    expect(await a.nextPlanCode(ORG_A)).toBe('TPL-0001');
    expect(await a.nextTreatmentCode(ORG_A)).toBe('TRT-0001');
    await close();
  });

  dbIt('10 concurrent ENC allocations never collide', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => new OrgAllocator(db).nextEncounterCode(ORG_A)),
    );
    expect(new Set(results).size).toBe(10);
    expect(results.every((c) => /^ENC-\d{4}$/.test(c))).toBe(true);
    await close();
  });

  dbIt('10 concurrent TPL allocations never collide', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => new OrgAllocator(db).nextPlanCode(ORG_A)),
    );
    expect(new Set(results).size).toBe(10);
    expect(results.every((c) => /^TPL-\d{4}$/.test(c))).toBe(true);
    await close();
  });

  dbIt('clinical codes are org-isolated (both orgs start at 0001)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A, ORG_B]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextEncounterCode(ORG_A)).toBe('ENC-0001');
    expect(await a.nextEncounterCode(ORG_B)).toBe('ENC-0001');
    expect(await a.nextPlanCode(ORG_A)).toBe('TPL-0001');
    expect(await a.nextPlanCode(ORG_B)).toBe('TPL-0001');
    await close();
  });

  dbIt('REGRESSION: existing MRN/APT/PNL/INS allocators unchanged', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A]);
    await admin.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = new OrgAllocator(db);
    expect(await a.nextMrn(ORG_A)).toBe('MDN-0001');
    expect(await a.nextAptCode(ORG_A)).toBe('APT-0001');
    expect(await a.nextPanelCode(ORG_A)).toBe('PNL-0001');
    expect(await a.nextInsuranceCode(ORG_A)).toBe('INS-0001');
    await close();
  });
});
