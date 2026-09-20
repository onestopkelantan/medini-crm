import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createFreshDatabase,
} from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { AuditPort, AuditEvent } from '@shared/audit/audit.port';
import { DbAuditAdapter } from '@infrastructure/database/db-audit.adapter';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { PatientsService } from '@modules/patients/application/patients.service';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app_password@localhost:3306/medini_dev';

const TEST_ORG = '99999999-9999-9999-9999-999999999950';
const TEST_BRANCH = '99999999-9999-9999-9999-999999999949';

const probe = Promise.all([
  pingDatabase(ADMIN_URL),
  pingDatabase(RUNTIME_URL),
]).then(([adminOk, runtimeOk]) => {
  const ok = adminOk && runtimeOk;

  if (!ok) {
    console.warn(
      '[atomicity] MySQL admin/runtime database not reachable - SKIPPING.',
    );
  }

  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!(await probe)) {
      ctx.skip();
      return;
    }

    await fn();
  });
}

function hqPrincipal() {
  return {
    staffId: '00000000-0000-0000-0000-0000000000aa',
    name: 'HQ Atomicity',
    username: 'hq-atomicity',
    role: 'hq',
    orgId: TEST_ORG,
    branchId: null,
    doctorId: null,
  };
}

type Db = ReturnType<typeof createFreshDatabase>['db'];

interface RawRows {
  rows: Array<Record<string, unknown>>;
}

/** Audit port that always throws to force transaction rollback. */
class ThrowingAuditPort extends AuditPort {
  record(_event: AuditEvent, _tx?: unknown): Promise<void> | void {
    throw new Error('audit backend down (controlled failure)');
  }
}

async function purge(admin: Db): Promise<void> {
  await admin.execute(sql`
    DELETE FROM appointments
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM patient_relationships
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM patient_timeline_events
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM patients
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM audit_log
    WHERE org_id = ${TEST_ORG}
  `);

  await admin.execute(sql`
    DELETE FROM org_counters
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
      'Atomicity Integration Test'
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
      'atomicity-test',
      'Atomicity Test',
      'Atomicity Integration Test Branch'
    )
  `);
}

async function countRows(
  db: Db,
  table: string,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT CAST(COUNT(*) AS SIGNED) AS n
    FROM ${sql.raw(table)}
    WHERE org_id = ${TEST_ORG}
  `);

  return Number(
    (result as RawRows).rows[0]?.n ?? 0,
  );
}

describe('Blocker 1 - audit atomicity on MySQL', () => {
  dbIt(
    'audit failure rolls back patient, timeline and counter mutation',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixture(admin.db);

      const runtime = createFreshDatabase(RUNTIME_URL);

      try {
        const ctx = new DbContextService(runtime.db);

        const service = new PatientsService(
          ctx,
          new PatientsRepository(),
          new AuditService(new ThrowingAuditPort()),
          new PatientsReadPort(runtime.db),
        );

        await expect(
          service.register(
            hqPrincipal(),
            {
              name: 'Atomicity Victim',
              branchId: TEST_BRANCH,
            },
          ),
        ).rejects.toThrow(/audit backend down/);

        expect(
          await countRows(admin.db, 'patients'),
        ).toBe(0);

        expect(
          await countRows(
            admin.db,
            'patient_timeline_events',
          ),
        ).toBe(0);

        expect(
          await countRows(admin.db, 'audit_log'),
        ).toBe(0);

        expect(
          await countRows(admin.db, 'org_counters'),
        ).toBe(0);
      } finally {
        await runtime.close();
        await purge(admin.db);
        await admin.close();
      }
    },
  );

  dbIt(
    'successful register commits patient, timeline, audit and MRN counter together',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixture(admin.db);

      const runtime = createFreshDatabase(RUNTIME_URL);

      try {
        const ctx = new DbContextService(runtime.db);

        const service = new PatientsService(
          ctx,
          new PatientsRepository(),
          new AuditService(
            new DbAuditAdapter(runtime.db),
          ),
          new PatientsReadPort(runtime.db),
        );

        const result = await service.register(
          hqPrincipal(),
          {
            name: 'Atomicity Success',
            branchId: TEST_BRANCH,
          },
        );

        expect(result.patient.mrn).toBe('MDN-0001');

        expect(
          await countRows(admin.db, 'patients'),
        ).toBe(1);

        expect(
          await countRows(
            admin.db,
            'patient_timeline_events',
          ),
        ).toBe(1);

        expect(
          await countRows(admin.db, 'audit_log'),
        ).toBe(1);

        expect(
          await countRows(admin.db, 'org_counters'),
        ).toBe(1);

        const auditRows = await admin.db.execute(sql`
          SELECT action, entity
          FROM audit_log
          WHERE org_id = ${TEST_ORG}
        `);

        expect(
          (auditRows as RawRows).rows[0]?.action,
        ).toBe('patient_created');

        expect(
          (auditRows as RawRows).rows[0]?.entity,
        ).toBe('patients');
      } finally {
        await runtime.close();
        await purge(admin.db);
        await admin.close();
      }
    },
  );
});