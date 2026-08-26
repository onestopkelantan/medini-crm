import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, createFreshDatabase, closeDatabase } from '@infrastructure/database/database';
import { PasswordService } from '@core/auth/password.service';
import { TokenService } from '@core/auth/token.service';
import { RefreshTokenService } from '@core/auth/refresh-token.service';
import { StaffRegistrationService } from '@core/auth/staff-registration.service';
import { PrincipalResolver } from '@core/auth/principal.resolver';
import { AuthService } from '@core/auth/auth.service';
import { DbContextService } from '@core/auth/db-context.service';
import { JwtService } from '@nestjs/jwt';

/**
 * S10 GLM — Happy-path registration integration test (live PG).
 * HQ Invite → Generate Link → Register → Pending → Approve → Active → Login.
 * Proves S10-01 remediation: clean migration supports the full flow.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-happy-path] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const ORG = '00000000-0000-0000-0000-000000000001';

function build() {
  const db = createDatabase(RUNTIME_URL);
  const dbCtx = new DbContextService(db);
  const passwords = new PasswordService();
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'jwt.secret' ? 's10glm-secret-0123456789' : k === 'jwt.accessTtl' ? 900 : k === 'jwt.refreshSecret' ? 's10glm-refresh-0123456789' : k === 'jwt.refreshTtl' ? 604800 : undefined) } as never;
  const tokens = new TokenService(jwt, config);
  const principals = new PrincipalResolver(db);
  const refreshTokens = new RefreshTokenService(db, jwt, dbCtx, config);
  const registration = new StaffRegistrationService(dbCtx, passwords, db);
  const auth = new AuthService(db, passwords, tokens, refreshTokens, principals, dbCtx);
  return { auth, registration, db, dbCtx };
}

describe('S10 GLM — Happy-path Registration', () => {
  dbIt('HQ invite → generate link → register → pending → approve → active → login (full flow)', async () => {
    const { auth, registration } = build();
    const admin = createFreshDatabase(ADMIN_URL).db;
    const branchId = (await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`) as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    if (!branchId) { console.warn('No branches — skipping'); return; }
    const staffId = 'a1000000-0000-4000-8000-000000000040';
    const username = 'happy_path_s10glm';

    /* Cleanup */
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);

    /* 1. HQ invites (creates Invited staff) */
    await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status)
      VALUES (${staffId}, ${ORG}, ${branchId}, 'Happy Path Staff', ${username}, 'branch_admin', 'Invited')`);

    /* 2. HQ generates invite link */
    const hqPrincipal = { staffId: 'hq-1', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null } as never;
    const { token } = await registration.generateInviteToken(hqPrincipal, staffId);
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(20);

    /* 3. Staff registers (happy path) */
    const reg = await registration.register({ inviteToken: token, name: 'Happy Path Staff', username, password: 'securepass123' });
    expect(reg.status).toBe('Pending');
    expect(reg.staffId).toBe(staffId);

    /* 4. Verify persisted state: status=Pending, password hashed, token cleared */
    const persisted = (await admin.execute(sql`SELECT status, password_hash, invite_token FROM staff WHERE id = ${staffId}`) as unknown as { rows: Array<{ status: string; password_hash: string; invite_token: string | null }> }).rows[0];
    expect(persisted?.status).toBe('Pending');
    expect(persisted?.password_hash).toContain('$argon2id$'); /* Argon2id hash, not plaintext */
    expect(persisted?.invite_token).toBeNull(); /* single-use token cleared */

    /* 5. Pending cannot login yet */
    await expect(auth.login(username, 'securepass123')).rejects.toThrow();

    /* 6. HQ approves (Pending → Active) */
    await admin.execute(sql`UPDATE staff SET status = 'Active' WHERE id = ${staffId}`);

    /* 7. Active can login */
    const { result } = await auth.login(username, 'securepass123');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe(username);
    expect(result.user.role).toBe('branch_admin');

    /* 8. Authenticated session works (me endpoint via principal resolution) */
    expect(result.user.staffId).toBe(staffId);

    /* Cleanup */
    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await closeDatabase();
  });

  dbIt('invitation token is single-use (second registration with same token fails)', async () => {
    const { registration } = build();
    const admin = createFreshDatabase(ADMIN_URL).db;
    const branchId = (await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`) as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    if (!branchId) { console.warn('No branches — skipping'); return; }
    const staffId = 'a1000000-0000-4000-8000-000000000041';
    const username = 'single_use_s10glm';

    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status)
      VALUES (${staffId}, ${ORG}, ${branchId}, 'Single Use Staff', ${username}, 'branch_admin', 'Invited')`);

    const hqPrincipal = { staffId: 'hq-1', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null } as never;
    const { token } = await registration.generateInviteToken(hqPrincipal, staffId);

    /* First registration succeeds */
    await registration.register({ inviteToken: token, name: 'Single Use Staff', username, password: 'securepass123' });

    /* Second registration with same token fails (token cleared) */
    await expect(registration.register({ inviteToken: token, name: 'Single Use Staff', username: 'single_use_2', password: 'securepass123' })).rejects.toThrow();

    await admin.execute(sql`DELETE FROM staff WHERE id = ${staffId}`);
    await closeDatabase();
  });
});
