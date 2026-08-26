import { describe, it, expect } from 'vitest';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { MetricsService } from '@infrastructure/observability/metrics.service';
import { HttpMetricsInterceptor } from '@infrastructure/observability/http-metrics.interceptor';
import { InfraGauges } from '@infrastructure/observability/infra-gauges';
import { sql } from 'drizzle-orm';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[s9-observability] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

describe('S9 observability — metrics registry + instrumentation', () => {
  it('MetricsService renders Prometheus text with expected series after observations', async () => {
    const svc = new MetricsService();
    svc.httpRequests.inc({ method: 'GET', route: '/api/v1/reports/kpis', status: '200' });
    svc.httpDuration.observe({ method: 'GET', route: '/api/v1/reports/kpis', status: '200' }, 0.042);
    svc.workerJobs.inc({ queue: 'whatsapp-send', status: 'completed' });
    svc.outboxBacklog.set(3);

    const text = await svc.render();
    expect(text).toContain('http_requests_total{method="GET",route="/api/v1/reports/kpis",status="200"');
    expect(text).toContain('http_request_duration_seconds_bucket');
    expect(text).toContain('worker_jobs_total{queue="whatsapp-send",status="completed"');
    expect(text).toMatch(/outbox_unpublished_events\{[^}]*\} 3/);
    /* default process metrics present */
    expect(text).toContain('process_cpu_');
  });

  it('interceptor observes request with bounded constant labels', async () => {
    const svc = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(svc);
    const { of } = await import('rxjs');

    const fakeReq = {
      method: 'GET', url: '/api/v1/reports/kpis?period=7D',
      route: { path: '/api/v1/reports/kpis' },
      res: { statusCode: 200 },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => fakeReq }),
    } as never;

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(ctx, { handle: () => of('ok') }).subscribe({
        next: () => undefined, error: reject, complete: () => resolve(),
      });
    });

    const text = await svc.render();
    expect(text).toContain('route="/api/v1/reports/kpis"');
    /* query string must NOT leak into the label (cardinality discipline) */
    expect(text).not.toContain('period=7D');
  });

  it('label cardinality is bounded: only method/route/status/queue/state label names', async () => {
    const svc = new MetricsService();
    for (const [m, r, s] of [['GET', '/a', '200'], ['POST', '/b', '201'], ['GET', '/c', '403']] as const) {
      svc.httpRequests.inc({ method: m, route: r, status: s });
    }
    const text = await svc.render();
    /* no id-ish labels anywhere in our custom series */
    const custom = text.split('\n').filter((l) =>
      l.startsWith('http_requests_total') || l.startsWith('worker_jobs_total'));
    for (const line of custom) {
      expect(line).not.toMatch(/org|branch|patient|staff|doctor|uuid|id=/i);
    }
  });
});

describe('S9 observability — infra gauges (live PG)', () => {
  dbIt('outbox backlog gauge reflects unpublished domain_events count', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const svc = new MetricsService();
    /* autoStart=false: no setInterval in the vitest worker (flake fix) */
    const gauges = new InfraGauges(admin.db, svc, false);
    await gauges.tick();
    const rows = await admin.db.execute(sql`SELECT count(*)::int AS n FROM domain_events WHERE published_at IS NULL`);
    const expected = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    const text = await svc.render();
    expect(text).toMatch(new RegExp(`outbox_unpublished_events\\{[^}]*\\} ${expected}`));
    gauges.onModuleDestroy();
    await admin.close();
  });
});
