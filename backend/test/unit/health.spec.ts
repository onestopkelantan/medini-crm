import { describe, it, expect } from 'vitest';
import { HealthService } from '@infrastructure/health/health.service';

function configWith(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] } as never;
}

function queuesWith(pingResult: boolean) {
  return { ping: async () => pingResult } as never;
}

describe('health foundation (honest readiness)', () => {
  it('liveness reports the process is alive', () => {
    const svc = new HealthService(
      configWith({ 'app.apiVersion': 'v1' }),
      queuesWith(false),
    );

    const live = svc.liveness();

    expect(live.status).toBe('alive');
    expect(typeof live.uptime).toBe('number');
  });

  it('readiness reports not_configured when database / Redis are not configured', async () => {
    const svc = new HealthService(
      configWith({
        'database.runtimeUrl': '',
        'redis.url': '',
        'app.apiVersion': 'v1',
      }),
      queuesWith(false),
    );

    const ready = await svc.readiness();

    expect(ready.status).toBe('not_ready');
    expect(ready.dependencies.mysql?.status).toBe('not_configured');
    expect(ready.dependencies.redis?.status).toBe('not_configured');
  });

  it('readiness does not fake a healthy MySQL database', async () => {
    const svc = new HealthService(
      configWith({
        'database.runtimeUrl': 'mysql://test:test@127.0.0.1:59999/nope',
        'redis.url': '',
        'app.apiVersion': 'v1',
      }),
      queuesWith(false),
    );

    const ready = await svc.readiness();

    expect(['degraded', 'not_ready']).toContain(ready.status);
    expect(ready.dependencies.mysql?.status).toBe('degraded');
    expect(ready.dependencies.mysql?.configured).toBe(true);
  }, 15000);

  it('readiness reports Redis ok only when ping succeeds', async () => {
    const svc = new HealthService(
      configWith({
        'database.runtimeUrl': 'mysql://test:test@127.0.0.1:59999/nope',
        'redis.url': 'redis://localhost:6379',
        'app.apiVersion': 'v1',
      }),
      queuesWith(true),
    );

    const ready = await svc.readiness();

    expect(ready.dependencies.redis?.status).toBe('ok');
  });

  it('readiness degrades when configured Redis is unreachable', async () => {
    const svc = new HealthService(
      configWith({
        'database.runtimeUrl': 'mysql://test:test@127.0.0.1:59999/nope',
        'redis.url': 'redis://localhost:59998',
        'app.apiVersion': 'v1',
      }),
      queuesWith(false),
    );

    const ready = await svc.readiness();

    expect(ready.dependencies.redis?.status).toBe('degraded');
    expect(ready.dependencies.redis?.configured).toBe(true);
    expect(['degraded', 'not_ready']).toContain(ready.status);
  });
});
