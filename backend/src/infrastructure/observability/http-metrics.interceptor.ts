import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** S9-T3 — HTTP request metrics. Route label uses the matched NestJS route
 * path pattern (e.g. /api/v1/reports/:x) when available, else the raw url
 * path WITHOUT query string — bounded cardinality by construction. */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const start = process.hrtime.bigint();
    const method = req.method;
    /* route path pattern: NestJS attaches route.path; fall back to url path.
     * /metrics + /health excluded from autolog already; keep metrics cheap. */
    const route: string =
      (req.route as { path?: string } | undefined)?.path ??
      ((req.url ?? '').split('?')[0] ?? '/');

    return next.handle().pipe(
      tap({
        next: () => this.observe(req, method, route, start),
        error: () => this.observe(req, method, route, start),
      }),
    );
  }

  private observe(req: Request, method: string, route: string, start: bigint): void {
    const res = req.res as Response | undefined;
    const status = String(res?.statusCode ?? 500);
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    this.metrics.httpDuration.observe({ method, route, status }, seconds);
    this.metrics.httpRequests.inc({ method, route, status });
  }
}
