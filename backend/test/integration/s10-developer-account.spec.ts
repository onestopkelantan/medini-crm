import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';
import { PasswordService } from '@core/auth/password.service';
import { TokenService } from '@core/auth/token.service';
import { RefreshTokenService } from '@core/auth/refresh-token.service';
import { PrincipalResolver } from '@core/auth/principal.resolver';
import { AuthService } from '@core/auth/auth.service';
import { DbContextService } from '@core/auth/db-context.service';
import { JwtService } from '@nestjs/jwt';
import { can } from '@shared/architecture/architecture.contract';

/**
 * S10 GLM 5.3 — Developer / System Admin account (live PG).
 * Proves: normal auth pipeline (Argon2id + JWT + refresh rotation + revoke),
 * matrix fail-closed on business domains, and RLS RESTRICTIVE deny at the DB.
 * Seed via the ADMIN (owner) connection like every other S10 fixture; auth
 * runs through the real runtime (medini_app) pipeline.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ADMIN_URL = process.env.DATABASE_URL ?? RUNTIME_URL;
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-developer-account] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const DEV_USERNAME = 'dev_s10_test';
const DEV_PASSWORD = 'DevS10!str0ng-passphrase';
const DEV_STAFF_ID = 'd1000000-0000-4000-8000-0000000000d1';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

function build() {
  const db = createDatabase(RUNTIME_URL);
  const dbCtx = new DbContextService(db);
  const passwords = new PasswordService();
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'jwt.secret' ? 's10-test-secret-0123456789' : k === 'jwt.accessTtl' ? 900 : k === 'jwt.refreshSecret' ? 's10-refresh-secret-0123456789' : k === 'jwt.refreshTtl' ? 604800 : undefined) } as never;
  const tokens = new TokenService(jwt, config);
  const principals = new PrincipalResolver(db);
  const refreshTokens = new RefreshTokenService(db, jwt, dbCtx, config);
  const auth = new AuthService(db, passwords, tokens, refreshTokens, principals, dbCtx);
  return { auth, passwords };
}

/** Seed via owner connection (RLS bypass) — same fixture pattern as
 *  s10-auth-security.spec.ts. The developer row mirrors how an operator would
 *  provision the account (migration / CLI), NOT the invite flow. */
async function seedDeveloper(passwords: PasswordService): Promise<void> {
  const admin = createDatabase(ADMIN_URL);
  const hash = await passwords.hash(DEV_PASSWORD);
  await admin.execute(sql`DELETE FROM role_assignments WHERE staff_id = ${DEV_STAFF_ID}`);
  await admin.execute(sql`DELETE FROM refresh_tokens WHERE staff_id = ${DEV_STAFF_ID}`);
  await admin.execute(sql`DELETE FROM staff WHERE id = ${DEV_STAFF_ID}`);
  await admin.execute(sql`
    INSERT INTO staff (id, org_id, branch_id, name, username, password_hash, role, status)
    VALUES (${DEV_STAFF_ID}, ${ORG_ID}, NULL, 'S10 Test Developer', ${DEV_USERNAME}, ${hash}, 'developer', 'Active')
  `);
  await admin.execute(sql`
    INSERT INTO role_assignments (id, org_id, staff_id, role, branch_id)
    VALUES ('d1000000-0000-4000-8000-0000000000d2', ${ORG_ID}, ${DEV_STAFF_ID}, 'developer', NULL)
  `);
}

async function cleanup(): Promise<void> {
  const admin = createDatabase(ADMIN_URL);
  await admin.execute(sql`DELETE FROM role_assignments WHERE staff_id = ${DEV_STAFF_ID}`);
  await admin.execute(sql`DELETE FROM refresh_tokens WHERE staff_id = ${DEV_STAFF_ID}`);
  await admin.execute(sql`DELETE FROM staff WHERE id = ${DEV_STAFF_ID}`);
}

