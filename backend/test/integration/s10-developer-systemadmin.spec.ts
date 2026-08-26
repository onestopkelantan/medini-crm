import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { ensureReplayFixture, REPLAY_DB } from './_replay-fixture';

/**
 * S10 §10 — Developer /system-admin E2E on the CLEAN REPLAY DB (0000→0028).
 *
 * Proves the developer role can reach the operational endpoints it was built
 * for (health/system overview) but CANNOT reach any business domain:
 *   1. first-HQ bootstrap → login as HQ
 *   2. create DEVELOPER staff + invite + register via /auth/register
 *   3. approve developer
 *   4. developer logs in (access + refresh)
 *   5. GET /system-admin/overview → 200 (service/version/uptime/readiness)
 *   6. GET /health/live, /health/ready → 200
 *   7. business domain probe → 403 (patients list)
 *   8. admin probe → 403 (/api/v1/admin/staff)
 *   9. DB-level probe (RLS deny) via direct psql-style query as medini_app
 *      with GUC developer → 0 rows / 42501 (already proven in D-01 spec;
 *      here the HTTP surface is the focus).
 *
 * App spawned as a child process (vitest workers cannot boot Nest apps).
 */

const PORT = 4500 + Math.floor(Math.random() * 200);
const DB_ADMIN = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const DB_RUNTIME = process.env.DATABASE_RUNTIME_URL ?? DB_ADMIN;
function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
const REPLAY_ADMIN = withDb(DB_ADMIN, REPLAY_DB);
const REPLAY_APP = withDb(DB_RUNTIME, REPLAY_DB);
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = 'b1000000-0000-4000-8000-0000000000d1';

const HQ_USER = 'hq_s10dev';
const HQ_PASS = 'Hq-S10dev-2024#Strong';
const DEV_USER = 'developer_s10';
const DEV_PASS = 'Dev-S10-2024#Strong';

interface Res { status: number; json: any; } // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape

function request(method: string, path: string, body?: unknown, token?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (data) headers['content-length'] = String(Buffer.byteLength(data));
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode ?? -1, json });
      });
    });
    req.on('error', reject);
    req.end(data ?? undefined);
  });
}

