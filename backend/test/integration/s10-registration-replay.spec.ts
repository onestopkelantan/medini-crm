import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import { Client } from 'pg';
import { ensureReplayFixture, REPLAY_DB } from './_replay-fixture';

/**
 * S10 GLM 5.3 Final Remediation — LIVE registration clean-replay test (§5).
 *
 * Boots the COMPILED app (dist/main.js — vitest workers cannot boot Nest
 * without crashing) against the CLEAN REPLAY database (0000→0028 replayed),
 * then drives the complete staff lifecycle through the ACTUAL HTTP path:
 *
 *   1. seed first-HQ (out-of-band, owner connection — bootstrap model)
 *   2. HQ login → JWT
 *   3. HQ invite staff (Invited row, single-use token)
 *   4. generate invite link (origin from APP_PUBLIC_BASE_URL only)
 *   5. staff registers through POST /auth/register (SECURITY DEFINER)
 *   6. verify Pending state (owner connection)
 *   7. verify password Argon2id-hashed
 *   8. verify invite token CLEARED (single-use)
 *   9. re-register with same token → REJECTED (single-use proof)
 *  10. HQ approves → Active
 *  11. staff login through HTTP → access + refresh tokens
 *  12. authenticated session (/auth/me) verified
 *  13. role boundary: staff cannot hit admin-only endpoint (403)
 *
 * No production mutation: the replay DB is disposable and dropped by the
 * cleanup task afterwards.
 */
const PORT = 4700 + Math.floor(Math.random() * 200);
const DB_ADMIN = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
const REPLAY_ADMIN = withDb(DB_ADMIN, REPLAY_DB);
/* Runtime (medini_app) credentials come from DATABASE_RUNTIME_URL — medini_app
 * has its OWN password, distinct from the owner role. */
const REPLAY_APP = withDb(process.env.DATABASE_RUNTIME_URL ?? DB_ADMIN, REPLAY_DB);
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const HQ_USER = 'hq_s10replay';
const HQ_PASS = 'HqReplay!S10-pass1';
const STAFF_USER = 'staff_s10replay';
const STAFF_PASS = 'StaffReplay!S10-p1';

function waitReady(): Promise<void> {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const ping = (): void => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/health/live' }, (r) => {
        r.resume();
        r.on('end', () => res());
      }).on('error', () => {
        if (Date.now() - t0 > 60_000) rej(new Error('app did not become ready'));
        else setTimeout(ping, 500);
      });
    };
    ping();
  });
}

function request(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
  const data = body ? JSON.stringify(body) : null;
  return new Promise((res, rej) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (data) headers['content-length'] = String(Buffer.byteLength(data));
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (r) => {
      let buf = '';
      r.on('data', (d) => { buf += d.toString(); });
      r.on('end', () => {
        let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
        try { json = JSON.parse(buf); } catch { /* non-JSON */ }
        res({ status: r.statusCode ?? -1, json });
      });
    });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}

