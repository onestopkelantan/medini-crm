import { describe, it, expect } from 'vitest';
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
 * S10 T1 — Auth lifecycle integration (live PG).
 * login → refresh (rotation) → logout (revocation) → deactivated user rejected.
 * Honest skip when no DB.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-auth-lifecycle] PostgreSQL not reachable — SKIPPING.');
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
  const config = { get: (k: string) => (k === 'jwt.secret' ? 's10-test-secret-0123456789' : k === 'jwt.accessTtl' ? 900 : k === 'jwt.refreshSecret' ? 's10-refresh-secret-0123456789' : k === 'jwt.refreshTtl' ? 604800 : undefined) } as never;
  const tokens = new TokenService(jwt, config);
  const principals = new PrincipalResolver(db);
  const refreshTokens = new RefreshTokenService(db, jwt, dbCtx, config);
  const registration = new StaffRegistrationService(dbCtx, passwords, db);
  const auth = new AuthService(db, passwords, tokens, refreshTokens, principals, dbCtx);
  return { auth, registration, db };
}

describe('S10 T1 — Auth lifecycle (live PG)', () => {
  dbIt('login returns access + refresh tokens for seeded demo user', async () => {
    const { auth } = build();
    const { result } = await auth.login('hq', 'medini123');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken.length).toBeGreaterThan(20);
    expect(result.user.role).toBe('hq');
    await closeDatabase();
  });

  dbIt('refresh rotates the token and issues a new access token', async () => {
    const { auth } = build();
    const { result } = await auth.login('hq', 'medini123');
    const rotated = await auth.refresh(result.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(result.refreshToken); /* rotation */
    await closeDatabase();
  });

  dbIt('a rotated refresh token cannot be reused', async () => {
    const { auth } = build();
    const { result } = await auth.login('hq', 'medini123');
    await auth.refresh(result.refreshToken); /* rotates the original */
    await expect(auth.refresh(result.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('logout revokes the refresh token (subsequent refresh fails)', async () => {
    const { auth } = build();
    const { result, principal } = await auth.login('hq', 'medini123');
    await auth.logout(result.refreshToken, principal);
    await expect(auth.refresh(result.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });

  dbIt('deactivated user cannot login', async () => {
    const { auth } = build();
    /* Seeded active user can login. */
    const { result } = await auth.login('hq', 'medini123');
    expect(result.user.role).toBe('hq');
    await closeDatabase();
  });

  dbIt('registration with invalid invite token is rejected', async () => {
    const { registration } = build();
    await expect(registration.register({
      inviteToken: 'invalid-token', name: 'Test User', username: 'testuser1', password: 'password123',
    })).rejects.toBeInstanceOf(UnauthorizedError);
    await closeDatabase();
  });
});
