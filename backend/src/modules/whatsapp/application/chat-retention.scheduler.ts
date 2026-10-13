/**
 * Chat history retention — boss directive 8 Okt, point 2:
 * "chat history pastikan ada 1–2 bulan."
 *
 * Interpretation: keep 60 days of conversation transcript, then prune.
 * WHAT is pruned (wa_messages rows older than the window) vs WHAT is
 * NEVER pruned (patients, appointments, bookings — business records
 * that outlive any chat).
 *
 * Conversations themselves are kept (they carry needs_human state);
 * only their MESSAGE rows age out, and a pruned conversation shows an
 * honest "older messages cleaned" instead of silently emptying.
 *
 * Pattern: the project's in-process interval (InfraGauges / H8Reminder
 * scheduler), daily tick, bounded batch.
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';

/** 60 days — the boss's "1–2 bulan" upper bound. */
export const CHAT_RETENTION_DAYS = 60;
const TICK_MS = 24 * 60 * 60 * 1000; /* daily */

@Injectable()
export class ChatRetentionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRetentionScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly dbCtx: DbContextService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    /* run once at boot so a long-down box still prunes */
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for direct execution (tests / manual run). */
  async tick(): Promise<void> {
    try {
      const result = await this.dbCtx.runAsWorker(
        {
          orgId: '00000000-0000-0000-0000-000000000001',
          branchIds: ['00000000-0000-0000-0000-000000000001'],
          correlationId: 'chat-retention',
          source: 'system_worker',
        },
        async (tx) => {
          /* 1. Prune message rows past the window. Bounded batch — a
           * huge backlog (first run after weeks) must not lock tables
           * in one statement. */
          const deleted = await tx.execute(sql`
            DELETE FROM wa_messages
            WHERE created_at < NOW() - INTERVAL ${CHAT_RETENTION_DAYS} DAY
            LIMIT 5000
          `);

          /* 2. Conversations whose LAST message is now gone flip to
           * 'archived' so the inbox stops showing empty threads. */
          await tx.execute(sql`
            UPDATE wa_conversations c
            LEFT JOIN wa_messages m ON m.conversation_id = c.id
            SET c.status = 'archived', c.updated_at = NOW(6)
            WHERE c.status = 'open' AND m.id IS NULL
              AND c.created_at < NOW() - INTERVAL ${CHAT_RETENTION_DAYS} DAY
          `);

          return deleted;
        },
      );
      const affected = (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
      if (affected > 0) {
        this.logger.log(`Retention: ${affected} mesej > ${CHAT_RETENTION_DAYS} hari dipadam`);
      }
    } catch (error) {
      /* A failed prune must never take the app down — it retries next day. */
      this.logger.error(
        `Retention gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
