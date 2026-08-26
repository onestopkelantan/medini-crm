import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Correlation ID context — propagated across request → service → worker → log.
 * Uses AsyncLocalStorage so every log/error carries the same correlationId
 * without threading it through every call signature.
 */
export interface CorrelationStore {
  correlationId: string;
  requestId?: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

const HEADER = 'x-correlation-id';

export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function runWithCorrelation<T>(store: CorrelationStore, fn: () => T): T {
  return correlationStorage.run(store, fn);
}

/**
 * Express middleware that establishes the correlation context for EVERY request
 * (including 404s and errors that never reach a controller). Honors an inbound
 * `x-correlation-id` header, else generates one; echoes it back on the response.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[HEADER];
  const correlationId = (Array.isArray(incoming) ? incoming[0] : incoming) || newCorrelationId();
  res.setHeader(HEADER, correlationId);
  runWithCorrelation({ correlationId }, () => next());
}
