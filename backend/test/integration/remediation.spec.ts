import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';
import { OrgAllocator } from '@shared/allocators/org-allocator';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { AppointmentsRepository } from '@modules/appointments/infrastructure/appointments.repository';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[remediation] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const ORG_A = '99999999-9999-9999-9999-999999999970';
const ORG_B = '99999999-9999-9999-9999-999999999971';

async function twoBranchIds(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<[string, string]> {
  const rows = await admin.execute(
    sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`,
  );
  const list = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  return [list[0]!, list[1]!];
}

async function ensureSequences(admin: ReturnType<typeof createFreshDatabase>['db'], orgs: string[]): Promise<void> {
  for (const org of orgs) {
    const key = org.replace(/-/g, '').slice(-8).toLowerCase();
    await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_mrn_${key}`)} START WITH 1`);
    await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_apt_${key}`)} START WITH 1`);
    /* deterministic tests: reset counters each run */
    await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_mrn_${key}`)} RESTART WITH 1`);
    await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_apt_${key}`)} RESTART WITH 1`);
  }
}

async function purge(admin: ReturnType<typeof createFreshDatabase>['db'], org: string): Promise<void> {
  await admin.execute(sql`DELETE FROM appointments WHERE org_id = ${org}`);
  await admin.execute(sql`DELETE FROM patients WHERE org_id = ${org}`);
}

/** Run fn inside a transaction with branch_manager GUC context (like runAs). */
function withBranchContext<T>(
  db: ReturnType<typeof createFreshDatabase>['db'],
  branchId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
    await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
    await tx.execute(sql`SELECT set_config('app.branch_ids', ${branchId}, true)`);
    return fn(tx);
  });
}

describe('remediation — org-safe allocators (GLM #1 #2 #8)', () => {
  dbIt('pre-created sequences exist for test orgs (admin path)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin.db, [ORG_A, ORG_B]);
    const rows = await admin.db.execute(sql`SELECT count(*)::int AS n FROM pg_sequences WHERE sequencename LIKE 'medini_%'`);
    expect((rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBeGreaterThanOrEqual(4);
    await admin.close();
  });
  dbIt('MRN unique across branches in the SAME org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db, ORG_A);
    await ensureSequences(admin.db, [ORG_A]);
    const [b1, b2] = await twoBranchIds(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new PatientsRepository();
    const mk = (branch: string) => withBranchContext(db, branch, async (tx) => {
      const mrn = await new OrgAllocator(tx).nextMrn(ORG_A);
      await repo.createPatient(tx, ORG_A, branch, { mrn, name: 'Cross Branch' });
      return mrn;
    });
    const mrnA = await mk(b1);
    const mrnB = await mk(b2);
    expect(mrnA).not.toBe(mrnB);
    expect(mrnA).toMatch(/^MDN-\d{4}$/);
    expect(mrnB).toMatch(/^MDN-\d{4}$/);

    await purge(admin.db, ORG_A);
    await admin.close();
    await close();
  });

  dbIt('MRN sequence is org-isolated (both orgs start at MDN-0001)', async () => {
    const admin0 = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin0.db, [ORG_A, ORG_B]);
    await admin0.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a1 = await new OrgAllocator(db).nextMrn(ORG_A);
    const b1 = await new OrgAllocator(db).nextMrn(ORG_B);
    expect(a1).toBe('MDN-0001');
    expect(b1).toBe('MDN-0001');
    await close();
  });

  dbIt('concurrent MRN generation never collides (parallel nextval)', async () => {
    const admin0 = createFreshDatabase(ADMIN_URL);
    await ensureSequences(admin0.db, [ORG_A]);
    await admin0.close();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => new OrgAllocator(db).nextMrn(ORG_A)),
    );
    expect(new Set(results).size).toBe(10);
    await close();
  });

  dbIt('APT codes unique across branches in the SAME org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db, ORG_A);
    await ensureSequences(admin.db, [ORG_A]);
    const [b1, b2] = await twoBranchIds(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new AppointmentsRepository();
    const mk = (branch: string) => withBranchContext(db, branch, async (tx) => {
      const code = await new OrgAllocator(tx).nextAptCode(ORG_A);
      await repo.create(tx, ORG_A, branch, {
        code, patientId: null, patientName: 'Cross Branch',
        scheduledDate: '2026-10-01', scheduledTime: '09:00',
      });
      return code;
    });
    const codeA = await mk(b1);
    const codeB = await mk(b2);
    expect(codeA).not.toBe(codeB);
    expect(codeA).toMatch(/^APT-\d{4}$/);

    await purge(admin.db, ORG_A);
    await admin.close();
    await close();
  });

  dbIt('patient insert uses org-scoped MRN without hitting unique constraint', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db, ORG_A);
    await ensureSequences(admin.db, [ORG_A]);
    const [b1, b2] = await twoBranchIds(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new PatientsRepository();
    await withBranchContext(db, b1, async (t1) => {
      const m = await new OrgAllocator(t1).nextMrn(ORG_A);
      await repo.createPatient(t1, ORG_A, b1, { mrn: m, name: 'P-A' });
    });
    await withBranchContext(db, b2, async (t2) => {
      const m = await new OrgAllocator(t2).nextMrn(ORG_A);
      await repo.createPatient(t2, ORG_A, b2, { mrn: m, name: 'P-B' });
    });

    const rows = await admin.db.execute(
      sql`SELECT mrn FROM patients WHERE org_id = ${ORG_A} ORDER BY mrn`,
    );
    const mrns = (rows as unknown as { rows: Array<{ mrn: string }> }).rows.map((r) => r.mrn);
    expect(mrns).toEqual(['MDN-0001', 'MDN-0002']);

    await purge(admin.db, ORG_A);
    await admin.close();
    await close();
  });
});
