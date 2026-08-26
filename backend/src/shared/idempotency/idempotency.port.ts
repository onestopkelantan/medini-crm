/**
 * Idempotency abstraction. Mutating endpoints accept an Idempotency-Key; the
 * first result is replayed on duplicate submission. The persistent (DB/Redis)
 * adapter is implemented in the DB sprint — Sprint 0 defines the contract.
 */

export type IdempotencyStatus = 'in_progress' | 'completed' | 'failed';

export interface IdempotencyRecord<T = unknown> {
  readonly key: string;
  readonly scope: string; /* e.g. route+actor — prevents cross-user replay */
  readonly status: IdempotencyStatus;
  readonly response?: T;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export abstract class IdempotencyPort {
  abstract get<T>(key: string, scope: string): Promise<IdempotencyRecord<T> | undefined> | IdempotencyRecord<T> | undefined;
  abstract begin(key: string, scope: string, ttlSeconds: number): Promise<'started' | 'exists'> | 'started' | 'exists';
  abstract complete<T>(key: string, scope: string, response: T): Promise<void> | void;
  abstract fail(key: string, scope: string): Promise<void> | void;
}

export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; /* 24h */
