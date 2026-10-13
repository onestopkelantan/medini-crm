import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WaBranchResolverService } from '@modules/whatsapp/application/wa-branch-resolver.service';
import type { DbContextService } from '@core/auth/db-context.service';

/** Minimal transaction surface the resolver stub needs to drive. */
type TxStub = { execute: (query: unknown) => Promise<{ rows: unknown[] }> };

/**
 * FASA 5A-fix — branch routing for the WhatsApp webhook.
 *
 * WHY THIS MATTERS
 *
 * One WhatsApp number per branch. The webhook used to pin every message to a
 * single hard-coded branch UUID, so all fourteen branches shared one identity
 * and a patient of Setia Tropika was answered with another clinic's prompt,
 * prices and staff. The session name WAHA sends with each message is now the
 * routing key.
 *
 * The tests below pin the two properties that make that safe:
 *   1. The session name decides the branch — channel row first, branch row as
 *      fallback.
 *   2. An unknown session resolves to NULL, never to "some branch". Answering as
 *      the wrong clinic is worse than not answering.
 */

/**
 * Flatten a drizzle `sql` template into comparable text.
 *
 * `String(query)` yields "[object Object]" for these objects — the SQL lives in
 * `queryChunks`, with literal fragments as nested arrays and bound parameters
 * interleaved. Without this the stub cannot tell which table a statement targets
 * and every lookup returns the wrong rows.
 */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] } | null)?.queryChunks ?? [];
  return chunks
    .map((c: unknown) => {
      if (Array.isArray(c)) {
        return c
          .map((x: unknown) => (x as { value?: unknown } | null)?.value ?? String(x))
          .join('');
      }
      const v = (c as { value?: unknown } | null)?.value;
      if (v !== undefined) return String(v);
      return String(c);
    })
    .join('');
}

/** Minimal DbContextService stub whose transaction runs the callback directly. */
function makeDb(rows: { channel?: unknown[]; branch?: unknown[] }) {
  return {
    runAsWorker: vi.fn(async (_ctx: unknown, fn: (tx: TxStub) => Promise<unknown>) =>
      fn({
        execute: vi.fn(async (query: unknown) => {
          /* Route by which table the statement mentions. */
          const isChannelJoin = /wa_channels/i.test(sqlText(query));
          return { rows: isChannelJoin ? (rows.channel ?? []) : (rows.branch ?? []) };
        }),
      }),
    ),
  } as unknown as DbContextService;
}

const SETIA = {
  id: 'af0a0841-0786-40b2-9b4e-30ed9270a659',
  org_id: '00000000-0000-0000-0000-000000000001',
  short_name: 'Setia Tropika',
  full_name: 'Klinik Pergigian Medini Setia Tropika',
};

describe('FASA 5A-fix — WA session → branch resolver', () => {
  let svc: WaBranchResolverService;

  beforeEach(() => {
    svc = new WaBranchResolverService(makeDb({ channel: [SETIA] }));
  });

  it('resolves a session to its branch via the channel row', async () => {
    const r = await svc.resolve('medini-setia-tropika');
    expect(r).not.toBeNull();
    expect(r!.branchId).toBe(SETIA.id);
    expect(r!.branchName).toBe('Setia Tropika');
    expect(r!.orgId).toBe(SETIA.org_id);
    expect(r!.source).toBe('channel');
  });

  it('falls back to the branch row when no channel exists yet', async () => {
    const s = new WaBranchResolverService(makeDb({ channel: [], branch: [SETIA] }));
    const r = await s.resolve('medini-setia-tropika');
    expect(r).not.toBeNull();
    expect(r!.branchId).toBe(SETIA.id);
    expect(r!.source).toBe('branch');
  });

  it('returns NULL for an unknown session — never a wrong branch', async () => {
    const s = new WaBranchResolverService(makeDb({ channel: [], branch: [] }));
    const r = await s.resolve('sesi-yang-tidak-wujud');
    /* THE POINT: no fallback to "some branch". Misrouting a patient to another
     * clinic is worse than dropping the message. */
    expect(r).toBeNull();
  });

  it('returns NULL for an empty or missing session', async () => {
    expect(await svc.resolve(null)).toBeNull();
    expect(await svc.resolve(undefined)).toBeNull();
    expect(await svc.resolve('')).toBeNull();
    expect(await svc.resolve('   ')).toBeNull();
  });

  it('caches a hit so the hot path does not re-query per message', async () => {
    const db = makeDb({ channel: [SETIA] });
    const s = new WaBranchResolverService(db);
    await s.resolve('medini-setia-tropika');
    await s.resolve('medini-setia-tropika');
    await s.resolve('medini-setia-tropika');
    /* One transaction for three messages. */
    expect(db.runAsWorker).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces a fresh lookup (operator changed a channel)', async () => {
    const db = makeDb({ channel: [SETIA] });
    const s = new WaBranchResolverService(db);
    await s.resolve('medini-setia-tropika');
    s.invalidate('medini-setia-tropika');
    await s.resolve('medini-setia-tropika');
    expect(db.runAsWorker).toHaveBeenCalledTimes(2);
  });

  it('a DB failure does NOT get cached as "no such branch"', async () => {
    let calls = 0;
    const db = {
      runAsWorker: vi.fn(async (_c: unknown, fn: (tx: TxStub) => Promise<unknown>) => {
        calls += 1;
        if (calls === 1) throw new Error('connection lost');
        return fn({
          execute: vi.fn(async () => ({ rows: [SETIA] })),
        });
      }),
    } as unknown as DbContextService;

    const s = new WaBranchResolverService(db);
    /* First call fails → null, but the failure must not be cached. */
    expect(await s.resolve('medini-setia-tropika')).toBeNull();
    /* The next message must retry and succeed. */
    const r = await s.resolve('medini-setia-tropika');
    expect(r).not.toBeNull();
    expect(r!.branchId).toBe(SETIA.id);
  });

  it('two branches resolve independently — no cross-contamination', async () => {
    const BUKIT = {
      id: '39fef961-bd9d-4ee9-9a6b-eb38ecf819e2',
      org_id: '00000000-0000-0000-0000-000000000001',
      short_name: 'Bukit Indah',
      full_name: 'Klinik Pergigian Medini Bukit Indah',
    };

    const db = {
      runAsWorker: vi.fn(async (_c: unknown, fn: (tx: TxStub) => Promise<unknown>) =>
        fn({
          execute: vi.fn(async (q: unknown) => {
            const t = sqlText(q);
            if (/wa_channels/i.test(t)) {
              /* The session name is a bound parameter, so it appears in the text. */
              return { rows: t.includes('medini-bukit-indah') ? [BUKIT] : [SETIA] };
            }
            return { rows: [] };
          }),
        }),
      ),
    } as unknown as DbContextService;

    const s = new WaBranchResolverService(db);
    const a = await s.resolve('medini-setia-tropika');
    const b = await s.resolve('medini-bukit-indah');

    expect(a!.branchId).not.toBe(b!.branchId);
    expect(a!.branchName).toBe('Setia Tropika');
    expect(b!.branchName).toBe('Bukit Indah');
  });
});
