import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { AppointmentsRepository } from '@modules/appointments/infrastructure/appointments.repository';
import { OrgAllocator } from '@shared/allocators/org-allocator';
import { canTransition } from '@modules/appointments/domain/appointment-flow';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[appointments] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-999999999990';

/** Wipe any leftover fixtures for TEST_ORG so runs are idempotent. */
async function ensureTestSequence(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
  await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_apt_${key}`)} START WITH 1`);
  await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_apt_${key}`)} RESTART WITH 1`);
}

async function purgeTestData(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM appointments WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM patients WHERE org_id = ${TEST_ORG}`);
}

async function branchId(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<string> {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`);
  return (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
}

async function seedPatient(admin: ReturnType<typeof createFreshDatabase>['db'], bId: string): Promise<string> {
  const rows = await admin.execute(
    sql`INSERT INTO patients (org_id, branch_id, mrn, name)
        VALUES (${TEST_ORG}, ${bId}, 'MDN-TSTAP', 'Appt Patient')
        RETURNING id::text AS id`,
  );
  return (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
}

describe('appointments module — integration (live PG)', () => {
  dbIt('book creates an appointment with code APT-0001 and status booked', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureTestSequence(admin.db);
    await purgeTestData(admin.db);
    const bId = await branchId(admin.db);
    const patientId = await seedPatient(admin.db, bId);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new AppointmentsRepository();
    const appt = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);
      return repo.create(tx, TEST_ORG, bId, {
        code, patientId, patientName: 'Appt Patient',
        scheduledDate: '2026-09-01', scheduledTime: '09:00', durationMin: 30,
      });
    });
    expect(appt.code).toBe('APT-0001');
    expect(appt.status).toBe('booked');

    /* cleanup via admin (runtime has no DELETE) */
    await admin.db.execute(sql`DELETE FROM appointments WHERE id = ${appt.id}`);
    await admin.db.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await admin.close();
    await close();
  });

  dbIt('double-booking: same doctor overlapping time is rejected', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureTestSequence(admin.db);
    await purgeTestData(admin.db);
    const bId = await branchId(admin.db);
    const patientId = await seedPatient(admin.db, bId);
    const doctorId = await (async () => {
      const r = await admin.db.execute(sql`SELECT id::text AS id FROM staff WHERE role='doctor' LIMIT 1`);
      return (r as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    })();

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new AppointmentsRepository();
    const run = () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
        await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
        const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);
        return repo.create(tx, TEST_ORG, bId, {
          code, patientId, patientName: 'Appt Patient',
          doctorId, scheduledDate: '2026-09-02', scheduledTime: '10:00', durationMin: 60,
        });
      });

    const a = await run();
    const clash = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      return repo.findDoctorOverlap(tx, TEST_ORG, bId, doctorId, '2026-09-02', '10:30', 60);
    });
    expect(clash?.id).toBe(a.id);

    await admin.db.execute(sql`DELETE FROM appointments WHERE id = ${a.id}`);
    await admin.db.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await admin.close();
    await close();
  });

  dbIt('status transition + version optimistic lock works end to end', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureTestSequence(admin.db);
    await purgeTestData(admin.db);
    const bId = await branchId(admin.db);
    const patientId = await seedPatient(admin.db, bId);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new AppointmentsRepository();
    const appt = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);
      return repo.create(tx, TEST_ORG, bId, {
        code, patientId, patientName: 'Appt Patient',
        scheduledDate: '2026-09-03', scheduledTime: '11:00',
      });
    });

    expect(canTransition('booked', 'confirmed')).toBe(true);
    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      return repo.updateStatus(tx, TEST_ORG, appt.id, 'confirmed', appt.version);
    });
    expect(updated?.status).toBe('confirmed');
    expect(updated?.version).toBe(2);

    /* stale version → null (concurrent modification denied) */
    const stale = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      return repo.updateStatus(tx, TEST_ORG, appt.id, 'checked-in', 1);
    });
    expect(stale).toBeNull();

    await admin.db.execute(sql`DELETE FROM appointments WHERE id = ${appt.id}`);
    await admin.db.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await admin.close();
    await close();
  });

  dbIt('day queue returns only active statuses in time order', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await ensureTestSequence(admin.db);
    await purgeTestData(admin.db);
    const bId = await branchId(admin.db);
    const patientId = await seedPatient(admin.db, bId);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new AppointmentsRepository();
    const mk = async (time: string, status: string) => {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
        await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
        const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);
        const a = await repo.create(tx, TEST_ORG, bId, {
          code, patientId, patientName: 'Appt Patient',
          scheduledDate: '2026-09-04', scheduledTime: time, durationMin: 30,
        });
        if (status !== 'booked') await repo.updateStatus(tx, TEST_ORG, a.id, status, 1);
        return a;
      });
    };
    const later = await mk('14:00', 'waiting');
    const earlier = await mk('09:00', 'checked-in');
    await mk('15:00', 'completed'); /* excluded from queue */

    const queue = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'branch_manager', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${TEST_ORG}, true)`);
      await tx.execute(sql`SELECT set_config('app.branch_ids', ${bId}, true)`);
      return repo.dayQueue(tx, TEST_ORG, bId, '2026-09-04');
    });
    expect(queue.map((q) => q.id)).toEqual([earlier.id, later.id]);

    await admin.db.execute(sql`DELETE FROM appointments WHERE patient_id = ${patientId}`);
    await admin.db.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await admin.close();
    await close();
  });
});
