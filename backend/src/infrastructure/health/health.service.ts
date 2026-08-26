import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pingDatabase } from '../database/database';
import { QueueRegistry } from '../queue/queue.registry';

export interface DependencyStatus {
  configured: boolean;
  status: 'ok' | 'degraded' | 'not_configured' | 'pending_sprint';
  note?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready' | 'degraded';
  timestamp: string;
  version: string;
  dependencies: Record<string, DependencyStatus>;
}

/**
 * HealthService — honest dependency readiness.
 * Sprint 1: PostgreSQL is pinged for real when configured (never faked ok).
 * Redis/BullMQ arrives in the queue phase — still reported as pending.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly queues: QueueRegistry,
  ) {}

  liveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: this.config.get<string>('app.apiVersion') ?? 'v1',
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const dbUrl = this.config.get<string>('database.url') ?? '';
    const redisConfigured = Boolean(this.config.get<string>('redis.url'));

    /* PostgreSQL — real probe when configured. Honest status. */
    let postgres: DependencyStatus;
    if (!dbUrl) {
      postgres = { configured: false, status: 'not_configured', note: 'DATABASE_URL not set.' };
    } else {
      const ok = await pingDatabase(dbUrl);
      postgres = ok
        ? { configured: true, status: 'ok', note: 'PostgreSQL reachable.' }
        : { configured: true, status: 'degraded', note: 'PostgreSQL configured but UNREACHABLE.' };
    }

    /* Tier 1 (P7-F7): Redis is pinged for real when configured (never faked).
     * The app reports 'degraded' overall if a CONFIGURED dependency is
     * unreachable — honest readiness (BullMQ depends on Redis). */
    let redis: DependencyStatus;
    if (!redisConfigured) {
      redis = { configured: false, status: 'not_configured', note: 'REDIS_URL not set.' };
    } else {
      const ok = await this.queues.ping();
      redis = ok
        ? { configured: true, status: 'ok', note: 'Redis reachable.' }
        : { configured: true, status: 'degraded', note: 'Redis configured but UNREACHABLE.' };
    }

    const dependencies = { postgres, redis };
    /* ready only if all configured deps ok; degraded if any configured-but-unreachable */
    const anyDegraded = postgres.status === 'degraded' || redis.status === 'degraded';
    const status: ReadinessReport['status'] =
      postgres.status === 'ok' && !anyDegraded ? 'ready'
      : postgres.status === 'degraded' ? 'degraded'
      : anyDegraded ? 'degraded'
      : 'not_ready';

    return {
      status,
      timestamp: new Date().toISOString(),
      version: this.config.get<string>('app.apiVersion') ?? 'v1',
      dependencies,
    };
  }
}
