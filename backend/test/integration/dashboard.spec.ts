import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createFreshDatabase,
} from '@infrastructure/database/database';
import { DashboardService } from '@modules/dashboard/application/dashboard.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { DbContextService } from '@core/auth/db-context.service';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app_password@localhost:3306/medini_dev';

const TEST_ORG = '99999999-9999-9999-9999-999999999980';
const TEST_BRANCH = '99999999-9999-9999-9999-999999999979';
const TEST_PATIENT = '99999999-9999-9999-9999-999999999978';
const TEST_APPOINTMENT_1 = '99999999-9999-9999-9999-999999999977';
const TEST_APPOINTMENT_2 = '99999999-9999-9999-9999-999999999976';

const probe = Promise.all([
  pingDatabase(ADMIN_URL),
  pingDatabase(RUNTIME_URL),
]).then(([adminOk, runtimeOk]) => {
  const ok = adminOk && runtimeOk;

  if (!ok) {
    console.warn(
      '[dashboard] MySQL admin/runtime database not reachable - SKIPPING.',
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

function principal(branchId: string, role = 'branch_manager') {
  return {
    staffId: '99999999-9999-9999-9999-999999999975',
    name: 'Dashboard User',
    username: 'dashboard-test',
    role,
    orgId: TEST_ORG,
    branchId,
    doctorId: null,
  };
}

type Db = ReturnType<typeof createFreshDatabase>['db'];

async function purge(admin: Db): Promise<void> {
  await admin.execute(sql`
    DELETE FROM appointments
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM patients
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM branches
    WHERE id = ${TEST_BRANCH}
  `);

  await admin.execute(sql`
    DELETE FROM organizations
    WHERE id = ${TEST_ORG}
  `);
}

async function prepareFixture(admin: Db): Promise<void> {
  await purge(admin);

  await admin.execute(sql`
    INSERT INTO organizations (
      id,
      name
    )
    VALUES (
      ${TEST_ORG},
      'Dashboard Integration Test'
    )
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
      'dashboard-test',
      'Dashboard Test',
      'Dashboard Integration Test Branch'
    )
  `);

  await admin.execute(sql`
    INSERT INTO patients (
      id,
      org_id,
      branch_id,
      mrn,
      name
    )
    VALUES (
      ${TEST_PATIENT},
      ${TEST_ORG},
      ${TEST_BRANCH},
      'MDN-DASH1',
      'Dash Patient'
    )
  `);

  await admin.execute(sql`
    INSERT INTO appointments (
      id,
      org_id,
      branch_id,
      code,
      patient_id,
      patient_name,
      scheduled_date,
      scheduled_time,
      status
    )
    VALUES
      (
        ${TEST_APPOINTMENT_1},
        ${TEST_ORG},
        ${TEST_BRANCH},
        'APT-DASH1',
        ${TEST_PATIENT},
        'Dash Patient',
        '2026-09-10',
        '09:00',
        'waiting'
      ),
      (
        ${TEST_APPOINTMENT_2},
        ${TEST_ORG},
        ${TEST_BRANCH},
        'APT-DASH2',
        ${TEST_PATIENT},
        'Dash Patient',
        '2026-09-10',
        '10:00',
        'completed'
      )
  `);
}

describe('dashboard module - integration (MySQL)', () => {
  dbIt(
    'context aggregates patient and appointment counts within branch scope',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixture(admin.db);

      const runtime = createFreshDatabase(RUNTIME_URL);

      try {
        const ctx = new DbContextService(runtime.db);

        const service = new DashboardService(
          ctx,
          new PatientsReadPort(runtime.db),
          new AppointmentsReadPort(runtime.db),
        );

        const result = await service.context(
          principal(TEST_BRANCH),
          '2026-09-10',
        );

        expect(result.branchId).toBe(TEST_BRANCH);
        expect(result.patients.total).toBe(1);
        expect(result.appointments.total).toBe(2);
        expect(result.appointments.queueActive).toBe(1);
        expect(result.appointments.completed).toBe(1);

        const byStatus = result.appointments.byStatus;

        expect(
          byStatus.find((row) => row.status === 'waiting')?.n,
        ).toBe(1);

        expect(
          byStatus.find((row) => row.status === 'completed')?.n,
        ).toBe(1);
      } finally {
        await runtime.close();
        await purge(admin.db);
        await admin.close();
      }
    },
  );

  dbIt(
    'dashboard is read-only: no mutation methods exist on the service',
    async () => {
      const proto = DashboardService.prototype;
      const own = Object.getOwnPropertyNames(proto);

      expect(own).toContain('context');

      expect(
        own.filter((method) =>
          /create|update|delete|insert|book|reschedule/i.test(method),
        ),
      ).toEqual([]);
    },
  );
});