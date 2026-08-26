import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueRegistry } from '../queue/queue.registry';
import { OutboxWorker } from './outbox.worker';
import { ScopedOutboxEvent } from './outbox.types';
import { RecoveryScheduler } from './recovery.scheduler';

/**
 * Domain-events runtime worker. Two job kinds flow through this queue:
 *  - 'recovery-tick' → the F-03/F-04/F-08 recovery trigger; runs the sweep
 *  - anything else   → a scoped outbox event; marked processed via OutboxWorker
 */
@Injectable()
export class OutboxRuntime implements OnModuleInit, OnApplicationShutdown {
  private worker: Worker | null = null;
  constructor(
    private readonly queues: QueueRegistry,
    private readonly outbox: OutboxWorker,
    private readonly recovery: RecoveryScheduler,
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection;
    if (!connection) return;
    this.worker = new Worker('domain-events', async (job: Job) => {
      if (job.name === 'recovery-tick') {
        await this.recovery.tick();
        return;
      }
      await this.outbox.process(job.data as ScopedOutboxEvent, async () => undefined);
    }, { connection, concurrency: 1 });
  }

  async onApplicationShutdown(): Promise<void> { await this.worker?.close(); }
}
