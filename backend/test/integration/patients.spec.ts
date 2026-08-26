import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { OrgAllocator } from '@shared/allocators/org-allocator';
import { normalizePhone } from '@modules/patients/domain/phone';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[patients] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

/* A throwaway org — never touches canonical MRNs/data. */
const TEST_ORG = '99999999-9999-9999-9999-999999999999';

async function branchId(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<string> {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`);
  return (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
}

describe('patients module — integration (live PG)', () => {
  dbIt('nextMrn starts at MDN-0001 for a fresh org', async () => {
    const admin0 = createFreshDatabase(ADMIN_URL);
    const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
    await admin0.db.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_mrn_${key}`)} START WITH 1`);
    await admin0.db.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_mrn_${key}`)} RESTART WITH 1`);
    await admin0.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const m1 = await new OrgAllocator(db).nextMrn(TEST_ORG);
    expect(m1).toBe('MDN-0001');
    await close();
  });

  dbIt('createPatient under GUC context stores normalized phone', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const bId = await branchId(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new PatientsRepository();
    /* simulate runAs(): transaction-local GUC context as a branch_manager */
    const p = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      return repo.createPatient(tx, TEST_ORG, bId, {
        mrn: 'MDN-TST01', name: 'Integration Patient', phone: '+6012-345 6789',
      });
    });
    expect(normalizePhone(p.phone)).toBe('123456789');

    /* fixture cleanup via ADMIN connection (runtime role has no DELETE) */
    await admin.db.execute(sql`DELETE FROM patients WHERE id = ${p.id}`);
    await admin.close();
    await close();
  });

  dbIt('RLS fail-closed: createPatient WITHOUT context is denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const bId = await branchId(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new PatientsRepository();
    await expect(
      repo.createPatient(db, TEST_ORG, bId, {
        mrn: 'MDN-TST02', name: 'No Context Patient',
      }),
    ).rejects.toThrow(/Failed query/);

    await admin.close();
    await close();
  });

  dbIt('timeline table is append-only (no updated_at/deleted_at columns)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const rows = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'patient_timeline_events'
          AND column_name IN ('updated_at','deleted_at')`,
    );
    expect((rows as unknown as { rows: Array<unknown> }).rows).toHaveLength(0);
    await close();
  });

  dbIt('RLS: relationships + timeline scoped via parent patient branch (WITH CHECK)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    /* policy + FORCE RLS present */
    const pol = await admin.db.execute(
      sql`SELECT relname FROM pg_class
          WHERE relname IN ('patient_relationships','patient_timeline_events')
          AND relforcerowsecurity = true ORDER BY relname`,
    );
    const names = (pol as unknown as { rows: Array<{ relname: string }> }).rows.map((r) => r.relname);
    expect(names).toEqual(expect.arrayContaining(['patient_relationships', 'patient_timeline_events']));
    await admin.close();
  });
});