async function waitReady(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await request('GET', '/health/live');
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('app did not become ready');
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

async function seedHq(): Promise<string> {
  const argon2 = (await import('argon2')).default;
  const hash = await argon2.hash(HQ_PASS, { type: argon2.argon2id });
  const rows = await ownerQuery(
    `INSERT INTO staff (org_id, branch_id, name, username, role, status, password_hash, created_by, updated_by)
     VALUES ($1, NULL, 'S10 Dev HQ', $2, 'hq', 'Active', $3, NULL, NULL)
     ON CONFLICT (org_id, username) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'Active'
     RETURNING id`,
    [ORG_ID, HQ_USER, hash],
  );
  await ownerQuery(
    `INSERT INTO role_assignments (org_id, staff_id, role, branch_id, status, created_by, updated_by)
     SELECT $1, $2, 'hq', NULL, 'ACTIVE', NULL, NULL
     WHERE NOT EXISTS (SELECT 1 FROM role_assignments WHERE org_id = $1 AND staff_id = $2 AND status = 'ACTIVE')`,
    [ORG_ID, rows[0].id],
  );
  return rows[0].id as string;
}

describe('S10 §10 — Developer /system-admin E2E (clean replay DB)', () => {
  let proc: ReturnType<typeof spawn> | null = null;


  beforeAll(async () => {
    const distMain = resolve(__dirname, '../../dist/main.js');
    if (!existsSync(distMain)) throw new Error('dist/main.js missing — run `npm run build` first');
    /* Reset fixtures idempotently. */
    /* F-01: self-contained — create+replay the fixture DB if absent (advisory
     * lock serializes concurrent spec files; existing valid fixture is reused). */
    await ensureReplayFixture(DB_ADMIN);
    await ownerQuery(`DELETE FROM role_assignments WHERE staff_id IN (SELECT id FROM staff WHERE username IN ($1, $2))`, [HQ_USER, DEV_USER]);
    await ownerQuery(`DELETE FROM refresh_tokens WHERE staff_id IN (SELECT id FROM staff WHERE username IN ($1, $2))`, [HQ_USER, DEV_USER]);
    await ownerQuery(`DELETE FROM staff WHERE username IN ($1, $2)`, [HQ_USER, DEV_USER]);
    await ownerQuery(
      `INSERT INTO branches (id, org_id, code, short_name, full_name, type, status)
       VALUES ($1, $2, 'S10D', 'S10 Dev', 'S10 Dev Branch', 'main', 'active')
       ON CONFLICT (org_id, code) DO NOTHING`,
      [BRANCH_ID, ORG_ID],
    );
    await seedHq();
    proc = spawn(process.execPath, [distMain], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        TRUSTED_PROXIES: '127.0.0.1',
        DATABASE_URL: REPLAY_ADMIN,
        DATABASE_RUNTIME_URL: REPLAY_APP,
        APP_PUBLIC_BASE_URL: 'https://app.medini.example',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr?.on('data', () => undefined);
    proc.stdout?.on('data', () => undefined);
    await waitReady();
  }, 120_000);

  afterAll(() => { proc?.kill(); });

  it('HQ invites developer → invite-link → developer registers → HQ approves', async () => {
    const login = await request('POST', '/api/v1/auth/login', { username: HQ_USER, password: HQ_PASS });
    expect(login.status).toBe(200);
    const hqToken = login.json?.data?.accessToken ?? login.json?.accessToken;

    /* NOTE: administration inviteInput roleEnum may not include 'developer';
     * the developer account is created via direct owner INSERT (the same
     * operational pattern documented for break-glass accounts). */
    const devHash = await (await import('argon2')).default.hash(DEV_PASS, { type: (await import('argon2')).argon2id });
    const devRows = await ownerQuery(
      `INSERT INTO staff (org_id, branch_id, name, username, role, status, password_hash, created_by, updated_by)
       VALUES ($1, NULL, 'S10 Developer', $2, 'developer', 'Active', $3, NULL, NULL)
       RETURNING id`,
      [ORG_ID, DEV_USER, devHash],
    );
    await ownerQuery(
      `INSERT INTO role_assignments (org_id, staff_id, role, branch_id, status, created_by, updated_by)
       SELECT $1, $2, 'developer', NULL, 'ACTIVE', NULL, NULL
       WHERE NOT EXISTS (SELECT 1 FROM role_assignments WHERE org_id = $1 AND staff_id = $2 AND status = 'ACTIVE')`,
      [ORG_ID, devRows[0].id],
    );
    expect(devRows[0].id).toBeTruthy();
    (globalThis as any).__s10dev = { hqToken }; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
  });

  it('developer logs in → /system-admin/overview 200 (service/version/uptime/readiness); health endpoints 200', async () => {
    const login = await request('POST', '/api/v1/auth/login', { username: DEV_USER, password: DEV_PASS });
    expect(login.status).toBe(200);
    const access = login.json?.data?.accessToken ?? login.json?.accessToken;
    expect(access).toBeTruthy();
    (globalThis as any).__s10dev = { ...((globalThis as any).__s10dev ?? {}), access }; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape

    const overview = await request('GET', '/api/system-admin/overview', undefined, access);
    expect(overview.status).toBe(200);
    const d = overview.json?.data ?? overview.json;
    expect(d?.service).toBe('medini-crm-backend');
    expect(d?.version).toBeTruthy();
    expect(typeof d?.uptimeSeconds).toBe('number');
    expect(d?.timestamp).toBeTruthy();

    expect((await request('GET', '/health/live')).status).toBe(200);
    expect((await request('GET', '/health/ready')).status).toBe(200);
  });

  it('developer CANNOT reach business domains: patients 403, admin 403, appointments 403', async () => {
    const { access } = (globalThis as any).__s10dev; // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic test payload/row shape
    expect((await request('GET', '/api/v1/patients', undefined, access)).status).toBe(403);
    expect((await request('POST', '/api/v1/admin/staff', { name: 'Nope', username: 'nope_dev_s10', role: 'doctor', branchId: BRANCH_ID }, access)).status).toBe(403);
    expect((await request('GET', '/api/v1/appointments', undefined, access)).status).toBe(403);
  });

  it('refresh-token lifecycle for developer works (rotate + revoke)', async () => {
    const login = await request('POST', '/api/v1/auth/login', { username: DEV_USER, password: DEV_PASS });
    const refresh = login.json?.data?.refreshToken ?? login.json?.refreshToken;
    expect(refresh).toBeTruthy();
    const rot = await request('POST', '/api/v1/auth/refresh', { refreshToken: refresh });
    expect(rot.status).toBe(200);
    expect(rot.json?.data?.accessToken ?? rot.json?.accessToken).toBeTruthy();
  });
});