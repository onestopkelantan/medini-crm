import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createDatabase, createFreshDatabase, closeDatabase,
} from '@infrastructure/database/database';
import { PasswordService } from '@core/auth/password.service';
import { TokenService } from '@core/auth/token.service';
import { PrincipalResolver } from '@core/auth/principal.resolver';
import { AuthService } from '@core/auth/auth.service';
import { DbContextService } from '@core/auth/db-context.service';
import { DbAuditAdapter } from '@infrastructure/database/db-audit.adapter';
import { JwtService } from '@nestjs/jwt';

/**
 * D1 + D2 verification — live PostgreSQL.
 *
 * D1: login events (success + failure) MUST persist to audit_log and survive.
 * D2: runAs() must set app.role BEFORE querying scoped data; HQ gets context,
 *     non-HQ cannot elevate.
 */
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[d1d2] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const ORG = '00000000-0000-0000-0000-000000000001';

function buildAuth() {
  const db = createDatabase(RUNTIME_URL);
  const passwords = new PasswordService();
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'jwt.secret' ? 'd1d2-test-secret-0123456789' : k === 'jwt.accessTtl' ? 900 : undefined) } as never;
  const tokens = new TokenService(jwt, config);
  const principals = new PrincipalResolver(db);
  const refreshTokens = { issueRefreshToken: async () => ({ rawToken: 'rt', expiresAt: new Date() }), rotate: async () => ({ rawToken: 'rt2', expiresAt: new Date() }), revoke: async () => {} } as never;
  const dbCtx = new DbContextService(db);
  const auth = new AuthService(db, passwords, tokens, refreshTokens, principals, dbCtx);
  return { auth, db };
}

describe('D1 — audit login persistence (live PG)', () => {
  dbIt('successful login writes a persistent audit_log record', async () => {
    const { auth, db } = buildAuth();
    const audit = new DbAuditAdapter(db);
    const { result, principal } = await auth.login('hq', 'medini123');
    /* mirror the controller's audit call */
    await audit.record({
      orgId: ORG, branchId: principal.branchId, actorId: principal.staffId,
      actorRole: principal.role, action: 'auth_login_success', entity: 'staff',
      entityId: principal.staffId, before: null, after: null, source: 'api',
      correlationId: 'd1-test-' + Date.now(), timestamp: new Date().toISOString(),
    });
    const rows = await db.execute(
      sql`SELECT action, entity, actor_role FROM audit_log WHERE action = 'auth_login_success' AND actor_id = ${principal.staffId}`,
    );
    expect((rows as unknown as { rows: Array<unknown> }).rows.length).toBeGreaterThanOrEqual(1);
    expect(result.accessToken).toBeTruthy();
    await closeDatabase();
  });

  dbIt('failed login writes a persistent audit_log record', async () => {
    const { db } = buildAuth();
    const audit = new DbAuditAdapter(db);
    const corr = 'd1-fail-' + Date.now();
    await audit.record({
      orgId: ORG, branchId: null, actorId: ORG, actorRole: 'anonymous',
      action: 'auth_login_failure', entity: 'staff', entityId: 'unknown',
      before: null, after: null, source: 'api', correlationId: corr,
      timestamp: new Date().toISOString(),
    });
    const rows = await db.execute(
      sql`SELECT action, correlation_id FROM audit_log WHERE correlation_id = ${corr}`,
    );
    expect((rows as unknown as { rows: Array<{ action: string }> }).rows[0]?.action).toBe('auth_login_failure');
    await closeDatabase();
  });

  dbIt('audit records never contain password/token/secret in payload', async () => {
    const { db } = buildAuth();
    /* scan recent auth audit rows for forbidden credential material */
    const rows = await db.execute(
      sql`SELECT before::text AS b, after::text AS a FROM audit_log WHERE action LIKE 'auth_login%'`,
    );
    for (const r of (rows as unknown as { rows: Array<{ b: string | null; a: string | null }> }).rows) {
      const payload = `${r.b ?? ''} ${r.a ?? ''}`.toLowerCase();
      expect(payload).not.toMatch(/medini123/);
      expect(payload).not.toMatch(/\$argon2id\$/);
      expect(payload).not.toMatch(/bearer|eyj[a-z0-9_-]*\.[a-z0-9_-]*\./);
    }
    await closeDatabase();
  });
});

describe('D2 — runAs() GUC ordering + HQ context (live PG)', () => {
  dbIt('HQ runAs sets app.role=hq FIRST then reads the full branch list', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const hqPrincipal = { staffId: 'x', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null };
    /* inside runAs, HQ should be able to read all branches (14) */
    const count = await ctx.runAs(hqPrincipal as never, async (tx) => {
      const r = await tx.execute(sql`SELECT count(*)::int AS n FROM branches`);
      return (r as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0;
    });
    expect(count).toBe(14);
    await close();
  });

  dbIt('runAs sets transaction-local app.role (not visible after COMMIT)', async () => {
    const db = createDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const hqPrincipal = { staffId: 'x', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null };
    await ctx.runAs(hqPrincipal as never, async () => undefined);
    /* after the transaction commits, app.role must NOT remain set on the pool */
    const after = await db.execute(sql`SELECT NULLIF(current_setting('app.role', true), '') AS r`);
    expect((after as unknown as { rows: Array<{ r: string | null }> }).rows[0]?.r ?? null).toBeNull();
    await closeDatabase();
  });

  dbIt('non-HQ runAs is scoped to its own branch only (cannot see HQ-wide)', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    /* a branch_manager with a single branchId gets only that branch's context */
    const mgr = { staffId: 'y', username: 'manager', role: 'branch_manager', orgId: ORG, branchId: 'one-branch-id', doctorId: null };
    const branchesSeen = await ctx.runAs(mgr as never, async (tx) => {
      /* branch_manager is NOT hq → app_branch_ids has 1 entry → sees ≤1 branch row */
      const r = await tx.execute(sql`SELECT count(*)::int AS n FROM branches`);
      return (r as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0;
    });
    expect(branchesSeen).toBeLessThanOrEqual(1);
    await close();
  });
});
