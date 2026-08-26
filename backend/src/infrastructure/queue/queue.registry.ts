import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const QUEUE_NAMES = [
  'domain-events', 'whatsapp-send', 'bukku-sync', 'ai-jobs', 'notifications', 'reports-refresh', 'recall-due',
] as const;
export type QueueName = typeof QUEUE_NAMES[number];

@Injectable()
export class QueueRegistry implements OnApplicationShutdown {
  private readonly connection: IORedis | null;
  private readonly queues = new Map<QueueName, Queue>();

  constructor() {
    const url = process.env.REDIS_URL;
    this.connection = url ? new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true }) : null;
  }

  get enabled(): boolean { return this.connection !== null; }
  get workerConnection(): IORedis | null { return this.connection; }

  queue(name: QueueName): Queue | null {
    if (!this.connection) return null;
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, defaultJobOptions: {
        attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: false,
      } });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue(name: QueueName, jobName: string, data: Record<string, unknown>, jobId: string): Promise<void> {
    const queue = this.queue(name);
    if (!queue) return; // Local/unit-test mode: outbox remains durable and unpublished.
    await queue.add(jobName, data, { jobId });
  }

  async ping(): Promise<boolean> {
    if (!this.connection) return false;
    try { await this.connection.ping(); return true; } catch { return false; }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection?.quit();
  }
}
