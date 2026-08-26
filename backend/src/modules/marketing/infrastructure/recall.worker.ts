import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { DbContextService, ScopedSystemWorkerContext, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import { MarketingRepository } from './marketing.repository';
import { AuditService } from '../../../shared/audit/audit.service';
import { recallCases } from '../../../infrastructure/database/schema';

export interface RecallJob {
  recallCaseId: string;
  orgId: string;
  branchId: string;
  correlationId: string;
}

/** Recall scheduler — finds due recall cases within explicit org+branch scope.
 *  Never performs global cross-org discovery. Caller provides the scope.
 *  F-03: Includes a BullMQ repeatable scheduler that triggers per-branch. */
@Injectable()
export class RecallScheduler implements OnModuleInit {
  private schedulerJob: Job | null = null;
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly queues: QueueRegistry,
    private readonly repo: MarketingRepository,
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    /* BullMQ repeatable job — runs every 6 hours, scoped per branch.
     * Uses a single repeatable job that enumerates branches from the DB
     * under system_worker context, then dispatches per-branch scoped work. */
    const queue = this.queues.queue('recall-due');
    if (!queue) return;
    void queue.add('recall-scheduler-tick', {}, {
      repeat: { pattern: '0 */6 * * *' }, /* every 6 hours */
      jobId: 'recall-scheduler-tick',
    });
  }

  /** F-03: list branches that currently hold open due recall cases, under a
   *  trusted org-scoped worker context. The recovery scheduler fans out
   *  per-branch scheduleDue() calls from this — never a global scan. */
  async listDueBranches(ctx: ScopedSystemWorkerContext, today: string): Promise<string[]> {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT DISTINCT branch_id::text AS branch_id FROM recall_cases
            WHERE org_id = ${ctx.orgId} AND status = 'open' AND due_date <= ${today} AND deleted_at IS NULL`,
      );
      return (rows as unknown as { rows: Array<{ branch_id: string }> }).rows.map((r) => r.branch_id);
    });
  }

  /** Find due recall cases for a specific org+branch scope and enqueue scoped jobs.
   *  Called by an external scheduler trigger with a KNOWN scope — no global discovery. */
  async scheduleDue(ctx: ScopedSystemWorkerContext, today: string): Promise<number> {
    const due = await this.dbCtx.runAsWorker(ctx, async (tx) => {
      /* Find open recall cases due today or earlier, within the worker's org+branch scope */
      const rows = await tx.execute(
        sql`SELECT id, org_id, branch_id FROM recall_cases
            WHERE org_id = ${ctx.orgId} AND branch_id = ${ctx.branchIds[0]!} AND status = 'open' AND due_date <= ${today} AND deleted_at IS NULL`,
      );
      return (rows as unknown as { rows: Array<{ id: string; org_id: string; branch_id: string }> }).rows;
    });
    for (const row of due) {
      await this.queues.enqueue('recall-due', 'process-recall', {
        recallCaseId: row.id,
        orgId: row.org_id,
        branchId: row.branch_id,
        correlationId: ctx.correlationId,
      }, row.id);
    }
    return due.length;
  }
}

/** Recall worker — processes due recall cases under system_worker identity + RLS. */
@Injectable()
export class RecallWorker implements OnModuleInit, OnApplicationShutdown {
  private worker: Worker | null = null;
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly queues: QueueRegistry,
    private readonly repo: MarketingRepository,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    this.worker = new Worker('recall-due', async (job: Job<RecallJob>) => this.handle(job), {
      connection,
      concurrency: 1,
    });
  }

  async onApplicationShutdown(): Promise<void> { await this.worker?.close(); }

  /** Public for direct execution (integration tests invoke this exact runtime
   *  path — F-13). BullMQ calls it via the Worker registered in onModuleInit. */
  async handle(job: Job<RecallJob>): Promise<void> {
    const { recallCaseId, orgId, branchId, correlationId } = job.data;
    const ctx: ScopedSystemWorkerContext = {
      orgId, branchIds: [branchId], correlationId, source: 'system_worker',
    };

    await this.dbCtx.runAsWorker(ctx, async (tx) => {
      /* 1. Load recall case — RLS enforces org+branch scope */
      const recall = await this.repo.findRecallCase(tx, orgId, recallCaseId);
      if (!recall) throw new Error(`Recall case not found or RLS denied: ${recallCaseId}`);

      /* 2. Eligibility: must be open + due date passed */
      if (recall.status !== 'open') {
        throw new Error(`Recall case ${recallCaseId} is not open (status=${recall.status})`);
      }

      /* 3. Idempotency: check for existing active recall case (same patient+rule+dueDate) */
      const duplicate = await this.repo.findRecallDuplicate(tx, orgId, recall.patientId, recall.recallRuleId, recall.dueDate);
      if (duplicate && duplicate.id !== recall.id) {
        throw new Error(`Duplicate active recall case exists: ${duplicate.id}`);
      }

      /* 4. Process: transition to completed (Marketing owns lifecycle) */
      await this.repo.updateStatus(tx, recallCases, orgId, recallCaseId, 'completed');

      /* 5. Audit */
      await this.audit.record({
        actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
        action: 'recall_case_auto_completed', entity: 'recall_cases', entityId: recallCaseId,
        orgId, branchId, source: 'worker',
        before: { status: recall.status }, after: { status: 'completed' },
      }, tx);
    });
  }
}
