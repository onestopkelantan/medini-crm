import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  pingDatabase,
  createDatabase,
  closeDatabase,
} from '@infrastructure/database/database';
import {
  staff,
  refreshTokens,
} from '@infrastructure/database/schema';
import { PasswordService } from '@core/auth/password.service';
import { TokenService } from '@core/auth/token.service';
import { RefreshTokenService } from '@core/auth/refresh-token.service';
import { StaffRegistrationService } from '@core/auth/staff-registration.service';
import { PrincipalResolver } from '@core/auth/principal.resolver';
import { AuthService } from '@core/auth/auth.service';
import { DbContextService } from '@core/auth/db-context.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedError } from '@shared/errors/errors';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app@localhost:3306/medini_dev';

const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) {
    console.warn(
      '[s10-auth-lifecycle] MySQL not reachable - SKIPPING.',
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

const TEST_STAFF =
  '99999999-9999-9999-9999-999999999930';

const TEST_USERNAME =
  'mysql-auth-lifecycle-test';

const TEST_PASSWORD =
  'MysqlAuthTest123!';

function build() {
  const db = createDatabase(RUNTIME_URL);
  const dbCtx = new DbContextService(db);
  const passwords = new PasswordService();
  const jwt = new JwtService({});

  const config = {
    get: (key: string) =>
      key === 'jwt.secret'
        ? 's10-test-secret-0123456789'
        : key === 'jwt.accessTtl'
          ? 900
          : key === 'jwt.refreshSecret'
            ? 's10-refresh-secret-0123456789'
            : key === 'jwt.refreshTtl'
              ? 604800
              : undefined,
  } as never;

  const tokens =
    new TokenService(jwt, config);

  const principals =
    new PrincipalResolver(db);

  const refreshTokenService =
    new RefreshTokenService(
      db,
      jwt,
      dbCtx,
      config,
    );

  const registration =
    new StaffRegistrationService(
      dbCtx,
      passwords,
      db,
    );

  const auth =
    new AuthService(
      db,
      passwords,
      tokens,
      refreshTokenService,
      principals,
      dbCtx,
    );

  return {
    auth,
    registration,
    passwords,
    db,
  };
}

async function purgeFixture(
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.staffId, TEST_STAFF));

  await db
    .delete(staff)
    .where(eq(staff.id, TEST_STAFF));
}

async function withActiveStaff(
  fn: (
    services: ReturnType<typeof build>,
  ) => Promise<void>,
): Promise<void> {
  const services = build();
  const { db, passwords } = services;

  try {
    await purgeFixture(db);

    const passwordHash =
      await passwords.hash(TEST_PASSWORD);

    await db.insert(staff).values({
      id: TEST_STAFF,
      orgId: ORG_ID,
      branchId: null,
      name: 'MySQL Auth Lifecycle Test',
      username: TEST_USERNAME,
      email: 'mysql-auth-test@example.invalid',
      role: 'hq',
      status: 'Active',
      passwordHash,
      mfaEnabled: false,
    });

    await fn(services);
  } finally {
    try {
      await purgeFixture(db);
    } finally {
      await closeDatabase();
    }
  }
}

