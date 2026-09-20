import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  pingDatabase,
  createDatabase,
  closeDatabase,
} from '@infrastructure/database/database';
import {
  organizations,
  staff,
} from '@infrastructure/database/schema';
import { AdministrationRepository } from '@modules/administration/infrastructure/administration.repository';

/**
 * Tier 2 (T2-B / FAMILY-4)
 *
 * The AdministrationRepository staff READ surface must never expose
 * password_hash, mfa_secret, or invite_token.
 *
 * This MySQL integration test uses a dedicated organization and staff fixture
 * containing credential material, then proves that the administration read
 * repository does not return those credential columns.
 */

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app@localhost:3306/medini_dev';

const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) {
    console.warn('[t2-password-hash] MySQL not reachable - SKIPPING.');
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

const TEST_ORG = '99999999-9999-9999-9999-999999999940';
const TEST_STAFF = '99999999-9999-9999-9999-999999999941';
const TEST_USERNAME = 'mysql-credential-surface-test';

const TEST_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$integration-test$credential-secret';
const TEST_MFA_SECRET = 'MYSQL-INTEGRATION-MFA-SECRET';
const TEST_INVITE_TOKEN = 'MYSQL-INTEGRATION-INVITE-TOKEN';

const CREDENTIAL_KEYS = [
  'passwordHash',
  'password_hash',
  'mfaSecret',
  'mfa_secret',
  'inviteToken',
  'invite_token',
];

function assertNoCredentials(
  row: Record<string, unknown> | null | undefined,
): void {
  expect(row).toBeTruthy();

  for (const key of CREDENTIAL_KEYS) {
    expect(
      Object.prototype.hasOwnProperty.call(row, key),
      `must not expose ${key}`,
    ).toBe(false);
  }
}

async function withFixture(
  fn: (
    db: ReturnType<typeof createDatabase>,
    repo: AdministrationRepository,
  ) => Promise<void>,
): Promise<void> {
  const db = createDatabase(RUNTIME_URL);

  try {
    await db.delete(staff).where(eq(staff.orgId, TEST_ORG));
    await db.delete(organizations).where(eq(organizations.id, TEST_ORG));

    await db.insert(organizations).values({
      id: TEST_ORG,
      name: 'MySQL Credential Surface Integration Test',
      status: 'active',
    });

    await db.insert(staff).values({
      id: TEST_STAFF,
      orgId: TEST_ORG,
      branchId: null,
      name: 'Credential Surface Test Staff',
      username: TEST_USERNAME,
      email: 'credential-surface-test@example.invalid',
      role: 'hq',
      status: 'Active',
      passwordHash: TEST_PASSWORD_HASH,
      mfaEnabled: true,
      mfaSecret: TEST_MFA_SECRET,
      inviteToken: TEST_INVITE_TOKEN,
    });

    const repo = new AdministrationRepository();
    await fn(db, repo);
  } finally {
    try {
      await db.delete(staff).where(eq(staff.orgId, TEST_ORG));
      await db.delete(organizations).where(eq(organizations.id, TEST_ORG));
    } finally {
      await closeDatabase();
    }
  }
}

describe('T2-B - admin staff read surface excludes credential columns on MySQL', () => {
  dbIt(
    'listStaff returns rows without password_hash, mfa_secret or invite_token',
    async () => {
      await withFixture(async (db, repo) => {
        const rows = await repo.listStaff(
          db as never,
          TEST_ORG,
          {},
          50,
          0,
        );

        expect(rows).toHaveLength(1);

        for (const row of rows) {
          assertNoCredentials(
            row as unknown as Record<string, unknown>,
          );
        }

        expect(rows[0]).toHaveProperty('id', TEST_STAFF);
        expect(rows[0]).toHaveProperty('username', TEST_USERNAME);
        expect(rows[0]).toHaveProperty('role', 'hq');
        expect(rows[0]).toHaveProperty('status', 'Active');
      });
    },
  );

  dbIt(
    'findStaff by id returns a row without credential columns',
    async () => {
      await withFixture(async (db, repo) => {
        const row = await repo.findStaff(
          db as never,
          TEST_ORG,
          TEST_STAFF,
        );

        assertNoCredentials(
          row as unknown as Record<string, unknown>,
        );

        expect(row?.id).toBe(TEST_STAFF);
        expect(row?.username).toBe(TEST_USERNAME);
      });
    },
  );

  dbIt(
    'findStaffByUsername returns a row without credential columns',
    async () => {
      await withFixture(async (db, repo) => {
        const row = await repo.findStaffByUsername(
          db as never,
          TEST_ORG,
          TEST_USERNAME,
        );

        assertNoCredentials(
          row as unknown as Record<string, unknown>,
        );

        expect(row?.id).toBe(TEST_STAFF);
        expect(row?.username).toBe(TEST_USERNAME);
      });
    },
  );

  dbIt(
    'serialized administration staff output contains no credential material',
    async () => {
      await withFixture(async (db, repo) => {
        const rows = await repo.listStaff(
          db as never,
          TEST_ORG,
          {},
          5,
          0,
        );

        const json = JSON.stringify(rows);

        expect(json).not.toContain('password_hash');
        expect(json).not.toContain('passwordHash');
        expect(json).not.toContain('mfa_secret');
        expect(json).not.toContain('mfaSecret');
        expect(json).not.toContain('invite_token');
        expect(json).not.toContain('inviteToken');

        expect(json).not.toContain(TEST_PASSWORD_HASH);
        expect(json).not.toContain(TEST_MFA_SECRET);
        expect(json).not.toContain(TEST_INVITE_TOKEN);
        expect(json).not.toContain('$argon2');
      });
    },
  );
});
