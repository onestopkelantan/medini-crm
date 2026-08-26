import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import { Database } from '../database/database';
import { MetricsService } from './metrics.service';

/** S9-T3 — periodic infrastructure gauges (outbox backlog + pool state).
 * In-process interval (RecoveryScheduler fallback pattern, KISS). Interval
 * is conservative; probes are cheap single-count queries. */
@Injectable()
export class InfraGauges implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private static readonly INTERVAL_MS = 30_000;
  /** Test seam: when false, onModuleInit does NOT start the interval —
   * the vitest worker process must never be kept alive by a probe timer. */
  private readonly autoStart: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database | null,
    private readonly metrics: MetricsService,
    autoStart = true,
  ) {
    this.autoStart = autoStart;
  }

  onModuleInit(): void {
    if (!this.db || !this.autoStart) return;
    /* run once at boot, then on interval */
    void this.tick();
    this.timer = setInterval(() => void this.tick(), InfraGauges.INTERVAL_MS);
    this.timer.unref(); /* never keep the process alive for metrics */
  }

  /** Public for direct execution (tests) — mirrors the Worker.handle() seam. */
  async tick(): Promise<void> {
    if (!this.db) return;
    try {
      const rows = await this.db.execute(
        sql`SELECT count(*)::int AS n FROM domain_events WHERE published_at IS NULL`,
      );
      const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0;
      this.metrics.outboxBacklog.set(n);
    } catch {
      /* probe failure must never crash the app — gauge just goes stale */
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
