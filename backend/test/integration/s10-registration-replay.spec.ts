import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  pingDatabase,
  createDatabase,
  closeDatabase,
} from '@infrastructure/database/database';
import {
  branches,
  staff,
  roleAssignments,
  refreshTokens,
} from '@infrastructure/database/schema';
import { DbContextService } from '@core/auth/db-context.service';
import { PasswordService } from '@core/auth/password.service';
import { StaffRegistrationService } from '@core/auth/staff-registration.service';
import { AdministrationRepository } from '@modules/administration/infrastructure/administration.repository';
import { AdministrationService } from '@modules/administration/application/administration.service';
import {
  AuditService,
  InMemoryAuditAdapter,
} from '@shared/audit/audit.service';
import { UnauthorizedError } from '@shared/errors/errors';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app@localhost:3306/medini_dev';

const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) {
    console.warn(
      '[s10-registration-replay] MySQL not reachable - SKIPPING.',
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

const ORG_ID =
  '00000000-0000-0000-0000-000000000001';

const HQ_ID =
  '99999999-9999-9999-9999-999999999910';

const BRANCH_ID =
  '99999999-9999-9999-9999-999999999911';

const TEST_USERNAME =
  'mysql-registration-flow-test';

const REGISTERED_USERNAME =
  'mysql-registration-flow-user';

const PASSWORD =
  'MysqlRegistration123!';

const HQ_PRINCIPAL = {
  staffId: HQ_ID,
  name: 'MySQL Registration Test HQ',
  username: 'mysql-registration-test-hq',
  role: 'hq',
  orgId: ORG_ID,
  branchId: null,
  doctorId: null,
} as const;

function build() {
  const db = createDatabase(RUNTIME_URL);
  const dbCtx = new DbContextService(db);
  const passwords = new PasswordService();
  const registration =
    new StaffRegistrationService(
      dbCtx,
      passwords,
      db,
    );

  const repo =
    new AdministrationRepository();

  const auditAdapter =
    new InMemoryAuditAdapter();

  const audit =
    new AuditService(auditAdapter);

  const admin =
    new AdministrationService(
      dbCtx,
      repo,
      audit,
      {} as never,
      registration,
    );

  return {
    db,
    passwords,
    registration,
    auditAdapter,
    admin,
  };
}

async function purgeFixture(
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  const rows = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.orgId, ORG_ID),
        eq(staff.username, TEST_USERNAME),
      ),
    );

  const registeredRows = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.orgId, ORG_ID),
        eq(staff.username, REGISTERED_USERNAME),
      ),
    );

  const ids = [
    ...rows.map((row: { id: string }) => row.id),
    ...registeredRows.map((row: { id: string }) => row.id),
  ];

  for (const id of ids) {
    await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.staffId, id));

    await db
      .delete(roleAssignments)
      .where(eq(roleAssignments.staffId, id));

    await db
      .delete(staff)
      .where(eq(staff.id, id));
  }

  await db
    .delete(branches)
    .where(eq(branches.id, BRANCH_ID));
}

