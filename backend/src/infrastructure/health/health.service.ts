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
 * HealthService - honest dependency readiness.
 * MySQL is pinged for real when configured (never faked ok).
 * Redis is also probed through QueueRegistry.
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
    const dbUrl = this.config.get<string>('database.runtimeUrl') ?? '';
    const redisConfigured = Boolean(this.config.get<string>('redis.url'));

    /* MySQL - real probe using the same runtime connection as the application. */
    let mysql: DependencyStatus;

    if (!dbUrl) {
      mysql = {
        configured: false,
        status: 'not_configured',
        note: 'DATABASE_RUNTIME_URL / DATABASE_URL not set.',
      };
    } else {
      const ok = await pingDatabase(dbUrl);

      mysql = ok
        ? {
            configured: true,
            status: 'ok',
            note: 'MySQL reachable.',
          }
        : {
            configured: true,
            status: 'degraded',
            note: 'MySQL configured but UNREACHABLE.',
          };
    }

    /* Redis is pinged for real when configured. */
    let redis: DependencyStatus;

    if (!redisConfigured) {
      redis = {
        configured: false,
        status: 'not_configured',
        note: 'REDIS_URL not set.',
      };
    } else {
      const ok = await this.queues.ping();

      redis = ok
        ? {
            configured: true,
            status: 'ok',
            note: 'Redis reachable.',
          }
        : {
            configured: true,
            status: 'degraded',
            note: 'Redis configured but UNREACHABLE.',
          };
    }

    const dependencies = { mysql, redis };

    const anyDegraded =
      mysql.status === 'degraded' ||
      redis.status === 'degraded';

    const status: ReadinessReport['status'] =
      mysql.status === 'ok' && !anyDegraded
        ? 'ready'
        : mysql.status === 'degraded'
          ? 'degraded'
          : anyDegraded
            ? 'degraded'
            : 'not_ready';

    return {
      status,
      timestamp: new Date().toISOString(),
      version: this.config.get<string>('app.apiVersion') ?? 'v1',
      dependencies,
    };
  }
}
