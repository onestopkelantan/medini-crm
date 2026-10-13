/**
 * H8ReminderScheduler — E6. The cron that walks the reminder ledger.
 *
 * TWO JOBS, ONE TICK CADENCE (every minute, in-process interval — the
 * project's established pattern from InfraGauges/RecoveryScheduler):
 *
 *   1. QUEUE: find appointments in the next 24h that are booked/confirmed
 *      and have NO pending/sent h8 reminder row yet, and insert one with
 *      scheduled_for = start − 8h (late bookings get now+15m — the domain
 *      policy). Idempotent by the (appointment_id, reminder_type,
 *      pending-or-sent) lookup, so re-running the tick is free.
 *   2. SEND: claim due rows (scheduled_for in the past, oldest first,
 *      capped by the domain's BATCH_LIMIT), send via the sender port,
 *      mark sent/failed. A failed row stays failed — visible, not retried
 *      into spam (one confirmation is the policy; a retry ladder is not).
 *
 * CANCELLED appointments: their pending rows are flipped to cancelled on
 * the same tick, so a patient who cancels in the morning is not pinged
 * about a dead slot in the evening.
 *
 * THE SENDER IS A PORT: mock in dev (no phone needed), WAHA later. The
 * scheduler neither knows nor cares.
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import {
  planReminder, dueWindow, reminderMessage, H8_HOURS_MS,
} from '../domain/h8-reminder';
import { ReminderSenderPort, REMINDER_SENDER } from '../domain/reminder-sender.port';

const TICK_MS = 60_000;

@Injectable()
export class H8ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(H8ReminderScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly dbCtx: DbContextService,
    @Inject(REMINDER_SENDER) private readonly sender: ReminderSenderPort,
  ) {}

  onModuleInit(): void {
    /* Vitest must never be kept alive by this timer (the InfraGauges rule). */
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One scheduler pass: queue for the next day, cancel the dead, send the due. */
  async tick(): Promise<void> {
    /* Never overlap ticks — a slow WhatsApp call must not stack. */
    if (this.running) return;
    this.running = true;
    try {
      await this.queueUpcoming();
      await this.cancelDeadAppointments();
      await this.sendDue();
    } catch (error) {
      this.logger.error(
        `Reminder tick gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** JOB 1 — ensure every soon appointment has its h8 row. */
  private async queueUpcoming(): Promise<void> {
    await this.dbCtx.runAsWorker(
    {
    orgId: '00000000-0000-0000-0000-000000000001',
    branchIds: ['00000000-0000-0000-0000-000000000001'],
    correlationId: 'h8-reminder-queue',
    source: 'system_worker',
    },
      async (tx) => {
        /* appointments stores DATE + TIME columns; combine into one
         * datetime for the window comparison. */
        const found = await tx.execute(sql`
          SELECT a.id, a.status,
                 TIMESTAMP(a.scheduled_date, a.scheduled_time) AS start_at,
                 a.patient_id, a.branch_id, a.org_id
          FROM appointments a
          WHERE a.deleted_at IS NULL
            AND TIMESTAMP(a.scheduled_date, a.scheduled_time) BETWEEN NOW() AND NOW() + INTERVAL 24 HOUR
            AND a.status IN ('booked', 'confirmed')
            AND NOT EXISTS (
              SELECT 1 FROM appointment_reminders r
              WHERE r.appointment_id = a.id AND r.reminder_type = 'h8'
                AND r.status IN ('pending', 'sent')
                AND r.deleted_at IS NULL
            )
          LIMIT 100
        `);
        const rows = (found as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];

        for (const row of rows) {
          const plan = planReminder({
            status: String(row.status),
            start: row.start_at ? new Date(String(row.start_at)).getTime() : null,
          });
          if (plan.kind !== 'schedule') continue;

          await tx.execute(sql`
            INSERT INTO appointment_reminders
              (id, org_id, appointment_id, reminder_type, scheduled_for, status, created_at, updated_at)
            VALUES (
              UUID(), ${String(row.org_id ?? '00000000-0000-0000-0000-000000000001')},
              ${String(row.id)}, 'h8', ${plan.scheduledFor.toISOString().slice(0, 19).replace('T', ' ')},
              'pending', NOW(6), NOW(6)
            )
          `);
        }

        if (rows.length > 0) {
          this.logger.log(`H8: ${rows.length} temujanji baru masuk baris peringatan`);
        }
      },
    );
  }

  /** JOB 2 — a cancelled appointment's pending reminder dies with it. */
  private async cancelDeadAppointments(): Promise<void> {
    await this.dbCtx.runAsWorker(
      {
        orgId: '00000000-0000-0000-0000-000000000001',
        branchIds: ['00000000-0000-0000-0000-000000000001'],
        correlationId: 'h8-reminder-cancel',
        source: 'system_worker',
      },
      async (tx) => {
        await tx.execute(sql`
          UPDATE appointment_reminders r
          JOIN appointments a ON a.id = r.appointment_id
          SET r.status = 'cancelled', r.updated_at = NOW(6)
          WHERE r.status = 'pending' AND r.reminder_type = 'h8'
            AND r.deleted_at IS NULL
            AND (a.status IN ('cancelled', 'no-show') OR a.deleted_at IS NOT NULL)
        `);
      },
    );
  }

  /** JOB 3 — send what is due, mark the ledger. */
  private async sendDue(): Promise<void> {
    await this.dbCtx.runAsWorker(
      {
        orgId: '00000000-0000-0000-0000-000000000001',
        branchIds: ['00000000-0000-0000-0000-000000000001'],
        correlationId: 'h8-reminder-send',
        source: 'system_worker',
      },
      async (tx) => {
        const found = await tx.execute(sql`
          SELECT r.id, r.scheduled_for, r.appointment_id,
                 TIMESTAMP(a.scheduled_date, a.scheduled_time) AS start_at,
                 a.branch_id,
                 p.name AS patient_name, p.phone AS patient_phone,
                 b.full_name AS branch_name
          FROM appointment_reminders r
          JOIN appointments a ON a.id = r.appointment_id AND a.deleted_at IS NULL
          LEFT JOIN patients p ON p.id = a.patient_id AND p.deleted_at IS NULL
          LEFT JOIN branches b ON b.id = a.branch_id
          WHERE r.status = 'pending' AND r.reminder_type = 'h8' AND r.deleted_at IS NULL
          ORDER BY r.scheduled_for ASC
          LIMIT 200
        `);
        const rows = (found as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];

        const due = dueWindow(
          rows.map((r) => ({ id: String(r.id), scheduledFor: new Date(String(r.scheduled_for)) })),
        );
        if (due.length === 0) return;

        const byId = new Map(rows.map((r) => [String(r.id), r]));

        for (const target of due) {
          const row = byId.get(target.id);
          if (!row) continue;

          const phone = String(row.patient_phone ?? '').replace(/[^0-9]/g, '');
          if (!phone) {
            await this.markRow(tx, target.id, 'failed', 'no_phone');
            continue;
          }

          const body = reminderMessage({
            patientName: String(row.patient_name ?? ''),
            clinicName: String(row.branch_name ?? 'Klinik Pergigian Medini'),
            startsAt: new Date(String(row.start_at)),
          });

          try {
            const result = await this.sender.send({
              orgId: '00000000-0000-0000-0000-000000000001',
              branchId: String(row.branch_id ?? ''),
              appointmentId: String(row.appointment_id),
              to: `${phone}@s.whatsapp.net`,
              body,
            });
            await this.markRow(tx, target.id, result.ok ? 'sent' : 'failed', result.ok ? result.ref : result.error);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.markRow(tx, target.id, 'failed', message.slice(0, 500));
          }
        }

        this.logger.log(`H8: ${due.length} peringatan diproses`);
      },
    );
  }

  private async markRow(
    tx: { execute: (q: unknown) => Promise<unknown> },
    id: string,
    status: 'sent' | 'failed',
    note: string | undefined,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_reminders
      SET status = ${status},
          sent_at = ${status === 'sent' ? sql`NOW(6)` : sql`NULL`},
          updated_at = NOW(6)
      WHERE id = ${id}
    `);
    if (note) {
      this.logger.debug(`H8 reminder ${id} → ${status} (${note.slice(0, 80)})`);
    }
  }
}

export { H8_HOURS_MS };
