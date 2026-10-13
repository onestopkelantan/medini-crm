import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { QueueRegistry, QUEUE_NAMES } from '../queue/queue.registry';
import { MetricsService } from './metrics.service';

/** S9-T3 — worker/queue metrics via BullMQ QueueEvents listeners.
 *
 * CRITICAL (AD-3): S8 worker code is NOT touched. QueueEvents subscribes to
 * the Redis event stream emitted by BullMQ itself — a read-side observation
 * point. If Redis is absent (local/test), listeners simply never start. */
@Injectable()
export class QueueEventsListener implements OnModuleInit, OnModuleDestroy {
  private listeners: QueueEvents[] = [];

  constructor(
    private readonly registry: QueueRegistry,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const conn = this.registry.workerConnection;
    if (!conn) return; /* no Redis → no listeners (honest no-op) */
    for (const name of QUEUE_NAMES) {
      const qe = new QueueEvents(name, { connection: conn.duplicate() });
      qe.on('completed', () => {
        this.metrics.workerJobs.inc({ queue: name, status: 'completed' });
      });
      qe.on('failed', () => {
        this.metrics.workerJobs.inc({ queue: name, status: 'failed' });
      });
      this.listeners.push(qe);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.listeners.map((l) => l.close().catch(() => undefined)));
  }
}
