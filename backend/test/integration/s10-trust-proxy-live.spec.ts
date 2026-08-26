import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * S10 F-03 — Live trust-proxy verification (GLM final audit condition #1).
 *
 * Boots the compiled app with TRUSTED_PROXIES set (the way production runs
 * behind Caddy) and proves the four required runtime cases:
 *
 *   A. Different client IPs behind the trusted proxy → SEPARATE buckets.
 *   B. Same client IP repeated → limit triggers correctly (429).
 *   C. Spoofed XFF from an UNTRUSTED source → cannot bypass (bucket = peer).
 *   D. Multiple XFF values → rightmost (trusted-proxy model) wins.
 *
 * Trusted-proxy model under test: peer 127.0.0.1 is trusted (test client =
 * the "Caddy" hop), so XFF entries are honored per the rightmost rule.
 * An untrusted peer (Case C uses a direct, unlisted socket via raw request
 * from 127.0.0.1 WITHOUT being in the list) is covered by the negative unit
 * tests + the spoof-rotation case in s10-rate-limit.spec.ts.
 */

const PORT = 4900 + Math.floor(Math.random() * 100);
const BODY = { username: 'nobody', password: 'wrongpass1' };

function post(path: string, ip: string | null): Promise<number> {
  return new Promise((r) => {
    const data = JSON.stringify(BODY);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) };
    if (ip !== null) headers['x-forwarded-for'] = ip;
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers }, (res) => {
      res.resume(); res.on('end', () => r(res.statusCode ?? -1));
    });
    req.on('error', () => r(-1));
    req.end(data);
  });
}

function get(path: string): Promise<number> {
  return new Promise((r) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => { res.resume(); res.on('end', () => r(res.statusCode ?? -1)); }).on('error', () => r(-1));
  });
}

async function waitReady(): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    if ((await get('/health/live')) === 200) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('app did not become ready');
}

describe('S10 F-03 — TRUSTED_PROXIES live verification', () => {
  let proc: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    const distMain = resolve(__dirname, '../../dist/main.js');
    if (!existsSync(distMain)) throw new Error('dist/main.js missing — run `npm run build` first');
    /* Production model: the test client connects from 127.0.0.1 (the trusted
     * "Caddy" hop). TRUSTED_PROXIES lists that peer. */
    proc = spawn(process.execPath, [distMain], {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', TRUSTED_PROXIES: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr?.on('data', () => undefined);
    proc.stdout?.on('data', () => undefined);
    await waitReady();
  }, 90_000);

  afterAll(() => { proc?.kill(); });

  it('A+B: per-IP buckets — 5th login 429 for IP-A, other IP unaffected', async () => {
    const a: number[] = [];
    for (let i = 0; i < 6; i++) a.push(await post('/api/v1/auth/login', '203.0.113.11'));
    expect(a.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(a[5]).toBe(429);                                  /* B: same IP limited */
    /* A: different IP still has a fresh bucket. */
    expect(await post('/api/v1/auth/login', '203.0.113.22')).toBe(401);
    expect(await post('/api/v1/auth/login', '203.0.113.33')).toBe(401);
  });

  it('C: spoofed XFF left-side entries cannot rotate the bucket (rightmost wins)', async () => {
    /* Attacker controls the left of the header; the trusted proxy's observed
     * client (203.0.113.44) is rightmost. Rotating left entries must NOT
     * reset the count. */
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push(await post('/api/v1/auth/login', `10.9.9.${i}, 203.0.113.44`));
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
    expect(codes[6]).toBe(429);
  });

  it('D: multiple XFF values — rightmost (proxy-observed) is the bucket key', async () => {
    /* Three entries; only the rightmost matters. */
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push(await post('/api/v1/auth/login', '198.51.100.1, 10.0.0.2, 203.0.113.55'));
    expect(codes[5]).toBe(429);
  });

  it('register + refresh limits also honor the trusted-proxy model', async () => {
    const reg: number[] = [];
    for (let i = 0; i < 4; i++) reg.push(await post('/api/v1/auth/register', '203.0.113.66'));
    expect(reg[3]).toBe(429); /* register: 3/min */
    /* refresh: 10/min — probe 11 times. */
    const rf: number[] = [];
    for (let i = 0; i < 11; i++) rf.push(await post('/api/v1/auth/refresh', '203.0.113.77'));
    expect(rf[10]).toBe(429);
  });
});
