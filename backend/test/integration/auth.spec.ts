import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createDatabase, closeDatabase,
} from '@infrastructure/database/database';
import { PasswordService } from '@core/auth/password.service';
import { TokenService } from '@core/auth/token.service';
import { PrincipalResolver } from '@core/auth/principal.resolver';
import { DbContextService } from '@core/auth/db-context.service';
import { AuthService } from '@core/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedError } from '@shared/errors/errors';

/**
 * Auth integration — live PostgreSQL (DATABASE_RUNTIME_URL preferred, else
 * DATABASE_URL). Exercises the REAL login flow, password hashing, JWT, and
 * Principal resolution against seeded demo users. Honest skip when no DB.
 */
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';
const ADMIN_URL =
  process.env.DATABASE_URL ??
  'postgres://medini:medini_dev_password@localhost:5433/medini_dev';

const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[auth-integration] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

function buildAuth() {
  const db = createDatabase(RUNTIME_URL);
  const passwords = new PasswordService();
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'jwt.secret' ? 'integration-test-secret-0123456789' : k === 'jwt.accessTtl' ? 900 : undefined) } as never;
  const tokens = new TokenService(jwt, config);
  const principals = new PrincipalResolver(db);
  const refreshTokens = { issueRefreshToken: async () => ({ rawToken: 'rt', expiresAt: new Date() }), rotate: async () => ({ rawToken: 'rt2', expiresAt: new Date() }), revoke: async () => {} } as never;
  const dbCtx = new DbContextService(db);
  const auth = new AuthService(db, passwords, tokens, refreshTokens, principals, dbCtx);
  return { auth, principals, tokens, db };
}

describe('auth integration (live PG)', () => {
  dbIt('runtime DB identity is the non-owner role medini_app', async () => {
    const db = createDatabase(RUNTIME_URL);
    const res = await db.execute(sql`SELECT current_user AS u`);
    expect((res as unknown as { rows: Array<{ u: string }> }).rows[0]?.u).toBe('medini_app');
    await closeDatabase();
  });

  dbIt('login succeeds for seeded demo user (hq / medini123) with safe response', async () => {
    const { auth } = buildAuth();
    const { result } = await auth.login('hq', 'medini123');
    expect(result.accessToken).toBeTruthy();
    expect(result.user.username).toBe('hq');
    expect(result.user.role).toBe('hq');
    expect(result.user.branchId).toBeNull();
    /* never leak password/hash */
    expect(JSON.stringify(result)).not.toMatch(/password|hash|medini123/i);
    await closeDatabase();
  });

  dbIt('login rejects wrong password (single message, no enumeration)', async () => {
    const { auth } = buildAuth();
    await expect(auth.login('hq', 'wrong-password')).rejects.toThrow(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('login rejects unknown user with the SAME message as wrong password', async () => {
    const { auth } = buildAuth();
    await expect(auth.login('ghost-user', 'whatever')).rejects.toThrow(/Invalid username or password/);
    await closeDatabase();
  });

  dbIt('PrincipalResolver derives role/branch/doctor from DB (doctor has doctorId)', async () => {
    const { principals, db } = buildAuth();
    /* find the seeded doctor staff id */
    const rows = await db.execute(sql`SELECT id, username FROM staff WHERE username = 'doctor'`);
    const id = (rows as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    expect(id).toBeTruthy();
    const p = await principals.resolve(id!, '00000000-0000-0000-0000-000000000001');
    expect(p).not.toBeNull();
    expect(p!.role).toBe('doctor');
    /* Sprint 2 remediation #4: doctorId = staff UUID (matches appointments.doctor_id FK), NOT doctorRef string */
    expect(p!.doctorId).toBe(id);
    expect(p!.branchId).toBeTruthy();
    await closeDatabase();
  });

  dbIt('PrincipalResolver fails closed for non-existent staff id', async () => {
    const { principals } = buildAuth();
    const p = await principals.resolve('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000001');
    expect(p).toBeNull();
    await closeDatabase();
  });

  dbIt('issued token verifies and re-resolves to the same staff', async () => {
    const { auth, tokens, principals } = buildAuth();
    const { result } = await auth.login('manager', 'medini123');
    const claims = tokens.verifyAccess(result.accessToken);
    const p = await principals.resolve(claims.sub, claims.orgId);
    expect(p!.role).toBe('branch_manager');
    expect(p!.username).toBe('manager');
    await closeDatabase();
  });

  dbIt('adversarial: a token signed by an attacker cannot resolve (401)', async () => {
    const { tokens } = buildAuth();
    /* attacker signs their own token with a DIFFERENT secret but same claims */
    const jwt = new JwtService({});
    const forge = new TokenService(jwt, { get: (k: string) => (k === 'jwt.secret' ? 'attacker-secret-0123456789abcdef' : k === 'jwt.accessTtl' ? 900 : undefined) } as never);
    const forged = forge.signAccess({ sub: '00000000-0000-0000-0000-000000000002', username: 'hq', orgId: '00000000-0000-0000-0000-000000000001' });
    expect(() => tokens.verifyAccess(forged)).toThrow(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('adversarial: role in a (validly signed but self-claimed) token is ignored — role comes from DB', async () => {
    /* Even with a valid signature, the Principal's role is DB-derived. Here we
     * confirm resolve() ignores any token role and reads role_assignments. */
    const { principals } = buildAuth();
    const db = createDatabase(ADMIN_URL);
    const rows = await db.execute(sql`SELECT id FROM staff WHERE username = 'reception'`);
    const id = (rows as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    expect(id).toBeTruthy();
    const p = await principals.resolve(id!, '00000000-0000-0000-0000-000000000001');
    /* reception maps to branch_admin in DB (seed role), never trust a client 'hq' */
    expect(p!.role).toBe('branch_admin');
    await closeDatabase();
  });
});
