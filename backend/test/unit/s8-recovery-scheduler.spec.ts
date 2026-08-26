import { describe, it, expect } from 'vitest';
import { RecoveryScheduler, RecoverySweep } from '@infrastructure/outbox/recovery.scheduler';
import { ScopedSystemWorkerContext } from '@core/auth/db-context.service';

const BRANCH_A = 'a1b2c3d4-0000-4000-8000-0000000000a1';
const BRANCH_B = 'a1b2c3d4-0000-4000-8000-0000000000b2';

/* The scheduler resolves its trusted org scope from env (single-tenant). */
process.env.MEDINI_ORG_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

function fakeDeps(branchIds: string[] = [BRANCH_A, BRANCH_B]) {
  const reconciled: ScopedSystemWorkerContext[] = [];
  const dbCtx = {
    runAsWorker: async (ctx: ScopedSystemWorkerContext, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => ({ rows: branchIds.map((id) => ({ id })) }),
      }),
  };
  const queues = { workerConnection: null };
  const outboxRecovery = {
    reconcile: async (ctx: ScopedSystemWorkerContext) => { reconciled.push(ctx); return 0; },
  };
  return { dbCtx, queues, outboxRecovery, reconciled };
}

describe('F-03/F-04/F-08 — RecoveryScheduler fan-out', () => {
  it('tick() enumerates branches and runs outbox recovery + domain sweeps per branch', async () => {
    const { dbCtx, queues, outboxRecovery, reconciled } = fakeDeps();
    const scheduler = new RecoveryScheduler(dbCtx as never, queues as never, outboxRecovery as never);

    const seen: Array<{ name: string; branchId: string }> = [];
    const sweeps: RecoverySweep[] = [
      { name: 'whatsapp-reconcile-queued', run: async (ctx) => { seen.push({ name: 'whatsapp', branchId: ctx.branchIds[0]! }); } },
      { name: 'recall-schedule-due', run: async (ctx) => { seen.push({ name: 'recall', branchId: ctx.branchIds[0]! }); } },
      { name: 'bukku-reconcile-pending', run: async (ctx) => { seen.push({ name: 'bukku', branchId: ctx.branchIds[0]! }); } },
    ];

    await scheduler.tick(sweeps);

    /* Outbox recovery ran once per branch, always with a single-branch scope. */
    expect(reconciled).toHaveLength(2);
    expect(reconciled.every((c) => c.branchIds.length === 1)).toBe(true);

    /* Every domain sweep ran once per branch. */
    expect(seen).toHaveLength(6);
    for (const name of ['whatsapp', 'recall', 'bukku']) {
      const branches = seen.filter((s) => s.name === name).map((s) => s.branchId).sort();
      expect(branches).toEqual([BRANCH_A, BRANCH_B].sort());
    }
  });

  it('a failing sweep does not stop the remaining sweeps', async () => {
    const { dbCtx, queues, outboxRecovery } = fakeDeps([BRANCH_A]);
    const scheduler = new RecoveryScheduler(dbCtx as never, queues as never, outboxRecovery as never);

    let reached = false;
    await scheduler.tick([
      { name: 'broken', run: async () => { throw new Error('boom'); } },
      { name: 'after', run: async () => { reached = true; } },
    ]);
    expect(reached).toBe(true);
  });

  it('overlapping ticks are skipped (no double sweep)', async () => {
    const { dbCtx, queues, outboxRecovery } = fakeDeps([BRANCH_A]);
    const scheduler = new RecoveryScheduler(dbCtx as never, queues as never, outboxRecovery as never);

    let resolveSlow!: () => void;
    const slow = new Promise<void>((r) => { resolveSlow = r; });
    let runs = 0;
    const first = scheduler.tick([{ name: 'slow', run: async () => { runs += 1; await slow; } }]);
    const second = scheduler.tick([{ name: 'slow', run: async () => { runs += 1; } }]);
    resolveSlow();
    await Promise.all([first, second]);
    expect(runs).toBe(1);
  });
});
