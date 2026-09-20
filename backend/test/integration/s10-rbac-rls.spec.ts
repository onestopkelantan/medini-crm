import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createFreshDatabase,
} from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { Principal } from '@core/auth/principal';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { PatientsService } from '@modules/patients/application/patients.service';
import { AuditService } from '@shared/audit/audit.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import {
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/errors';
import {
  ROLE_DOMAIN_MATRIX,
} from '@shared/architecture/architecture.contract';

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
      '[s10-rbac-rls] MySQL admin/runtime database not reachable - SKIPPING.',
    );
  }

  return ok;
});

function dbIt(
  name: string,
  fn: () => Promise<void>,
): void {
  it(name, async (ctx) => {
    if (!(await probe)) {
      ctx.skip();
      return;
    }

    await fn();
  });
}

const ORG =
  '99999999-9999-9999-9999-999999999970';

const BRANCH_A =
  '99999999-9999-9999-9999-999999999971';

const BRANCH_B =
  '99999999-9999-9999-9999-999999999972';

const PATIENT_A =
  '99999999-9999-9999-9999-999999999973';

const PATIENT_B =
  '99999999-9999-9999-9999-999999999974';

const hq: Principal = {
  staffId:
    '99999999-9999-9999-9999-999999999975',
  name: 'MySQL HQ Test',
  username: 'mysql-hq-test',
  role: 'hq',
  orgId: ORG,
  branchId: null,
  doctorId: null,
};

const bm = (
  branchId: string,
): Principal => ({
  staffId:
    '99999999-9999-9999-9999-999999999976',
  name: 'MySQL Branch Manager Test',
  username: 'mysql-bm-test',
  role: 'branch_manager',
  orgId: ORG,
  branchId,
  doctorId: null,
});

async function purge(
  db: ReturnType<typeof createFreshDatabase>['db'],
): Promise<void> {
  await db.execute(sql`
    DELETE FROM patient_relationships
    WHERE org_id = ${ORG}
  `);

  await db.execute(sql`
    DELETE FROM patient_timeline_events
    WHERE org_id = ${ORG}
  `);

  await db.execute(sql`
    DELETE FROM patients
    WHERE org_id = ${ORG}
  `);

  await db.execute(sql`
    DELETE FROM org_counters
    WHERE org_id = ${ORG}
  `);

  await db.execute(sql`
    DELETE FROM branches
    WHERE org_id = ${ORG}
  `);

  await db.execute(sql`
    DELETE FROM organizations
    WHERE id = ${ORG}
  `);
}

async function prepare(
  db: ReturnType<typeof createFreshDatabase>['db'],
): Promise<void> {
  await purge(db);

  await db.execute(sql`
    INSERT INTO organizations (
      id,
      name
    )
    VALUES (
      ${ORG},
      'S10 MySQL RBAC Test'
    )
  `);

  await db.execute(sql`
    INSERT INTO branches (
      id,
      org_id,
      code,
      short_name,
      full_name
    )
    VALUES
      (
        ${BRANCH_A},
        ${ORG},
        'S10-RBAC-A',
        'RBAC A',
        'S10 RBAC Branch A'
      ),
      (
        ${BRANCH_B},
        ${ORG},
        'S10-RBAC-B',
        'RBAC B',
        'S10 RBAC Branch B'
      )
  `);

  await db.execute(sql`
    INSERT INTO patients (
      id,
      org_id,
      branch_id,
      mrn,
      name
    )
    VALUES
      (
        ${PATIENT_A},
        ${ORG},
        ${BRANCH_A},
        'MDN-S10-A',
        'S10 Patient A'
      ),
      (
        ${PATIENT_B},
        ${ORG},
        ${BRANCH_B},
        'MDN-S10-B',
        'S10 Patient B'
      )
  `);
}

function createPatientsService(
  db: ReturnType<typeof createFreshDatabase>['db'],
): PatientsService {
  const dbCtx = new DbContextService(db);
  const repo = new PatientsRepository();
  const audit = new AuditService();

  const readPort = {
    doctorLinkedToPatient:
      async () => false,
  } as unknown as PatientsReadPort;

  return new PatientsService(
    dbCtx,
    repo,
    audit,
    readPort,
  );
}

