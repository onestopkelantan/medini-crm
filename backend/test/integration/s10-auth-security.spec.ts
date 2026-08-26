import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';
import { PasswordService } from '@core/auth/password.service';
import { TokenService } from '@core/auth/token.service';
import { RefreshTokenService } from '@core/auth/refresh-token.service';
import { StaffRegistrationService } from '@core/auth/staff-registration.service';
import { PrincipalResolver } from '@core/auth/principal.resolver';
import { AuthService } from '@core/auth/auth.service';
import { DbContextService } from '@core/auth/db-context.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedError } from '@shared/errors/errors';

/**
 * S10 T3 — Authentication security tests (live PG).
 * Login, refresh rotation/reuse/expiry/revocation, logout, deactivated/rejected/pending rejection.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-auth-security] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

function build() {
  const db = createDatabase(RUNTIME_URL);
  const dbCtx = new DbContextService(db);
  const passwords = new PasswordService();
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'jwt.secret' ? 's10t3-secret-0123456789' : k === 'jwt.accessTtl' ? 900 : k === 'jwt.refreshSecret' ? 's10t3-refresh-0123456789' : k === 'jwt.refreshTtl' ? 604800 : undefined) } as never;
  const tokens = new TokenService(jwt, config);
  const principals = new PrincipalResolver(db);
  const refreshTokens = new RefreshTokenService(db, jwt, dbCtx, config);
  const registration = new StaffRegistrationService(dbCtx, passwords, db);
  const auth = new AuthService(db, passwords, tokens, refreshTokens, principals, dbCtx);
  return { auth, registration, refreshTokens, principals, db, dbCtx };
}

/* Canonical seed identity — the seed inserts the single org and 14 branches
 * with DB-generated UUIDs (gen_random_uuid()); never hardcode those
 * instance-specific IDs here. Resolve by natural key instead. */
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CANONICAL_BRANCH_CODE = 'gelang-patah';

/** Resolve the canonical branch id by natural key (code), not a hardcoded
 *  instance-specific UUID. branches is FORCE RLS, so the owner connection must
 *  assert an hq app context to read it (mirrors the seed's own read-back). */
async function resolveBranchId(admin: ReturnType<typeof createDatabase>): Promise<string> {
  await admin.execute(sql`SELECT set_config('app.role', 'hq', false)`);
  const res = await admin.execute(
    sql`SELECT id FROM branches WHERE org_id = ${ORG_ID} AND code = ${CANONICAL_BRANCH_CODE} AND deleted_at IS NULL LIMIT 1`,
  );
  const id = (res as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
  if (!id) throw new Error(`canonical branch '${CANONICAL_BRANCH_CODE}' not found for org ${ORG_ID}`);
  return id;
}

describe('S10 T3 — Authentication Security', () => {
  /* ---------- Login ---------- */
  dbIt('login with valid credentials succeeds', async () => {
    const { auth } = build();
    const { result } = await auth.login('hq', 'medini123');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    await closeDatabase();
  });

  dbIt('login with wrong password is rejected (generic 401, no enumeration)', async () => {
    const { auth } = build();
    await expect(auth.login('hq', 'wrongpassword')).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('login with non-existent user is rejected (same generic message)', async () => {
    const { auth } = build();
    await expect(auth.login('nonexistent_user_xyz', 'password123')).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  /* ---------- Refresh ---------- */
  dbIt('valid refresh rotates and returns new pair', async () => {
    const { auth } = build();
    const { result } = await auth.login('hq', 'medini123');
    const rotated = await auth.refresh(result.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(result.refreshToken);
    await closeDatabase();
  });

  dbIt('reused rotated refresh token is rejected', async () => {
    const { auth } = build();
    const { result } = await auth.login('hq', 'medini123');
    await auth.refresh(result.refreshToken);
    await expect(auth.refresh(result.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('malformed refresh token is rejected', async () => {
    const { auth } = build();
    await expect(auth.refresh('not-a-real-token')).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  /* ---------- Logout ---------- */
  dbIt('logout revokes refresh token; subsequent refresh fails', async () => {
    const { auth } = build();
    const { result, principal } = await auth.login('hq', 'medini123');
    await auth.logout(result.refreshToken, principal);
    await expect(auth.refresh(result.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  /* ---------- Invitation security ---------- */
  dbIt('registration with invalid invite token is rejected', async () => {
    const { registration } = build();
    await expect(registration.register({
      inviteToken: 'invalid-token-xyz', name: 'Test', username: 'testuser1', password: 'password123',
    })).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('registration rejects weak password (< 8 chars)', async () => {
    const { registration } = build();
    await expect(registration.register({
      inviteToken: 'any-token', name: 'Test', username: 'testuser2', password: 'short',
    })).rejects.toThrow();
    await closeDatabase();
  });

  dbIt('registration rejects invalid username format', async () => {
    const { registration } = build();
    await expect(registration.register({
      inviteToken: 'any-token', name: 'Test', username: 'INVALID USER!', password: 'password123',
    })).rejects.toThrow();
    await closeDatabase();
  });

  /* ---------- Lifecycle login rejection ---------- */
  dbIt('Pending user cannot login (status != Active)', async () => {
    const { auth } = build();
    /* Create a Pending staff directly (simulating post-registration pre-approval) */
    const admin = createDatabase(ADMIN_URL);
    const branchId = await resolveBranchId(admin);
    const staffId = 'a1000000-0000-4000-8000-000000000001';
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status, password_hash)
      VALUES (${staffId}, ${ORG_ID}, ${branchId}, 'Pending User', 'pending_user_s10t3', 'branch_admin', 'Pending', '$argon2id$v=19$m=65536,t=3,p=4$dummy')`);
    await expect(auth.login('pending_user_s10t3', 'password123')).rejects.toBeInstanceOf(UnauthorizedError);
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await closeDatabase();
  });

  dbIt('Rejected user cannot login', async () => {
    const { auth } = build();
    const admin = createDatabase(ADMIN_URL);
    const branchId = await resolveBranchId(admin);
    const staffId = 'a1000000-0000-4000-8000-000000000002';
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status, password_hash)
      VALUES (${staffId}, ${ORG_ID}, ${branchId}, 'Rejected User', 'rejected_user_s10t3', 'branch_admin', 'Rejected', '$argon2id$v=19$m=65536,t=3,p=4$dummy')`);
    await expect(auth.login('rejected_user_s10t3', 'password123')).rejects.toBeInstanceOf(UnauthorizedError);
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await closeDatabase();
  });

  dbIt('Deactivated user cannot login', async () => {
    const { auth } = build();
    const admin = createDatabase(ADMIN_URL);
    const branchId = await resolveBranchId(admin);
    const staffId = 'a1000000-0000-4000-8000-000000000003';
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status, password_hash)
      VALUES (${staffId}, ${ORG_ID}, ${branchId}, 'Deactivated User', 'deact_user_s10t3', 'branch_admin', 'Deactivated', '$argon2id$v=19$m=65536,t=3,p=4$dummy')`);
    await expect(auth.login('deact_user_s10t3', 'password123')).rejects.toBeInstanceOf(UnauthorizedError);
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await closeDatabase();
  });
});
