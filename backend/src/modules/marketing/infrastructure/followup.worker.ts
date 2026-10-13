import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { QueueRegistry } from '../../../infrastructure/queue/queue.registry';
import { DbContextService, ScopedSystemWorkerContext, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import { MarketingRepository } from './marketing.repository';
import { AuditService } from '../../../shared/audit/audit.service';
import { followUpCases, patients, waChannels } from '../../../infrastructure/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface FollowUpJob {
  followUpCaseId: string;
  orgId: string;
  branchId: string;
  correlationId: string;
}

/** Follow-up scheduler — finds due follow-up cases within explicit org+branch scope. */
@Injectable()
export class FollowUpScheduler implements OnModuleInit {
  private schedulerJob: Job | null = null;
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly queues: QueueRegistry,
    private readonly repo: MarketingRepository,
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    const queue = this.queues.queue('followup-due');
    if (!queue) return;
    void queue.add('followup-scheduler-tick', {}, {
      repeat: { pattern: '0 */6 * * *' }, /* every 6 hours */
      jobId: 'followup-scheduler-tick',
    });
  }

  async listDueBranches(ctx: ScopedSystemWorkerContext, today: string): Promise<string[]> {
    return this.dbCtx.runAsWorker(ctx, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT DISTINCT branch_id AS branch_id FROM follow_up_cases
            WHERE org_id = ${ctx.orgId} AND status = 'open' AND due_date <= ${today} AND deleted_at IS NULL`,
      );
      return (rows as unknown as { rows: Array<{ branch_id: string }> }).rows.map((r) => r.branch_id);
    });
  }

  async scheduleDue(ctx: ScopedSystemWorkerContext, today: string): Promise<number> {
    const due = await this.dbCtx.runAsWorker(ctx, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT id, org_id, branch_id FROM follow_up_cases
            WHERE org_id = ${ctx.orgId} AND branch_id = ${ctx.branchIds[0]!} AND status = 'open' AND due_date <= ${today} AND deleted_at IS NULL`,
      );
      return (rows as unknown as { rows: Array<{ id: string; org_id: string; branch_id: string }> }).rows;
    });
    for (const row of due) {
      await this.queues.enqueue('followup-due', 'process-followup', {
        followUpCaseId: row.id,
        orgId: row.org_id,
        branchId: row.branch_id,
        correlationId: ctx.correlationId,
      }, row.id);
    }
    return due.length;
  }
}

/** Follow-up worker — processes due follow-up cases under system_worker identity + RLS. */
@Injectable()
export class FollowUpWorker implements OnModuleInit, OnApplicationShutdown {
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
    this.worker = new Worker('followup-due', async (job: Job<FollowUpJob>) => this.handle(job), {
      connection,
      concurrency: 1,
    });
  }

  async onApplicationShutdown(): Promise<void> { await this.worker?.close(); }

  async handle(job: Job<FollowUpJob>): Promise<void> {
    const { followUpCaseId, orgId, branchId, correlationId } = job.data;
    const ctx: ScopedSystemWorkerContext = {
      orgId, branchIds: [branchId], correlationId, source: 'system_worker',
    };

    await this.dbCtx.runAsWorker(ctx, async (tx) => {
      /* 1. Load follow-up case */
      const followUp = await this.repo.findFollowUp(tx, orgId, followUpCaseId);
      if (!followUp) throw new Error(`Follow-up case not found: ${followUpCaseId}`);
      if (followUp.status !== 'open') throw new Error(`Follow-up case ${followUpCaseId} is not open (status=${followUp.status})`);

      /* 2. Load patient */
      const patientRows = await tx.select({
        id: patients.id,
        name: patients.name,
        phone: patients.phone,
        whatsapp: patients.whatsapp,
      }).from(patients).where(
        and(
          eq(patients.orgId, orgId),
          eq(patients.id, followUp.patientId),
          isNull(patients.deletedAt),
        ),
      ).limit(1);
      const patient = patientRows[0];
      if (!patient) throw new Error(`Patient not found: ${followUp.patientId}`);

      const contactPhone = (patient.whatsapp || patient.phone || '').trim();
      if (!contactPhone) {
        await this.repo.updateStatus(tx, followUpCases, orgId, followUpCaseId, 'completed');
        await this.audit.record({
          actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
          action: 'followup_case_no_contact', entity: 'follow_up_cases', entityId: followUpCaseId,
          orgId, branchId, source: 'worker',
          before: { status: followUp.status }, after: { status: 'completed' },
        }, tx);
        return;
      }

      /* 3. Load treatment name from encounter if available */
      let treatmentName = 'rawatan';
      if (followUp.encounterId) {
        const encRows = await tx.execute(sql`
          SELECT tc.name AS treatment_name
          FROM encounters e
          LEFT JOIN treatment_plans tp ON tp.id = e.plan_id
          LEFT JOIN treatment_plan_items tpi ON tpi.plan_id = tp.id
          LEFT JOIN treatment_catalog tc ON tc.id = tpi.treatment_id
          WHERE e.id = ${followUp.encounterId} AND e.org_id = ${orgId}
          ORDER BY tpi.created_at DESC
          LIMIT 1
        `);
        const enc = (encRows as unknown as { rows: Array<{ treatment_name: string | null }> }).rows[0];
        if (enc?.treatment_name) treatmentName = enc.treatment_name;
      }

      /* 4. Find working WhatsApp channel */
      const channelRows = await tx.select({
        id: waChannels.id,
        status: waChannels.status,
      }).from(waChannels).where(
        and(
          eq(waChannels.orgId, orgId),
          eq(waChannels.branchId, branchId),
          eq(waChannels.status, 'working'),
          isNull(waChannels.deletedAt),
        ),
      ).limit(1);
      const channel = channelRows[0];
      if (!channel) throw new Error(`No working WhatsApp channel for branch ${branchId}`);

      /* 5. Create conversation + queue message */
      const convId = randomUUID();
      await tx.execute(sql`
        INSERT INTO wa_conversations
          (id, org_id, branch_id, channel_id, contact_phone, patient_id, status, unread_count, needs_human, created_at, updated_at)
        VALUES
          (${convId}, ${orgId}, ${branchId}, ${channel.id}, ${contactPhone}, ${patient.id}, 'new', 0, false, NOW(6), NOW(6))
      `);

      const msgId = randomUUID();
      const body = `Hi ${patient.name}, salam dari Klinik Medini. Bagaimana perasaan anda selepas ${treatmentName}? Balas jika ada sebarang masalah atau ketidakselesaan.`;
      await tx.execute(sql`
        INSERT INTO wa_messages
          (id, org_id, branch_id, conversation_id, direction, sender_type, body, status, send_at, created_at, updated_at)
        VALUES
          (${msgId}, ${orgId}, ${branchId}, ${convId}, 'out', 'system', ${body}, 'queued', NOW(6), NOW(6), NOW(6))
      `);

      await this.queues.enqueue('whatsapp-send', 'send-message', {
        messageId: msgId,
        orgId,
        branchId,
        channelId: channel.id,
        conversationId: convId,
        correlationId,
      }, msgId);

      /* 6. Mark as contacted */
      await this.repo.updateStatus(tx, followUpCases, orgId, followUpCaseId, 'contacted');

      /* 7. Audit */
      await this.audit.record({
        actorId: SYSTEM_WORKER_PRINCIPAL.staffId, actorRole: 'system_worker',
        action: 'followup_case_whatsapp_sent', entity: 'follow_up_cases', entityId: followUpCaseId,
        orgId, branchId, source: 'worker',
        before: { status: followUp.status }, after: { status: 'contacted' },
      }, tx);
    });
  }
}
