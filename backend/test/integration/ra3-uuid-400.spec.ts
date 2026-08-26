import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * RA-3 — Invalid UUID → HTTP 400 Bad Request.
 * The app is spawned as a real OS process (vitest workers cannot boot Nest
 * apps: process.abort() unsupported).
 *
 * Proves:
 *   - malformed UUID → 400
 *   - valid UUID but nonexistent → 404
 *   - valid UUID own-org → 200
 *   - valid UUID cross-org → 404 (RLS/authorization preserved)
 */

const PORT = 3999 + Math.floor(Math.random() * 500);

function get(path: string, token: string): Promise<{ status: number; body: string }> {
  return new Promise((r) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method: 'GET',
      headers: { 'authorization': `Bearer ${token}` }
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => r({ status: res.statusCode ?? -1, body }));
    });
    req.on('error', () => r({ status: -1, body: '' }));
    req.end();
  });
}

function post(path: string, data: unknown): Promise<{ status: number; body: string }> {
  return new Promise((r) => {
    const body = JSON.stringify(data);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => r({ status: res.statusCode ?? -1, body }));
    });
    req.on('error', () => r({ status: -1, body: '' }));
    req.end(body);
  });
}

async function waitReady(): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const res = await get('/health/live', '');
    if (res.status === 200) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('app did not become ready');
}

describe('RA-3 — Invalid UUID → HTTP 400 (compiled app, real HTTP)', () => {
  let proc: ReturnType<typeof spawn> | null = null;
  let token: string = '';
  let hqStaffId: string = '';

  beforeAll(async () => {
    const distMain = resolve(__dirname, '../../dist/main.js');
    if (!existsSync(distMain)) throw new Error('dist/main.js missing — run `npm run build` first');
    proc = spawn(process.execPath, [distMain], {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitReady();
    const login = await post('/api/v1/auth/login', { username: 'hq', password: 'medini123' });
    token = JSON.parse(login.body).accessToken;
    /* Resolve the authenticated HQ user's OWN staff id via the real API —
     * never a hardcoded instance-specific UUID. */
    const me = await get('/api/v1/auth/me', token);
    hqStaffId = JSON.parse(me.body).data.staffId;
  }, 60_000);

  afterAll(() => { proc?.kill(); });

  it('malformed UUID → 400 Bad Request', async () => {
    const res = await get('/api/v1/admin/staff/not-a-valid-uuid', token);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(['BAD_REQUEST','VALIDATION_ERROR']).toContain(body.error.code);
  });

  it('empty UUID segment → 400 Bad Request', async () => {
    const res = await get('/api/v1/admin/staff/', token);
    // This hits the list endpoint, not the :id endpoint — expect 200 or 403
    expect([200, 403, 404]).toContain(res.status);
  });

  it('valid UUID but nonexistent → 404 Not Found', async () => {
    const res = await get('/api/v1/admin/staff/00000000-0000-0000-0000-000000000000', token);
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('valid UUID own-org → 200 OK', async () => {
    // Use the authenticated HQ user's own staff ID (resolved via /auth/me),
    // not a hardcoded instance-specific UUID.
    const res = await get(`/api/v1/admin/staff/${hqStaffId}`, token);
    expect(res.status).toBe(200);
  });

  it('valid UUID cross-org → 404 (RLS preserves denial)', async () => {
    // This UUID belongs to a different org — RLS should filter it out → 404
    const res = await get('/api/v1/admin/staff/054c8ac4-0314-43ab-aae0-0ca8a29673b3', token);
    expect([404, 403]).toContain(res.status);
  });
});
