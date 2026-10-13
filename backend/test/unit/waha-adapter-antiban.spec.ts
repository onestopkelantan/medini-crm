import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { WahaAdapter } from '@modules/whatsapp/infrastructure/waha.adapter';

/**
 * A1 wiring test — proves the ADAPTER (not just the pure guard) refuses to
 * restart a session when it must.
 *
 * The pure decision is covered by waha-session-guard.spec.ts. What this spec
 * adds is that `fetchQr` actually consults it and never fires the POST when the
 * brake says no — the exact 13-restart QR loop that preceded the ban.
 *
 * `global.fetch` is stubbed so the test is deterministic and never touches a
 * live WAHA.
 */

const okStatus = (status: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ status }),
  arrayBuffer: async () => new ArrayBuffer(0),
  headers: { get: () => 'image/png' },
  text: async () => '',
}) as unknown as Response;

const okQr = () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  headers: { get: () => 'image/png' },
  text: async () => '',
}) as unknown as Response;

describe('A1 wiring — fetchQr never restarts a dead session', () => {
  let restartCalls = 0;

  beforeEach(() => {
    delete process.env.WAHA_BASE_URL;
    delete process.env.WAHA_API_KEY;
    restartCalls = 0;
    process.env.WAHA_BASE_URL = 'http://waha.test';
    process.env.WAHA_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.WAHA_BASE_URL;
    delete process.env.WAHA_API_KEY;
  });

  it('refuses to restart a FAILED session and never calls /restart', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/restart')) { restartCalls++; return okStatus('starting'); }
      if (u.includes('/auth/qr')) return okQr();
      return okStatus('failed'); // session status
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new WahaAdapter();
    await expect(adapter.fetchQr('medini-test')).rejects.toThrow(/SESSION_FAILED/);
    expect(restartCalls).toBe(0);
  });

  it('restarts once, then blocks the second restart inside the window', async () => {
    /* First call: status reported STOPPED once, then SCAN_QR_CODE so waitForQr
     * returns immediately. Second call: STOPPED again — must be blocked. */
    const statusQueue: string[] = ['stopped', 'scan_qr_code', 'stopped'];
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/restart')) { restartCalls++; return okStatus('starting'); }
      if (u.includes('/auth/qr')) return okQr();
      return okStatus(statusQueue.shift() ?? 'scan_qr_code');
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new WahaAdapter();

    const first = await adapter.fetchQr('medini-test');
    expect(first.qr.startsWith('data:image/png')).toBe(true);
    expect(restartCalls).toBe(1);

    await expect(adapter.fetchQr('medini-test')).rejects.toThrow(/RESTART_LIMIT_REACHED/);
    expect(restartCalls).toBe(1);
  });
});
