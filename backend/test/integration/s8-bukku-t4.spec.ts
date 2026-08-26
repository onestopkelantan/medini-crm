import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService, ScopedSystemWorkerContext } from '@core/auth/db-context.service';
import { FinanceIntegrationRepository } from '@modules/finance/infrastructure/finance-integration.repository';
import { BukkuAdapter } from '@modules/finance/infrastructure/bukku.adapter';
import { BukkuWorker } from '@modules/finance/infrastructure/bukku.worker';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ORG_A = '80d1f1a1-0000-4000-8000-0000000000a5';
const ORG_B = '80d1f1a1-0000-4000-8000-0000000000b5';

const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

type FreshDb = ReturnType<typeof createFreshDatabase>['db'];

async function seed(admin: FreshDb) {
  const branchRow = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
  const b1 = (branchRow as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  /* N8-4: seed the actual source document (sale_record) the worker must load
   * to build the real Bukku payload. */
  const saleId = randomUUID();
  await admin.execute(sql`INSERT INTO sale_records (id, org_id, branch_id, sale_code, amount, sale_date, notes)
    VALUES (${saleId}, ${ORG_A}, ${b1}, 'SALE-T4-001', 250.0000, '2026-08-17', 'Scaling + polishing')`);
  await admin.execute(sql`INSERT INTO bukku_sync_records (org_id, entity_type, entity_id, branch_id, sync_status, idempotency_key)
    VALUES (${ORG_A}, 'invoice', ${saleId}, ${b1}, 'queued', ${'t4-' + randomUUID()})`);
  const rc = await admin.execute(sql`SELECT id::text AS id FROM bukku_sync_records WHERE org_id = ${ORG_A} LIMIT 1`);
  const syncId = (rc as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  return { b1, syncId, saleId };
}

async function purge(admin: FreshDb) {
  await admin.execute(sql`DELETE FROM bukku_sync_records WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM sale_records WHERE org_id IN (${ORG_A}, ${ORG_B})`);
}

function workerCtx(orgId: string, branchId: string): ScopedSystemWorkerContext {
  return { orgId, branchIds: [branchId], correlationId: `t4-${randomUUID()}`, source: 'system_worker' };
}

function build(db: FreshDb, accounting?: BukkuAdapter) {
  const dbCtx = new DbContextService(db);
  const repo = new FinanceIntegrationRepository();
  const audit = new AuditService(new InMemoryAuditAdapter());
  return { dbCtx, repo, audit, accounting: accounting ?? new BukkuAdapter() };
}

describe('T4 — Bukku adapter + worker (live PG)', () => {
  dbIt('adapter: isConfigured false without env; error classification correct', async () => {
    const adapter = new BukkuAdapter();
    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.push({ entityType: 'invoice', entityId: 'x', idempotencyKey: 'k', payload: {}, version: 1 }))
      .resolves.toMatchObject({ ok: false, status: 'error' });
  });

  dbIt('worker: sync record processed under RLS scope', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, syncId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const { dbCtx, repo } = build(db);
    const ctx = workerCtx(ORG_A, b1);

    const found = await dbCtx.runAsWorker(ctx, async (tx) => {
      const all = await repo.listSync(tx, ORG_A, { limit: 500 });
      return all.find((r) => r.id === syncId) ?? null;
    });
    expect(found).not.toBeNull();
    expect(found!.syncStatus).toBe('queued');

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('worker.handle(): actual runtime pushes REAL payload via adapter and marks synced', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, syncId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const { dbCtx, repo, audit } = build(db);
    const ctx = workerCtx(ORG_A, b1);

    /* F-13/N8-4: execute the ACTUAL BukkuWorker.handle() runtime with a
     * stubbed AccountingPort that captures the exact push request. */
    let captured: { entityType?: string; payload?: Record<string, unknown> } = {};
    const stubAccounting = {
      push: async (req: { entityType: string; payload: Record<string, unknown> }) => {
        captured = req;
        return { ok: true, status: 'synced', externalId: 'bk-ext-001' };
      },
    };
    const worker = new BukkuWorker(dbCtx, { workerConnection: null } as never, repo, stubAccounting as never, audit);
    await worker.handle({
      data: { syncId, orgId: ORG_A, branchId: b1, correlationId: ctx.correlationId },
      attemptsMade: 0,
    } as never);

    /* N8-4: the payload must be the real accounting document — never {}. */
    expect(captured.entityType).toBe('invoice');
    expect(captured.payload).toMatchObject({
      reference: 'SALE-T4-001',
      amount: '250.0000',
      currency: 'MYR',
      customer: 'Walk-in',
      description: 'Scaling + polishing',
      source_system: 'pos',
    });
    expect(String(captured.payload!.date)).toContain('2026-08-17');
    expect(Object.keys(captured.payload!).length).toBeGreaterThan(0);

    const updated = await dbCtx.runAsWorker(ctx, async (tx) => {
      const all = await repo.listSync(tx, ORG_A, { limit: 500 });
      return all.find((r) => r.id === syncId) ?? null;
    });
    expect(updated!.syncStatus).toBe('synced');
    expect(updated!.bukkuId).toBe('bk-ext-001');

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-org worker DENIED: Org B cannot see Org A sync record', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, syncId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const { dbCtx, repo } = build(db);
    const ctxB = workerCtx(ORG_B, b1);

    const found = await dbCtx.runAsWorker(ctxB, async (tx) => {
      const all = await repo.listSync(tx, ORG_A, { limit: 500 });
      return all.find((r) => r.id === syncId) ?? null;
    });
    expect(found).toBeNull(); /* RLS blocks cross-org read */

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('idempotency: same idempotencyKey cannot be inserted twice', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    await seed(admin.db);
    const key = `t4-idem-${randomUUID()}`;
    await admin.db.execute(sql`INSERT INTO bukku_sync_records (org_id, entity_type, entity_id, sync_status, idempotency_key)
      VALUES (${ORG_A}, 'invoice', ${randomUUID()}, 'queued', ${key})`);
    let threw = false;
    try {
      await admin.db.execute(sql`INSERT INTO bukku_sync_records (org_id, entity_type, entity_id, sync_status, idempotency_key)
        VALUES (${ORG_A}, 'invoice', ${randomUUID()}, 'queued', ${key})`);
    } catch { threw = true; }
    expect(threw).toBe(true);

    await purge(admin.db); await admin.close();
  });
});
