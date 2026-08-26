import { Injectable, OnApplicationShutdown, OnModuleInit, Optional, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { QueueRegistry } from '../queue/queue.registry';
import { DbContextService, ScopedSystemWorkerContext } from '../../core/auth/db-context.service';
import { ScopedOutboxRecovery } from './outbox.recovery';

/** One scoped recovery unit of work, supplied by a domain module. */
export interface RecoverySweep {
  readonly name: string;
  run(ctx: ScopedSystemWorkerContext): Promise<unknown>;
}

/** Token domain modules use to contribute scoped recovery sweeps. */
export const RECOVERY_SWEEP = 'RECOVERY_SWEEP';

/** Recovery trigger sources — also injectable as the 'RECOVERY_TICK' token. */
export const RECOVERY_TICK = 'RECOVERY_TICK';

/**
 * F-03 / F-04 / F-08 — central recovery scheduler.
 *
 * This is the PRODUCTION CALLER that answers: "if Redis died after the DB
 * commit, who finds the stranded work again?" A BullMQ repeatable job
 * ('recovery-tick', hourly by default) fans out a per-branch scoped sweep:
 *
 *   recovery-tick (repeatable)
 *     → enumerate org branches (trusted org scope)
 *     → per branch: ScopedOutboxRecovery.reconcile()      (F-08)
 *     → per branch: WhatsappService.reconcileQueuedMessages() (F-04)
 *     → per branch: WhatsappService.autoResumeExpiredChannels() (N6-3)
 *     → per branch: RecallScheduler.scheduleDue()          (F-03)
 *     → per branch: FinanceIntegrationService.reconcilePendingSyncs() (F-08/Bukku)
 *
 * The sweeps are contributed by domain modules via the RECOVERY_TICK token
 * (multi-provider), keeping this core scheduler free of domain imports.
 * Every unit of work runs under an explicit org+branch system_worker scope —
 * there is no cross-org discovery anywhere in this path.
 */
@Injectable()
export class RecoveryScheduler implements OnModuleInit, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly dbCtx: DbContextService,
    private readonly queues: QueueRegistry,
    private readonly outboxRecovery: ScopedOutboxRecovery,
    @Optional() @Inject(RECOVERY_SWEEP) private readonly sweeps: RecoverySweep[] = [],
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    const queue = this.queues.queue('domain-events');
    if (!queue) return;
    const everyMinutes = Number(process.env.RECOVERY_SWEEP_INTERVAL_MINUTES ?? 60);
    void queue.add('recovery-tick', {}, {
      repeat: { every: Math.max(everyMinutes, 1) * 60_000 },
      jobId: 'recovery-tick',
    });
    /* Fallback trigger: if Redis itself was down (the exact failure mode this
     * scheduler recovers from), the repeatable job may be missing when Redis
     * returns. An in-process interval guarantees the sweep still runs. */
    this.timer = setInterval(() => { void this.tick(); }, Math.max(everyMinutes, 1) * 60_000);
    this.timer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  /** Execute one full recovery sweep. Safe to call concurrently — overlaps
   *  are skipped; every unit of work is individually idempotent. */
  async tick(extraSweeps: readonly RecoverySweep[] = []): Promise<void> {
    if (this.running) return;
    this.running = true;
    const correlationId = `recovery-${Date.now()}`;
    const sweeps = [...this.sweeps, ...extraSweeps];
    try {
      const orgCtx: ScopedSystemWorkerContext = {
        orgId: this.resolveOrgId(), branchIds: [], correlationId, source: 'system_worker',
      };
      const branchIds = await this.dbCtx.runAsWorker(orgCtx, async (tx) => {
        const rows = await tx.execute(
          sql`SELECT id::text AS id FROM branches WHERE org_id = ${orgCtx.orgId} AND deleted_at IS NULL ORDER BY code`,
        );
        return (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
      });

      for (const branchId of branchIds) {
        const ctx: ScopedSystemWorkerContext = {
          orgId: orgCtx.orgId, branchIds: [branchId], correlationId, source: 'system_worker',
        };
        /* F-08: outbox recovery is always wired (same module). */
        await this.outboxRecovery.reconcile(ctx).catch(() => undefined);
        /* Domain sweeps (WhatsApp F-04, Recall F-03, Bukku F-08). */
        for (const sweep of sweeps) {
          await sweep.run(ctx).catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private resolveOrgId(): string {
    const orgId = process.env.MEDINI_ORG_ID;
    if (!orgId) throw new Error('MEDINI_ORG_ID is required for the recovery scheduler');
    return orgId;
  }
}