describe('S10 GLM 5.3 — Developer account (live PG)', () => {
  dbIt('developer logs in via the NORMAL auth pipeline and receives a scoped principal', async () => {
    const { auth, passwords } = build();
    await seedDeveloper(passwords);
    try {
      const { result, principal } = await auth.login(DEV_USERNAME, DEV_PASSWORD);
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(principal.role).toBe('developer');
      expect(principal.branchId).toBeNull(); /* branch-less like hq — but NOT hq */
    } finally { await cleanup(); await closeDatabase(); }
  });

  dbIt('refresh rotates and logout revokes (same lifecycle as any user — no backdoor)', async () => {
    const { auth, passwords } = build();
    await seedDeveloper(passwords);
    try {
      const { result, principal } = await auth.login(DEV_USERNAME, DEV_PASSWORD);
      const rotated = await auth.refresh(result.refreshToken);
      expect(rotated.refreshToken).not.toBe(result.refreshToken);
      await auth.logout(rotated.refreshToken, principal);
      await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(Error);
    } finally { await cleanup(); await closeDatabase(); }
  });

  it('matrix is fail-closed: developer can() NOTHING in every business domain', () => {
    const domains = ['dashboard', 'patients', 'appointments', 'clinical', 'documents', 'finance', 'reports', 'marketing', 'operations', 'whatsapp', 'ai', 'admin', 'settings'];
    const actions = ['view', 'create', 'edit', 'submit', 'approve', 'delete'];
    for (const d of domains) for (const a of actions) {
      expect(can('developer', d, a, { actorBranchId: null, branchId: null })).toBe(false);
      expect(can('developer', d, a, { actorBranchId: 'b', branchId: 'b', doctorId: 'x', actorDoctorId: 'x' })).toBe(false);
    }
  });

  dbIt('RLS RESTRICTIVE: developer cannot SELECT patients as medini_app with developer GUC', async () => {
    const { passwords } = build();
    await seedDeveloper(passwords);
    try {
      /* Real runtime role (medini_app) + developer GUC → RESTRICTIVE policy
       * must deny rows: either 42501 error or zero rows visible. */
      const rt = createDatabase(RUNTIME_URL);
      await rt.execute(sql`SET app.role = 'developer'`);
      const res = await rt.execute(sql`SELECT id FROM patients LIMIT 1`).catch((e: unknown) => e);
      const denied = res instanceof Error
        ? /row-level security|42501/.test(String((res as Error).message))
        : ((res as unknown as { rows?: unknown[] }).rows?.length ?? 0) === 0;
      expect(denied).toBe(true);
      await rt.execute(sql`RESET app.role`).catch(() => undefined);
    } finally { await cleanup(); await closeDatabase(); }
  });

  dbIt('RLS RESTRICTIVE: developer cannot INSERT into business tables as medini_app', async () => {
    const { passwords } = build();
    await seedDeveloper(passwords);
    try {
      const rt = createDatabase(RUNTIME_URL);
      await rt.execute(sql`SET app.role = 'developer'`);
      const res = await rt.execute(sql`
        INSERT INTO tasks (id, org_id, title, status)
        VALUES ('d1000000-0000-4000-8000-0000000000d3', ${ORG_ID}, 'x', 'open')
      `).catch((e: unknown) => e);
      expect(res instanceof Error).toBe(true);
      /* drizzle wraps the PG error — the 42501/RLS text lives in .cause. */
      const full = String((res as Error).message) + String((res as { cause?: unknown }).cause ?? '');
      expect(full).toMatch(/row-level security|42501/);
      await rt.execute(sql`RESET app.role`).catch(() => undefined);
    } finally { await cleanup(); await closeDatabase(); }
  });

  dbIt('existing roles unaffected: hq still reads patients (regression guard)', async () => {
    const rt = createDatabase(RUNTIME_URL);
    await rt.execute(sql`SET app.role = 'hq'`);
    const res = await rt.execute(sql`SELECT count(*)::int AS c FROM patients`).catch((e: unknown) => e);
    expect(res instanceof Error).toBe(false);
    await rt.execute(sql`RESET app.role`).catch(() => undefined);
    await closeDatabase();
  });
});
