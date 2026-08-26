import { Injectable } from '@nestjs/common';
import { eq, and, lt } from 'drizzle-orm';
import { IdempotencyPort, IdempotencyRecord } from '../../shared/idempotency/idempotency.port';
import { Database } from './database';
import { idempotencyKeys } from './schema';

/**
 * Persistent idempotency adapter (PostgreSQL) — duplicate-submission prevention.
 * Swaps the Sprint 0 in-memory adapter without changing the service interface.
 */
@Injectable()
export class DbIdempotencyAdapter extends IdempotencyPort {
  constructor(private readonly db: Database) {
    super();
  }

  private map(row: typeof idempotencyKeys.$inferSelect): IdempotencyRecord {
    return {
      key: row.key, scope: row.scope, status: row.status,
      response: row.response ?? undefined,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async get<T>(key: string, scope: string): Promise<IdempotencyRecord<T> | undefined> {
    const now = new Date();
    /* purge expired */
    await this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now));
    const rows = await this.db.select().from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope)))
      .limit(1);
    const row = rows[0];
    return row ? (this.map(row) as IdempotencyRecord<T>) : undefined;
  }

  async begin(key: string, scope: string, ttlSeconds: number): Promise<'started' | 'exists'> {
    const existing = await this.get(key, scope);
    if (existing) return 'exists';
    const expires = new Date(Date.now() + ttlSeconds * 1000);
    await this.db.insert(idempotencyKeys).values({ key, scope, status: 'in_progress', expiresAt: expires })
      .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] });
    const after = await this.get(key, scope);
    /* if a concurrent insert won, we don't own it */
    return after && after.status === 'in_progress' ? 'started' : 'exists';
  }

  async complete<T>(key: string, scope: string, response: T): Promise<void> {
    await this.db.update(idempotencyKeys)
      .set({ status: 'completed', response: response as never })
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope)));
  }

  async fail(key: string, scope: string): Promise<void> {
    await this.db.update(idempotencyKeys)
      .set({ status: 'failed' })
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope)));
  }
}
