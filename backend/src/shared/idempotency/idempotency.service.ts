import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  IdempotencyPort, IdempotencyRecord, DEFAULT_IDEMPOTENCY_TTL_SECONDS,
} from './idempotency.port';

/** In-memory idempotency adapter — Sprint 0 + tests. */
@Injectable()
export class InMemoryIdempotencyAdapter extends IdempotencyPort {
  private readonly store = new Map<string, IdempotencyRecord>();
  private k(key: string, scope: string): string {
    return `${scope}:${key}`;
  }
  get<T>(key: string, scope: string): IdempotencyRecord<T> | undefined {
    const rec = this.store.get(this.k(key, scope));
    if (rec && new Date(rec.expiresAt).getTime() < Date.now()) {
      this.store.delete(this.k(key, scope));
      return undefined;
    }
    return rec as IdempotencyRecord<T> | undefined;
  }
  begin(key: string, scope: string, ttlSeconds: number): 'started' | 'exists' {
    const k = this.k(key, scope);
    if (this.store.has(k)) return 'exists';
    const now = new Date();
    this.store.set(k, {
      key, scope, status: 'in_progress',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    });
    return 'started';
  }
  complete<T>(key: string, scope: string, response: T): void {
    const k = this.k(key, scope);
    const rec = this.store.get(k);
    if (rec) this.store.set(k, { ...rec, status: 'completed', response });
  }
  fail(key: string, scope: string): void {
    const k = this.k(key, scope);
    const rec = this.store.get(k);
    if (rec) this.store.set(k, { ...rec, status: 'failed' });
  }
}

export const IDEMPOTENCY_PORT = 'IDEMPOTENCY_PORT';

export interface IdempotentExecution<T> {
  replayed: boolean;
  inProgress?: boolean;
  result?: T;
}

/**
 * IdempotencyService — duplicate-submission prevention for mutating work.
 * Behavior:
 *  - First call with a key executes `fn` and stores the result.
 *  - A replay with the same key+scope returns the stored result (no re-run).
 *  - A replay while the first is still in progress signals `inProgress`.
 *  - A replay with a DIFFERENT scope is treated as a new operation.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Optional() @Inject(IDEMPOTENCY_PORT) private readonly port?: IdempotencyPort) {}

  async execute<T>(key: string, scope: string, fn: () => Promise<T> | T, ttl = DEFAULT_IDEMPOTENCY_TTL_SECONDS): Promise<IdempotentExecution<T>> {
    if (!this.port) {
      /* no adapter — execute directly (Sprint 0 default before DB) */
      return { replayed: false, result: await fn() };
    }
    const existing = await this.port.get<T>(key, scope);
    if (existing) {
      if (existing.status === 'completed') return { replayed: true, result: existing.response as T };
      if (existing.status === 'in_progress') return { replayed: false, inProgress: true };
      /* failed → fall through and retry */
    }
    const begin = await this.port.begin(key, scope, ttl);
    if (begin === 'exists') {
      const again = await this.port.get<T>(key, scope);
      if (again?.status === 'completed') return { replayed: true, result: again.response as T };
      if (again?.status === 'failed') {
        /* prior attempt failed → allow a clean retry under the same key */
        try {
          const result = await fn();
          await this.port.complete(key, scope, result);
          return { replayed: false, result };
        } catch (err) {
          await this.port.fail(key, scope);
          throw err;
        }
      }
      return { replayed: false, inProgress: true };
    }
    try {
      const result = await fn();
      await this.port.complete(key, scope, result);
      return { replayed: false, result };
    } catch (err) {
      await this.port.fail(key, scope);
      throw err;
    }
  }
}
