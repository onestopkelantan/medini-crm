import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/** S9-T3 — central Prometheus registry. Label discipline (R6): constant,
 * low-cardinality label sets ONLY — never org/branch/patient/staff IDs. */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();

  readonly httpDuration: Histogram<string>;
  readonly httpRequests: Counter<string>;
  readonly workerJobs: Counter<string>;
  readonly workerDuration: Histogram<string>;
  readonly outboxBacklog: Gauge<string>;
  readonly dbPool: Gauge<string>;

  constructor() {
    this.registry.setDefaultLabels({ service: 'medini-crm-backend' });
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
    this.workerJobs = new Counter({
      name: 'worker_jobs_total',
      help: 'BullMQ jobs by queue and terminal state',
      labelNames: ['queue', 'status'],
      registers: [this.registry],
    });
    this.workerDuration = new Histogram({
      name: 'worker_job_duration_seconds',
      help: 'BullMQ job duration (finishedOn - processedOn)',
      labelNames: ['queue'],
      buckets: [0.05, 0.25, 1, 5, 15, 60],
      registers: [this.registry],
    });
    this.outboxBacklog = new Gauge({
      name: 'outbox_unpublished_events',
      help: 'Domain events awaiting dispatch',
      registers: [this.registry],
    });
    this.dbPool = new Gauge({
      name: 'db_pool_clients',
      help: 'pg pool client counts',
      labelNames: ['state'],
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  onModuleDestroy(): void {
    /* nothing stateful — gauges/listeners live in their own providers */
  }
}