describe(
  'S10 T1 - Auth lifecycle on MySQL',
  () => {
    dbIt(
      'login returns access and refresh tokens for isolated test staff',
      async () => {
        await withActiveStaff(
          async ({ auth }) => {
            const { result } =
              await auth.login(
                TEST_USERNAME,
                TEST_PASSWORD,
              );

            expect(
              result.accessToken,
            ).toBeTruthy();

            expect(
              result.refreshToken,
            ).toBeTruthy();

            expect(
              result.refreshToken.length,
            ).toBeGreaterThan(20);

            expect(
              result.user.staffId,
            ).toBe(TEST_STAFF);

            expect(
              result.user.username,
            ).toBe(TEST_USERNAME);

            expect(
              result.user.role,
            ).toBe('hq');
          },
        );
      },
    );

    dbIt(
      'refresh rotates the token and issues a new access token',
      async () => {
        await withActiveStaff(
          async ({ auth }) => {
            const { result } =
              await auth.login(
                TEST_USERNAME,
                TEST_PASSWORD,
              );

            const rotated =
              await auth.refresh(
                result.refreshToken,
              );

            expect(
              rotated.accessToken,
            ).toBeTruthy();

            expect(
              rotated.refreshToken,
            ).toBeTruthy();

            expect(
              rotated.refreshToken,
            ).not.toBe(
              result.refreshToken,
            );
          },
        );
      },
    );

    dbIt(
      'a rotated refresh token cannot be reused',
      async () => {
        await withActiveStaff(
          async ({ auth }) => {
            const { result } =
              await auth.login(
                TEST_USERNAME,
                TEST_PASSWORD,
              );

            await auth.refresh(
              result.refreshToken,
            );

            await expect(
              auth.refresh(
                result.refreshToken,
              ),
            ).rejects.toBeInstanceOf(
              UnauthorizedError,
            );
          },
        );
      },
    );

    dbIt(
      'logout revokes the refresh token',
      async () => {
        await withActiveStaff(
          async ({ auth }) => {
            const {
              result,
              principal,
            } = await auth.login(
              TEST_USERNAME,
              TEST_PASSWORD,
            );

            await auth.logout(
              result.refreshToken,
              principal,
            );

            await expect(
              auth.refresh(
                result.refreshToken,
              ),
            ).rejects.toBeInstanceOf(
              UnauthorizedError,
            );
          },
        );
      },
    );

    dbIt(
      'deactivated staff cannot login',
      async () => {
        await withActiveStaff(
          async ({ auth, db }) => {
            await db
              .update(staff)
              .set({
                status: 'Deactivated',
              })
              .where(
                eq(
                  staff.id,
                  TEST_STAFF,
                ),
              );

            await expect(
              auth.login(
                TEST_USERNAME,
                TEST_PASSWORD,
              ),
            ).rejects.toBeInstanceOf(
              UnauthorizedError,
            );
          },
        );
      },
    );

    dbIt(
      'valid invite registers staff and consumes the invite token',
      async () => {
        const services = build();

        try {
          await purgeFixture(services.db);

          const inviteToken =
            'mysql-valid-invite-token';

          await services.db.insert(staff).values({
            id: TEST_STAFF,
            orgId: ORG_ID,
            branchId: null,
            name: 'Invited MySQL User',
            username: 'mysql-invited-placeholder',
            role: 'hq',
            status: 'Invited',
            inviteToken,
            inviteExpiresAt: new Date(
              Date.now() + 60 * 60 * 1000,
            ),
            mfaEnabled: false,
          });

          const result =
            await services.registration.register({
              inviteToken,
              name: 'Registered MySQL User',
              username: 'mysql-registered-user',
              password: 'MysqlRegister123!',
            });

          expect(result).toEqual({
            staffId: TEST_STAFF,
            status: 'Pending',
          });

          const rows = await services.db
            .select()
            .from(staff)
            .where(eq(staff.id, TEST_STAFF))
            .limit(1);

          const member = rows[0];

          expect(member?.status).toBe('Pending');
          expect(member?.name).toBe(
            'Registered MySQL User',
          );
          expect(member?.username).toBe(
            'mysql-registered-user',
          );
          expect(member?.inviteToken).toBeNull();
          expect(member?.inviteExpiresAt).toBeNull();
          expect(member?.passwordHash).toBeTruthy();

          expect(
            await services.passwords.verify(
              member!.passwordHash!,
              'MysqlRegister123!',
            ),
          ).toBe(true);
        } finally {
          try {
            await purgeFixture(services.db);
          } finally {
            await closeDatabase();
          }
        }
      },
    );
    dbIt(
      'registration with invalid invite token is rejected',
      async () => {
        const services = build();

        try {
          await expect(
            services.registration.register({
              inviteToken:
                'invalid-mysql-test-token',
              name: 'Test User',
              username:
                'mysql-invalid-invite-test',
              password:
                'password123',
            }),
          ).rejects.toBeInstanceOf(
            UnauthorizedError,
          );
        } finally {
          await closeDatabase();
        }
      },
    );
  },
);
