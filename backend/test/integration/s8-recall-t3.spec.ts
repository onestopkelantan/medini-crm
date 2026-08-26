import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService, ScopedSystemWorkerContext } from '@core/auth/db-context.service';
import { MarketingRepository } from '@modules/marketing/infrastructure/marketing.repository';
import { RecallScheduler, RecallWorker } from '@modules/marketing/infrastructure/recall.worker';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ORG_A = '80d1f1a1-0000-4000-8000-0000000000a4';
const ORG_B = '80d1f1a1-0000-4000-8000-0000000000b4';

const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

type FreshDb = ReturnType<typeof createFreshDatabase>['db'];

async function seed(admin: FreshDb) {
  const branchRow = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const branches = (branchRow as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  const b1 = branches[0]!;
  const b2 = branches[1]!;
  /* Separate patients per recall case — unique constraint is (org, patient, dueDate) */
  const p1 = await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${ORG_A}, ${b1}, 'MDN-T3A1', 'T3 P1') RETURNING id::text AS id`);
  const patientId1 = (p1 as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  const p2 = await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${ORG_A}, ${b2}, 'MDN-T3A2', 'T3 P2') RETURNING id::text AS id`);
  const patientId2 = (p2 as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  const p3 = await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${ORG_B}, ${b1}, 'MDN-T3B1', 'T3 P3') RETURNING id::text AS id`);
  const patientId3 = (p3 as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  await admin.execute(sql`INSERT INTO recall_cases (org_id, branch_id, patient_id, due_date, status) VALUES
    (${ORG_A}, ${b1}, ${patientId1}, '2026-08-17', 'open'),
    (${ORG_A}, ${b2}, ${patientId2}, '2026-08-17', 'open'),
    (${ORG_B}, ${b1}, ${patientId3}, '2026-08-17', 'open')`);
  const rc = await admin.execute(sql`SELECT id::text AS id FROM recall_cases WHERE org_id = ${ORG_A} AND branch_id = ${b1} LIMIT 1`);
  const recallCaseId = (rc as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  return { b1, b2, patientId1, recallCaseId };
}

async function purge(admin: FreshDb) {
  await admin.execute(sql`DELETE FROM recall_cases WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM patients WHERE org_id IN (${ORG_A}, ${ORG_B}) AND mrn LIKE 'MDN-T3%'`);
}

function workerCtx(orgId: string, branchId: string): ScopedSystemWorkerContext {
  return { orgId, branchIds: [branchId], correlationId: `t3-${randomUUID()}`, source: 'system_worker' };
}

function build(db: FreshDb) {
  const dbCtx = new DbContextService(db);
  const repo = new MarketingRepository();
  const audit = new AuditService(new InMemoryAuditAdapter());
  const queues = { enqueue: async () => undefined } as never;
  return { dbCtx, repo, audit, scheduler: new RecallScheduler(dbCtx, queues, repo), worker: new RecallWorker(dbCtx, queues, repo, audit) };
}

describe('T3 — Recall Worker (live PG)', () => {
  dbIt('worker processes due recall → completed; audit recorded', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, recallCaseId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const { dbCtx, repo, worker } = build(db);
    const ctx = workerCtx(ORG_A, b1);

    /* F-13: execute the ACTUAL RecallWorker.handle() runtime — no logic
     * is re-implemented in this spec. */
    await worker.handle({
      data: { recallCaseId, orgId: ORG_A, branchId: b1, correlationId: ctx.correlationId },
      attemptsMade: 0,
    } as never);

    const updated = await dbCtx.runAsWorker(ctx, (tx) => repo.findRecallCase(tx, ORG_A, recallCaseId));
    expect(updated!.status).toBe('completed');

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-org worker DENIED: Org B cannot see Org A recall', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, recallCaseId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const { dbCtx, repo } = build(db);
    const ctxB = workerCtx(ORG_B, b1);

    const found = await dbCtx.runAsWorker(ctxB, (tx) => repo.findRecallCase(tx, ORG_A, recallCaseId));
    expect(found).toBeNull(); /* RLS blocks cross-org read */

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-branch worker DENIED: Org A/b2 cannot see Org A/b1 recall', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b2, recallCaseId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const { dbCtx, repo } = build(db);
    const ctxWrong = workerCtx(ORG_A, b2);

    const found = await dbCtx.runAsWorker(ctxWrong, (tx) => repo.findRecallCase(tx, ORG_A, recallCaseId));
    expect(found).toBeNull(); /* RLS blocks cross-branch read */

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('scheduler finds due recall and enqueues scoped job', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1 } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const repo = new MarketingRepository();
    const enqueued: Array<Record<string, unknown>> = [];
    const queues = { enqueue: async (_q: string, _n: string, data: Record<string, unknown>) => { enqueued.push(data); } } as never;
    const scheduler = new RecallScheduler(dbCtx, queues, repo);

    const count = await scheduler.scheduleDue(workerCtx(ORG_A, b1), '2026-08-17');
    expect(count).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.recallCaseId).toBeTruthy();
    expect(enqueued[0]!.orgId).toBe(ORG_A);
    expect(enqueued[0]!.branchId).toBe(b1);

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('idempotency: duplicate scheduler run does not duplicate', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1 } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const repo = new MarketingRepository();
    const enqueued: Array<Record<string, unknown>> = [];
    const queues = { enqueue: async (_q: string, _n: string, data: Record<string, unknown>) => { enqueued.push(data); } } as never;
    const scheduler = new RecallScheduler(dbCtx, queues, repo);

    const count1 = await scheduler.scheduleDue(workerCtx(ORG_A, b1), '2026-08-17');
    const count2 = await scheduler.scheduleDue(workerCtx(ORG_A, b1), '2026-08-17');
    expect(count1).toBe(1);
    expect(count2).toBe(1); /* same case found again — but BullMQ jobId = recallCaseId prevents duplicate queue entry */
    expect(enqueued).toHaveLength(2); /* both calls enqueue, but BullMQ dedupes by jobId */

    await close(); await purge(admin.db); await admin.close();
  });
});