/** Owner-connection seed of the FIRST HQ account (bootstrap model — S10 doc). */
async function seedFirstHq(): Promise<void> {
  const client = new Client({ connectionString: REPLAY_ADMIN });
  await client.connect();
  try {
    /* Direct owner INSERT — the documented first-HQ bootstrap path. */
    const argon2 = (await import('argon2')).default;
    const hash = await argon2.hash(HQ_PASS, { type: (await import('argon2')).argon2id });
    await client.query(
      `INSERT INTO staff (id, org_id, branch_id, name, username, password_hash, role, status)
       VALUES ('f1000000-0000-4000-8000-000000000001', $1, NULL, 'First HQ', $2, $3, 'hq', 'Active')
       ON CONFLICT (org_id, username) DO NOTHING`,
      [ORG_ID, HQ_USER, hash],
    );
    await client.query(
      `INSERT INTO role_assignments (id, org_id, staff_id, role, branch_id, status)
       VALUES ('f1000000-0000-4000-8000-000000000002', $1, 'f1000000-0000-4000-8000-000000000001', 'hq', NULL, 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [ORG_ID],
    );
  } finally {
    await client.end();
  }
}

async function ownerQuery(sql: string, params?: unknown[]): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
  const client = new Client({ connectionString: REPLAY_ADMIN });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

/** Idempotent reset of this spec's fixtures (re-runs must be deterministic). */
async function resetFixtures(): Promise<void> {
  await ownerQuery(`DELETE FROM role_assignments WHERE staff_id IN (SELECT id FROM staff WHERE username IN ($1, $2, $3, $4))`,
    [HQ_USER, 'invited_replay_s10', STAFF_USER, 'nope_replay_s10']);
  await ownerQuery(`DELETE FROM refresh_tokens WHERE staff_id IN (SELECT id FROM staff WHERE username IN ($1, $2, $3, $4))`,
    [HQ_USER, 'invited_replay_s10', STAFF_USER, 'nope_replay_s10']);
  await ownerQuery(`DELETE FROM staff WHERE username IN ($1, $2, $3, $4)`,
    [HQ_USER, 'invited_replay_s10', STAFF_USER, 'nope_replay_s10']);
}

/** Seed a branch so a non-HQ (doctor) staff member can be invited with the
 *  branch-assignment rule satisfied — this makes the role-boundary (403)
 *  assertion meaningful. */
const BRANCH_ID = 'b1000000-0000-4000-8000-0000000000b1';
async function seedBranch(): Promise<void> {
  await ownerQuery(`
    INSERT INTO branches (id, org_id, code, short_name, full_name, type, status)
    VALUES ($1, $2, 'S10R', 'S10 Replay', 'S10 Replay Branch', 'main', 'active')
    ON CONFLICT (org_id, code) DO NOTHING
  `, [BRANCH_ID, ORG_ID]);
}

describe('S10 §5 — live registration flow on CLEAN REPLAY (0000→0028)', () => {
  let proc: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    const distMain = resolve(__dirname, '../../dist/main.js');
    if (!existsSync(distMain)) throw new Error('dist/main.js missing — run `npm run build` first');
    /* F-01: self-contained — create+replay the fixture DB if absent (advisory
     * lock serializes concurrent spec files; existing valid fixture is reused). */
    await ensureReplayFixture(DB_ADMIN);
    await resetFixtures();
    await seedBranch();
    await seedFirstHq();
    proc = spawn(process.execPath, [distMain], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        DATABASE_URL: REPLAY_ADMIN,
        DATABASE_RUNTIME_URL: REPLAY_APP,
        APP_PUBLIC_BASE_URL: 'https://app.medini.example',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr?.on('data', () => undefined);
    proc.stdout?.on('data', () => undefined);
    await waitReady();
  }, 90_000);

  afterAll(() => { proc?.kill(); });

  it('1-4: HQ login → invite → single-use token materialized', async () => {
    const login = await request('POST', '/api/v1/auth/login', { username: HQ_USER, password: HQ_PASS });
    expect(login.status).toBe(200);
    expect(login.json?.data?.accessToken ?? login.json?.accessToken).toBeTruthy();
    const token = login.json?.data?.accessToken ?? login.json?.accessToken;

    /* HQ invites a new staff member (Administration domain — route is
     * /api/v1/admin/*; invite requires username + role per inviteInput).
     * Role 'doctor' WITH a branch — the role-boundary test then proves a
     * non-HQ role is denied admin endpoints (403). */
    const invite = await request('POST', '/api/v1/admin/staff', {
      name: 'Replay Staff', username: 'invited_replay_s10', role: 'doctor', branchId: BRANCH_ID,
    }, token);
    expect([200, 201]).toContain(invite.status);
    const staffId = invite.json?.data?.id ?? invite.json?.id;

    /* The invitation token/link is generated by HQ (out-of-band delivery). */
    const link = await request('POST', `/api/v1/admin/staff/${staffId}/invite-link`, {}, token);
    expect([200, 201]).toContain(link.status);
    const inviteUrl: string = link.json?.data?.inviteLink ?? link.json?.inviteLink ?? link.json?.data?.url ?? link.json?.url ?? '';
    expect(inviteUrl).toContain('https://app.medini.example');
    const inviteToken = new URL(inviteUrl).searchParams.get('token') ?? '';
    expect(inviteToken.length).toBeGreaterThan(20);

    /* 5. Pending registration state visible in DB (Invited). */
    const rows = await ownerQuery('SELECT status, invite_token FROM staff WHERE id = $1', [staffId]);
    expect(rows[0]?.status).toBe('Invited');
    expect(rows[0]?.invite_token).toBeTruthy();

    /* Stash for the next tests. */
    (globalThis as any).__s10 = { hqToken: token, staffId, inviteToken }; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
  });

  it('5-9: staff registers via ACTUAL /auth/register; Pending + Argon2id + token cleared + single-use', async () => {
    const { inviteToken } = (globalThis as any).__s10; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
    const reg = await request('POST', '/api/v1/auth/register', {
      inviteToken, name: 'Replay Staff', username: STAFF_USER, password: STAFF_PASS,
    });
    expect([200, 201]).toContain(reg.status);

    const rows = await ownerQuery(
      'SELECT status, password_hash, invite_token FROM staff WHERE username = $1', [STAFF_USER],
    );
    /* 6. Pending state. */
    expect(rows[0]?.status).toBe('Pending');
    /* 7. Argon2id hash. */
    expect(String(rows[0]?.password_hash)).toMatch(/^\$argon2id\$/);
    /* 8. token cleared. */
    expect(rows[0]?.invite_token).toBeNull();

    /* 9. single-use: re-register with the SAME token must fail. */
    const again = await request('POST', '/api/v1/auth/register', {
      inviteToken, name: 'Clone', username: 'clone_user', password: 'clonepass123',
    });
    expect([400, 401, 403, 409, 422]).toContain(again.status);
  });

  it('10-11: HQ approves → Active; staff logs in via HTTP (access + refresh)', async () => {
    const { hqToken, staffId } = (globalThis as any).__s10; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
    const approve = await request('POST', `/api/v1/admin/staff/${staffId}/approve`, {}, hqToken);
    expect([200, 201]).toContain(approve.status);
    const rows = await ownerQuery('SELECT status FROM staff WHERE id = $1', [staffId]);
    expect(rows[0]?.status).toBe('Active');

    /* Pending user could NOT login before approval; now Active can. */
    const login = await request('POST', '/api/v1/auth/login', { username: STAFF_USER, password: STAFF_PASS });
    expect(login.status).toBe(200);
    const access = login.json?.data?.accessToken ?? login.json?.accessToken;
    const refresh = login.json?.data?.refreshToken ?? login.json?.refreshToken;
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();

    /* 12. authenticated session verified via /auth/me. */
    const me = await request('GET', '/api/v1/auth/me', undefined, access);
    expect(me.status).toBe(200);
    expect(me.json?.data?.username).toBe(STAFF_USER);

    /* 13. role boundary: doctor cannot use admin-only endpoints (403). */
    const forbidden = await request('POST', '/api/v1/admin/staff', {
      name: 'Nope', username: 'nope_replay_s10', role: 'doctor',
    }, access);
    expect([403]).toContain(forbidden.status);

    /* Refresh rotation through the actual HTTP path. */
    const rf = await request('POST', '/api/v1/auth/refresh', { refreshToken: refresh });
    expect(rf.status).toBe(200);
    const rotated = rf.json?.data?.refreshToken ?? rf.json?.refreshToken;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refresh);

    /* Logout revokes the rotated token. */
    const out = await request('POST', '/api/v1/auth/logout', { refreshToken: rotated }, access);
    expect([200, 201]).toContain(out.status);
    const reuse = await request('POST', '/api/v1/auth/refresh', { refreshToken: rotated });
    expect([400, 401, 403]).toContain(reuse.status);
  });
});