import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createFreshDatabase,
} from '@infrastructure/database/database';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { OrgAllocator } from '@shared/allocators/org-allocator';
import { normalizePhone } from '@modules/patients/domain/phone';

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
      '[patients] MySQL admin/runtime database not reachable - SKIPPING (honest skip).',
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

const TEST_ORG = '99999999-9999-9999-9999-999999999999';
const OTHER_ORG = '99999999-9999-9999-9999-999999999998';

const TEST_BRANCH = '99999999-9999-9999-9999-999999999997';
const TEST_BRANCH_2 = '99999999-9999-9999-9999-999999999996';
const OTHER_BRANCH = '99999999-9999-9999-9999-999999999995';

async function purgeTestData(
  admin: ReturnType<typeof createFreshDatabase>['db'],
): Promise<void> {
  await admin.execute(sql`
    DELETE FROM patient_relationships
    WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})
  `);

  await admin.execute(sql`
    DELETE FROM patient_timeline_events
    WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})
  `);

  await admin.execute(sql`
    DELETE FROM patients
    WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})
  `);

  await admin.execute(sql`
    DELETE FROM org_counters
    WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})
  `);

  await admin.execute(sql`
    DELETE FROM branches
    WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})
  `);

  await admin.execute(sql`
    DELETE FROM organizations
    WHERE id IN (${TEST_ORG}, ${OTHER_ORG})
  `);
}

async function prepareFixtures(
  admin: ReturnType<typeof createFreshDatabase>['db'],
): Promise<void> {
  await purgeTestData(admin);

  await admin.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES
      (${TEST_ORG}, 'Patients Integration Test'),
      (${OTHER_ORG}, 'Patients Other Org Test')
  `);

  await admin.execute(sql`
    INSERT INTO branches (
      id,
      org_id,
      code,
      short_name,
      full_name
    )
    VALUES
      (
        ${TEST_BRANCH},
        ${TEST_ORG},
        'patient-test-a',
        'Patient Test A',
        'Patient Integration Test Branch A'
      ),
      (
        ${TEST_BRANCH_2},
        ${TEST_ORG},
        'patient-test-b',
        'Patient Test B',
        'Patient Integration Test Branch B'
      ),
      (
        ${OTHER_BRANCH},
        ${OTHER_ORG},
        'patient-other',
        'Patient Other',
        'Patient Other Organisation Branch'
      )
  `);
}

describe('patients module - integration (MySQL)', () => {
  dbIt('nextMrn starts at MDN-0001 for a fresh org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await prepareFixtures(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);

    const m1 = await new OrgAllocator(db).nextMrn(TEST_ORG);

    expect(m1).toBe('MDN-0001');

    await close();
    await purgeTestData(admin.db);
    await admin.close();
  });

  dbIt('createPatient stores normalized phone', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await prepareFixtures(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const repo = new PatientsRepository();

    const patient = await db.transaction((tx) =>
      repo.createPatient(tx, TEST_ORG, TEST_BRANCH, {
        mrn: 'MDN-TST01',
        name: 'Integration Patient',
        phone: '+6012-345 6789',
      }),
    );

    expect(normalizePhone(patient.phone)).toBe('123456789');

    await close();
    await purgeTestData(admin.db);
    await admin.close();
  });

  dbIt(
    'application scope keeps patient reads inside the requested org and branch',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixtures(admin.db);

      const { db, close } = createFreshDatabase(RUNTIME_URL);
      const repo = new PatientsRepository();

      const p1 = await repo.createPatient(
        db,
        TEST_ORG,
        TEST_BRANCH,
        {
          mrn: 'MDN-SCOPE01',
          name: 'Scope Patient Alpha',
        },
      );

      const p2 = await repo.createPatient(
        db,
        TEST_ORG,
        TEST_BRANCH_2,
        {
          mrn: 'MDN-SCOPE02',
          name: 'Scope Patient Beta',
        },
      );

      const p3 = await repo.createPatient(
        db,
        OTHER_ORG,
        OTHER_BRANCH,
        {
          mrn: 'MDN-SCOPE03',
          name: 'Scope Patient Gamma',
        },
      );

      const wrongOrg = await repo.findById(
        db,
        TEST_ORG,
        p3.id,
      );

      expect(wrongOrg).toBeNull();

      const branchRows = await repo.search(
        db,
        TEST_ORG,
        TEST_BRANCH,
        {
          q: 'Scope Patient',
          limit: 20,
        },
      );

      expect(branchRows.map((row) => row.id)).toEqual([p1.id]);

      const hqRows = await repo.search(
        db,
        TEST_ORG,
        null,
        {
          q: 'Scope Patient',
          limit: 20,
        },
      );

      expect(hqRows.map((row) => row.id).sort()).toEqual(
        [p1.id, p2.id].sort(),
      );

      expect(hqRows.some((row) => row.id === p3.id)).toBe(false);

      await close();
      await purgeTestData(admin.db);
      await admin.close();
    },
  );

  dbIt(
    'timeline table is append-only with no updated_at or deleted_at columns',
    async () => {
      const { db, close } = createFreshDatabase(ADMIN_URL);

      const rows = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'patient_timeline_events'
          AND column_name IN ('updated_at', 'deleted_at')
      `);

      expect(
        (rows as unknown as { rows: Array<unknown> }).rows,
      ).toHaveLength(0);

      await close();
    },
  );

  dbIt(
    'relationships and timeline reads are explicitly scoped by org',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await prepareFixtures(admin.db);

      const { db, close } = createFreshDatabase(RUNTIME_URL);
      const repo = new PatientsRepository();

      const patient = await repo.createPatient(
        db,
        TEST_ORG,
        TEST_BRANCH,
        {
          mrn: 'MDN-REL01',
          name: 'Relationship Test Patient',
        },
      );

      await repo.addRelationship(
        db,
        TEST_ORG,
        {
          patientId: patient.id,
          relatedName: 'Test Guardian',
          type: 'guardian',
        },
      );

      await repo.appendTimeline(
        db,
        TEST_ORG,
        {
          patientId: patient.id,
          type: 'registration',
          summary: 'Patient registered',
        },
      );

      const correctRelationships = await repo.listRelationships(
        db,
        TEST_ORG,
        patient.id,
      );

      const wrongRelationships = await repo.listRelationships(
        db,
        OTHER_ORG,
        patient.id,
      );

      const correctTimeline = await repo.listTimeline(
        db,
        TEST_ORG,
        patient.id,
      );

      const wrongTimeline = await repo.listTimeline(
        db,
        OTHER_ORG,
        patient.id,
      );

      expect(correctRelationships).toHaveLength(1);
      expect(wrongRelationships).toHaveLength(0);

      expect(correctTimeline).toHaveLength(1);
      expect(wrongTimeline).toHaveLength(0);

      await close();
      await purgeTestData(admin.db);
      await admin.close();
    },
  );
});