describe(
  'S10 T3 - MySQL RBAC + application isolation + IDOR',
  () => {
    dbIt(
      'HQ can read patients across branches in its organisation',
      async () => {
        const admin =
          createFreshDatabase(ADMIN_URL);

        await prepare(admin.db);

        const runtime =
          createFreshDatabase(RUNTIME_URL);

        try {
          const service =
            createPatientsService(runtime.db);

          const a =
            await service.getById(
              hq,
              PATIENT_A,
            );

          const b =
            await service.getById(
              hq,
              PATIENT_B,
            );

          expect(a.id).toBe(PATIENT_A);
          expect(b.id).toBe(PATIENT_B);
        } finally {
          await runtime.close();
          await purge(admin.db);
          await admin.close();
        }
      },
    );

    dbIt(
      'branch manager can read a patient in own branch',
      async () => {
        const admin =
          createFreshDatabase(ADMIN_URL);

        await prepare(admin.db);

        const runtime =
          createFreshDatabase(RUNTIME_URL);

        try {
          const service =
            createPatientsService(runtime.db);

          const patient =
            await service.getById(
              bm(BRANCH_A),
              PATIENT_A,
            );

          expect(patient.id).toBe(PATIENT_A);
          expect(patient.branchId).toBe(
            BRANCH_A,
          );
        } finally {
          await runtime.close();
          await purge(admin.db);
          await admin.close();
        }
      },
    );

    dbIt(
      'branch manager cannot read another branch patient by ID',
      async () => {
        const admin =
          createFreshDatabase(ADMIN_URL);

        await prepare(admin.db);

        const runtime =
          createFreshDatabase(RUNTIME_URL);

        try {
          const service =
            createPatientsService(runtime.db);

          await expect(
            service.getById(
              bm(BRANCH_A),
              PATIENT_B,
            ),
          ).rejects.toBeInstanceOf(
            NotFoundError,
          );
        } finally {
          await runtime.close();
          await purge(admin.db);
          await admin.close();
        }
      },
    );

    dbIt(
      'branch manager cannot update another branch patient by ID',
      async () => {
        const admin =
          createFreshDatabase(ADMIN_URL);

        await prepare(admin.db);

        const runtime =
          createFreshDatabase(RUNTIME_URL);

        try {
          const service =
            createPatientsService(runtime.db);

          await expect(
            service.update(
              bm(BRANCH_A),
              PATIENT_B,
              {
                name:
                  'IDOR Update Attempt',
              },
            ),
          ).rejects.toBeInstanceOf(
            NotFoundError,
          );
        } finally {
          await runtime.close();
          await purge(admin.db);
          await admin.close();
        }
      },
    );

    dbIt(
      'branch manager cannot move own patient into another branch',
      async () => {
        const admin =
          createFreshDatabase(ADMIN_URL);

        await prepare(admin.db);

        const runtime =
          createFreshDatabase(RUNTIME_URL);

        try {
          const service =
            createPatientsService(runtime.db);

          await expect(
            service.update(
              bm(BRANCH_A),
              PATIENT_A,
              {
                branchId: BRANCH_B,
              },
            ),
          ).rejects.toBeInstanceOf(
            ForbiddenError,
          );
        } finally {
          await runtime.close();
          await purge(admin.db);
          await admin.close();
        }
      },
    );

    it(
      'doctor cannot access admin or reports',
      () => {
        expect(
          ROLE_DOMAIN_MATRIX
            .doctor?.admin?.view,
        ).toBe(false);

        expect(
          ROLE_DOMAIN_MATRIX
            .doctor?.reports?.view,
        ).toBe(false);
      },
    );

    it(
      'branch admin cannot access reports',
      () => {
        expect(
          ROLE_DOMAIN_MATRIX
            .branch_admin
            ?.reports?.view,
        ).toBe(false);
      },
    );

    it(
      'HQ retains admin, reports and finance access',
      () => {
        expect(
          ROLE_DOMAIN_MATRIX
            .hq?.admin?.view,
        ).toBe(true);

        expect(
          ROLE_DOMAIN_MATRIX
            .hq?.reports?.view,
        ).toBe(true);

        expect(
          ROLE_DOMAIN_MATRIX
            .hq?.finance?.view,
        ).toBe(true);
      },
    );
  },
);