describe(
  'S10 - MySQL registration lifecycle',
  () => {
    dbIt(
      'invite -> token -> register -> single-use -> approve',
      async () => {
        const services = build();

        try {
          await purgeFixture(
            services.db,
          );

          await services.db
            .insert(branches)
            .values({
              id: BRANCH_ID,
              orgId: ORG_ID,
              code: 'MYSQL-REG-TEST',
              shortName:
                'MySQL Registration Test',
              fullName:
                'MySQL Registration Test Branch',
              type: 'main',
              status: 'active',
            });

          const previousBaseUrl =
            process.env.APP_PUBLIC_BASE_URL;

          process.env.APP_PUBLIC_BASE_URL =
            'https://app.medini.example';

          try {
            const invited =
              await services.admin.inviteStaff(
                HQ_PRINCIPAL as never,
                {
                  name:
                    'MySQL Registration Staff',
                  username:
                    TEST_USERNAME,
                  role: 'doctor',
                  branchId: BRANCH_ID,
                },
              );

            expect(
              invited.status,
            ).toBe('Invited');

            expect(
              invited.username,
            ).toBe(TEST_USERNAME);

            expect(
              invited.branchId,
            ).toBe(BRANCH_ID);

            const link =
              await services.admin.generateInviteLink(
                HQ_PRINCIPAL as never,
                invited.id,
              );

            expect(
              link.inviteLink,
            ).toContain(
              'https://app.medini.example',
            );

            const inviteToken =
              new URL(
                link.inviteLink,
              ).searchParams.get(
                'token',
              ) ?? '';

            expect(
              inviteToken.length,
            ).toBeGreaterThan(20);

            const registered =
              await services.registration.register({
                inviteToken,
                name:
                  'Registered MySQL Staff',
                username:
                  REGISTERED_USERNAME,
                password:
                  PASSWORD,
              });

            expect(
              registered,
            ).toEqual({
              staffId: invited.id,
              status: 'Pending',
            });

            const pendingRows =
              await services.db
                .select()
                .from(staff)
                .where(
                  eq(
                    staff.id,
                    invited.id,
                  ),
                )
                .limit(1);

            const pending =
              pendingRows[0];

            expect(
              pending?.status,
            ).toBe('Pending');

            expect(
              pending?.username,
            ).toBe(
              REGISTERED_USERNAME,
            );

            expect(
              pending?.inviteToken,
            ).toBeNull();

            expect(
              pending?.inviteExpiresAt,
            ).toBeNull();

            expect(
              pending?.passwordHash,
            ).toBeTruthy();

            expect(
              await services.passwords.verify(
                pending!.passwordHash!,
                PASSWORD,
              ),
            ).toBe(true);

            await expect(
              services.registration.register({
                inviteToken,
                name: 'Replay User',
                username:
                  'mysql-registration-replay',
                password:
                  'ReplayPassword123!',
              }),
            ).rejects.toBeInstanceOf(
              UnauthorizedError,
            );

            const approved =
              await services.admin.approveStaff(
                HQ_PRINCIPAL as never,
                invited.id,
              );

            expect(
              approved.status,
            ).toBe('Active');

            const activeRows =
              await services.db
                .select({
                  status: staff.status,
                })
                .from(staff)
                .where(
                  eq(
                    staff.id,
                    invited.id,
                  ),
                )
                .limit(1);

            expect(
              activeRows[0]?.status,
            ).toBe('Active');

            const assignments =
              await services.db
                .select()
                .from(roleAssignments)
                .where(
                  eq(
                    roleAssignments.staffId,
                    invited.id,
                  ),
                );

            expect(
              assignments.some(
                (row: { status: string; role: string; branchId: string | null }) =>
                  row.status === 'ACTIVE' &&
                  row.role === 'doctor' &&
                  row.branchId === BRANCH_ID,
              ),
            ).toBe(true);

            expect(
              services.auditAdapter.events.some(
                (event) =>
                  event.action ===
                  'staff_invited',
              ),
            ).toBe(true);

            expect(
              services.auditAdapter.events.some(
                (event) =>
                  event.action ===
                  'staff_invite_link_generated',
              ),
            ).toBe(true);

            expect(
              services.auditAdapter.events.some(
                (event) =>
                  event.action ===
                  'staff_approved',
              ),
            ).toBe(true);
          } finally {
            if (
              previousBaseUrl ===
              undefined
            ) {
              delete process.env
                .APP_PUBLIC_BASE_URL;
            } else {
              process.env
                .APP_PUBLIC_BASE_URL =
                previousBaseUrl;
            }
          }
        } finally {
          try {
            await purgeFixture(
              services.db,
            );
          } finally {
            await closeDatabase();
          }
        }
      },
    );
  },
);
