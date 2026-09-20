import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { AppointmentsRepository } from '@modules/appointments/infrastructure/appointments.repository';
import { OrgAllocator } from '@shared/allocators/org-allocator';
import { canTransition } from '@modules/appointments/domain/appointment-flow';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app_password@localhost:3306/medini_dev';

const probe = Promise.all([
  pingDatabase(ADMIN_URL),
  pingDatabase(RUNTIME_URL),
]).then(([adminOk, runtimeOk]) => {
  const ok = adminOk && runtimeOk;
  if (!ok) {
    console.warn(
      '[appointments] MySQL admin/runtime database not reachable - SKIPPING (honest skip).',
    );
  }
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) {
      ctx.skip();
      return;
    }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-999999999990';
const TEST_BRANCH = '99999999-9999-9999-9999-999999999991';
const TEST_DOCTOR = '99999999-9999-9999-9999-999999999992';

async function purgeTestData(
  admin: ReturnType<typeof createFreshDatabase>['db'],
): Promise<void> {
  await admin.execute(
    sql`DELETE FROM appointments WHERE org_id = ${TEST_ORG}`,
  );

  await admin.execute(
    sql`DELETE FROM patients WHERE org_id = ${TEST_ORG}`,
  );

  await admin.execute(
    sql`DELETE FROM org_counters WHERE org_id = ${TEST_ORG}`,
  );

  await admin.execute(
    sql`DELETE FROM staff WHERE org_id = ${TEST_ORG}`,
  );

  await admin.execute(
    sql`DELETE FROM branches WHERE org_id = ${TEST_ORG}`,
  );

  await admin.execute(
    sql`DELETE FROM organizations WHERE id = ${TEST_ORG}`,
  );
}

async function prepareFixtures(
  admin: ReturnType<typeof createFreshDatabase>['db'],
): Promise<void> {
  await purgeTestData(admin);

  await admin.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${TEST_ORG}, 'Appointments Integration Test')
  `);

  await admin.execute(sql`
    INSERT INTO branches (
      id,
      org_id,
      code,
      short_name,
      full_name
    )
    VALUES (
      ${TEST_BRANCH},
      ${TEST_ORG},
      'appt-test',
      'Appt Test',
      'Appointments Integration Test Branch'
    )
  `);

  await admin.execute(sql`
    INSERT INTO staff (
      id,
      org_id,
      branch_id,
      name,
      username,
      role
    )
    VALUES (
      ${TEST_DOCTOR},
      ${TEST_ORG},
      ${TEST_BRANCH},
      'Appointment Test Doctor',
      'appointment-test-doctor',
      'doctor'
    )
  `);
}

async function seedPatient(
  admin: ReturnType<typeof createFreshDatabase>['db'],
): Promise<string> {
  const id = randomUUID();

  await admin.execute(sql`
    INSERT INTO patients (
      id,
      org_id,
      branch_id,
      mrn,
      name
    )
    VALUES (
      ${id},
      ${TEST_ORG},
      ${TEST_BRANCH},
      'MDN-TSTAP',
      'Appt Patient'
    )
  `);

  return id;
}

describe('appointments module - integration (MySQL)', () => {
  dbIt(
    'book creates an appointment with code APT-0001 and status booked',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixtures(admin.db);

      const patientId = await seedPatient(admin.db);

      const { db, close } = createFreshDatabase(RUNTIME_URL);
      const repo = new AppointmentsRepository();

      const appt = await db.transaction(async (tx) => {
        const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);

        return repo.create(tx, TEST_ORG, TEST_BRANCH, {
          code,
          patientId,
          patientName: 'Appt Patient',
          scheduledDate: '2026-09-01',
          scheduledTime: '09:00',
          durationMin: 30,
        });
      });

      expect(appt.code).toBe('APT-0001');
      expect(appt.status).toBe('booked');

      await close();
      await purgeTestData(admin.db);
      await admin.close();
    },
  );

  dbIt(
    'double-booking: same doctor overlapping time is rejected',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixtures(admin.db);

      const patientId = await seedPatient(admin.db);

      const { db, close } = createFreshDatabase(RUNTIME_URL);
      const repo = new AppointmentsRepository();

      const run = () =>
        db.transaction(async (tx) => {
          const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);

          return repo.create(tx, TEST_ORG, TEST_BRANCH, {
            code,
            patientId,
            patientName: 'Appt Patient',
            doctorId: TEST_DOCTOR,
            scheduledDate: '2026-09-02',
            scheduledTime: '10:00',
            durationMin: 60,
          });
        });

      const appointment = await run();

      const clash = await db.transaction(async (tx) =>
        repo.findDoctorOverlap(
          tx,
          TEST_ORG,
          TEST_BRANCH,
          TEST_DOCTOR,
          '2026-09-02',
          '10:30',
          60,
        ),
      );

      expect(clash?.id).toBe(appointment.id);

      await close();
      await purgeTestData(admin.db);
      await admin.close();
    },
  );

  dbIt(
    'status transition + version optimistic lock works end to end',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixtures(admin.db);

      const patientId = await seedPatient(admin.db);

      const { db, close } = createFreshDatabase(RUNTIME_URL);
      const repo = new AppointmentsRepository();

      const appt = await db.transaction(async (tx) => {
        const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);

        return repo.create(tx, TEST_ORG, TEST_BRANCH, {
          code,
          patientId,
          patientName: 'Appt Patient',
          scheduledDate: '2026-09-03',
          scheduledTime: '11:00',
        });
      });

      expect(canTransition('booked', 'confirmed')).toBe(true);

      const updated = await db.transaction((tx) =>
        repo.updateStatus(
          tx,
          TEST_ORG,
          appt.id,
          'confirmed',
          appt.version,
        ),
      );

      expect(updated?.status).toBe('confirmed');
      expect(updated?.version).toBe(2);

      const stale = await db.transaction((tx) =>
        repo.updateStatus(
          tx,
          TEST_ORG,
          appt.id,
          'checked-in',
          1,
        ),
      );

      expect(stale).toBeNull();

      await close();
      await purgeTestData(admin.db);
      await admin.close();
    },
  );

  dbIt(
    'day queue returns only active statuses in time order',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixtures(admin.db);

      const patientId = await seedPatient(admin.db);

      const { db, close } = createFreshDatabase(RUNTIME_URL);
      const repo = new AppointmentsRepository();

      const mk = async (time: string, status: string) =>
        db.transaction(async (tx) => {
          const code = await new OrgAllocator(tx).nextAptCode(TEST_ORG);

          const appointment = await repo.create(
            tx,
            TEST_ORG,
            TEST_BRANCH,
            {
              code,
              patientId,
              patientName: 'Appt Patient',
              scheduledDate: '2026-09-04',
              scheduledTime: time,
              durationMin: 30,
            },
          );

          if (status !== 'booked') {
            await repo.updateStatus(
              tx,
              TEST_ORG,
              appointment.id,
              status,
              1,
            );
          }

          return appointment;
        });

      const later = await mk('14:00', 'waiting');
      const earlier = await mk('09:00', 'checked-in');

      await mk('15:00', 'completed');

      const queue = await db.transaction((tx) =>
        repo.dayQueue(
          tx,
          TEST_ORG,
          TEST_BRANCH,
          '2026-09-04',
        ),
      );

      expect(queue.map((q: { id: string }) => q.id)).toEqual([
        earlier.id,
        later.id,
      ]);

      await close();
      await purgeTestData(admin.db);
      await admin.close();
    },
  );
});
