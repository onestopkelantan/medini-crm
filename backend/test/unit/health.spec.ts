import { describe, it, expect } from 'vitest';
import { HealthService } from '@infrastructure/health/health.service';

function configWith(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] } as never;
}

/* QueueRegistry stub — mirrors the real ping() contract without a live Redis. */
function queuesWith(pingResult: boolean) {
  return { ping: async () => pingResult } as never;
}

describe('health foundation (honest readiness)', () => {
  it('liveness reports the process is alive', () => {
    const svc = new HealthService(configWith({ 'app.apiVersion': 'v1' }), queuesWith(false));
    const live = svc.liveness();
    expect(live.status).toBe('alive');
    expect(typeof live.uptime).toBe('number');
  });

  it('readiness reports not_configured when no DATABASE_URL / REDIS_URL', async () => {
    const svc = new HealthService(
      configWith({ 'database.url': '', 'redis.url': '', 'app.apiVersion': 'v1' }),
      queuesWith(false),
    );
    const ready = await svc.readiness();
    expect(ready.status).toBe('not_ready');
    expect(ready.dependencies.postgres?.status).toBe('not_configured');
    /* Tier 1 (P7-F7): unconfigured Redis is now honestly 'not_configured',
     * not the old 'pending_sprint' placeholder. */
    expect(ready.dependencies.redis?.status).toBe('not_configured');
  });

  it('readiness does NOT fake a healthy DB — reports degraded when unreachable', async () => {
    /* point at a port nothing listens on → ping fails → degraded, never 'ok' */
    const svc = new HealthService(
      configWith({
        'database.url': 'postgres://localhost:59999/nope',
        'redis.url': '', 'app.apiVersion': 'v1',
      }),
      queuesWith(false),
    );
    const ready = await svc.readiness();
    expect(['degraded', 'not_ready']).toContain(ready.status);
    expect(ready.dependencies.postgres?.status).toBe('degraded');
    expect(ready.dependencies.postgres?.configured).toBe(true);
  }, 15000);

  it('readiness reports Redis ok only when the real ping succeeds', async () => {
    const svc = new HealthService(
      configWith({
        'database.url': 'postgres://localhost:59999/nope',
        'redis.url': 'redis://localhost:6379', 'app.apiVersion': 'v1',
      }),
      queuesWith(true), /* stubbed reachable */
    );
    const ready = await svc.readiness();
    expect(ready.dependencies.redis?.status).toBe('ok');
  });

  it('readiness degrades when a configured Redis is unreachable (P7-F7)', async () => {
    const svc = new HealthService(
      configWith({
        'database.url': 'postgres://localhost:59999/nope',
        'redis.url': 'redis://localhost:59998', 'app.apiVersion': 'v1',
      }),
      queuesWith(false), /* stubbed unreachable */
    );
    const ready = await svc.readiness();
    expect(ready.dependencies.redis?.status).toBe('degraded');
    expect(ready.dependencies.redis?.configured).toBe(true);
    expect(['degraded', 'not_ready']).toContain(ready.status);
  });
});
