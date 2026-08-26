import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { DbContextService, ScopedSystemWorkerContext, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import { FinanceIntegrationRepository } from './finance-integration.repository';
import { AccountingPort } from '../../../shared/ports/accounting.port';
import { AuditService } from '../../../shared/audit/audit.service';

export interface BukkuJob {
  syncId: string;
  orgId: string;
  branchId: string;
  correlationId: string;
}

/** Bukku worker — processes sync records under system_worker identity + RLS.
 *  F-07: HTTP call is OUTSIDE the DB transaction (no long locks during network). */
@Injectable()
export class BukkuWorker implements OnModuleInit, OnApplicationShutdown {
  private worker: Worker | null = null;
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly queues: QueueRegistry,
    private readonly repo: FinanceIntegrationRepository,
    private readonly accounting: AccountingPort,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    this.worker = new Worker('bukku-sync', async (job: Job<BukkuJob>) => this.handle(job), {
      connection,
      concurrency: 1, /* Bukku rate limit safety — sequential per account */
    });
  }

  async onApplicationShutdown(): Promise<void> { await this.worker?.close(); }

  /** Public for direct execution (integration tests invoke this exact runtime
   *  path — F-13). BullMQ calls it via the Worker registered in onModuleInit. */
  async handle(job: Job<BukkuJob>): Promise<void> {
    const { syncId, orgId, branchId, correlationId } = job.data;
    const ctx: ScopedSystemWorkerContext = {
      orgId, branchIds: [branchId], correlationId, source: 'system_worker',
    };

    /* TX 1: Claim the sync record AND load the source finance document under
     * the worker's RLS scope (short transaction, committed before HTTP). */
    const claimed = await this.dbCtx.runAsWorker(ctx, async (tx) => {
      const all = await this.repo.listSync(tx, orgId, { limit: 500 });
      const rec = all.find((r) => r.id === syncId);
      if (!rec) throw new Error(`Bukku sync record not found or RLS denied: ${syncId}`);
      if (rec.syncStatus === 'synced') return null; /* already done — idempotent */
      if (rec.syncStatus === 'error' && (rec.retryCount ?? 0) >= 5) {
        throw new Error(`Bukku sync ${syncId} exceeded max retries`);
      }
      /* Mark syncing — prevents concurrent worker from processing same record */
      await this.repo.updateSyncStatus(tx, syncId, { status: 'syncing' });
      /* N8-4: load the actual source record so the push carries a real
       * accounting payload — never `{}`. */
      const payload = await this.loadSourcePayload(tx, rec);
      return { rec, payload };
    });

    if (!claimed) return; /* already synced */

    /* HTTP: Bukku API call — NO DB transaction held during network call */
    let result: { ok: boolean; externalId?: string; status: string; error?: string };
    try {
      result = await this.accounting.push({
        entityType: claimed.rec.entityType,
        entityId: claimed.rec.entityId,
        idempotencyKey: claimed.rec.idempotencyKey,
        payload: claimed.payload,
        version: claimed.rec.version,
      });
    } catch (e) {
      result = { ok: false, status: 'error', error: (e as Error).message };
    }

    /* TX 2: Confirm success/error — short transaction */
    await this.dbCtx.runAsWorker(ctx, async (tx) => {
      const updated = await this.repo.updateSyncStatus(tx, syncId, {
        status: result.ok ? 'synced' : 'error',
        bukkuId: result.externalId ?? null,
        syncError: result.ok ? null : (result.error ?? 'sync failed'),
      });
      if (!updated) throw new Error(`Bukku sync record update failed: ${syncId}`);

      await this.audit.record({
        actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
        action: result.ok ? 'bukku_sync_pushed' : 'bukku_sync_failed',
        entity: 'bukku_sync_records', entityId: syncId,
        orgId, branchId, source: 'worker',
        before: { status: claimed.rec.syncStatus }, after: { status: updated.syncStatus, error: updated.syncError },
      }, tx);
    });

    /* If retryable error, rethrow so BullMQ retries */
    if (!result.ok && result.error && !result.error.includes('not configured')) {
      const retryable = result.error.includes('429') || result.error.includes('5') || result.error.includes('timeout');
      if (retryable && job.attemptsMade < 5) {
        throw new Error(result.error);
      }
    }
  }

  /** N8-4: build the REAL accounting payload from the source finance document,
   *  loaded under the worker's RLS scope. Never returns `{}` — an unknown or
   *  missing source throws (record → 'error', visible, honest). */
  private async loadSourcePayload(
    tx: Parameters<Parameters<DbContextService['runAsWorker']>[1]>[0],
    rec: { entityType: string; entityId: string; orgId: string },
  ): Promise<Record<string, unknown>> {
    switch (rec.entityType) {
      case 'invoice': {
        /* Medini CRM is an operational tracker (payment STATUS layer), not an
         * accounting engine — the CRM 'invoice' pushed to Bukku is the
         * sale_record (revenue event). Customer identity stays at name level:
         * no phone/IC/contact secrets leave the CRM. */
        const rows = await tx.execute(
          sql`SELECT s.sale_code, s.amount::text AS amount, s.sale_date::text AS sale_date,
                     s.external_ref, s.source_system, s.notes,
                     p.name AS customer_name
              FROM sale_records s
              LEFT JOIN patients p ON p.id = s.patient_id
              WHERE s.id = ${rec.entityId} AND s.org_id = ${rec.orgId} AND s.deleted_at IS NULL`,
        );
        const sale = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
        if (!sale) throw new Error(`Bukku source record not found or RLS denied: sale_records/${rec.entityId}`);
        return {
          reference: sale.sale_code,
          date: sale.sale_date,
          amount: sale.amount,
          currency: 'MYR',
          customer: sale.customer_name ?? 'Walk-in',
          description: sale.notes ?? `Clinic sale ${sale.sale_code}`,
          source_system: sale.source_system,
          external_ref: sale.external_ref ?? null,
        };
      }
      default:
        throw new Error(`Unsupported Bukku sync entity type: ${rec.entityType}`);
    }
  }
}
