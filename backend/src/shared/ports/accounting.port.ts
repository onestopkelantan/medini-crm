/**
 * AccountingPort — integration boundary for the external accounting system
 * (Bukku). Sprint 4 S4-T4 establishes the CONTRACT ONLY. The real HTTP adapter
 * (polling-primary, Option C Hybrid) is Sprint 8 scope.
 *
 * The Finance module depends on this port; a real adapter implements it later.
 * No fake production API calls. No hardcoded fake responses.
 */

export interface AccountingSyncRequest {
  readonly entityType: string;
  readonly entityId: string;
  readonly idempotencyKey: string;
  readonly payload: Record<string, unknown>;
  readonly version: number;
}

export interface AccountingSyncResult {
  readonly ok: boolean;
  readonly externalId?: string;
  readonly status: 'synced' | 'error' | 'conflict';
  readonly error?: string;
}

/**
 * Port contract. The default S4 implementation is a no-credentials boundary
 * that reports "adapter unavailable / not configured" — an HONEST state, never
 * a fabricated success.
 */
export abstract class AccountingPort {
  /** True when real credentials + adapter are configured (Sprint 8). */
  abstract isConfigured(): boolean;
  /** Push a CRM finance record to the accounting system. */
  abstract push(req: AccountingSyncRequest): Promise<AccountingSyncResult>;
  /** Pull accounting records for reconciliation (read-only). */
  abstract pull(cursor?: string): Promise<{ records: Array<Record<string, unknown>>; nextCursor?: string }>;
}

/**
 * UnconfiguredAccountingAdapter — the S4 boundary default. It NEVER pretends a
 * real sync occurred; every call returns an explicit unavailable state so the
 * frontend can render "real adapter not configured" honestly.
 */
export class UnconfiguredAccountingAdapter extends AccountingPort {
  isConfigured(): boolean {
    return false;
  }

  async push(_req: AccountingSyncRequest): Promise<AccountingSyncResult> {
    return {
      ok: false,
      status: 'error',
      error: 'Bukku real adapter unavailable / not configured (Sprint 8 scope)',
    };
  }

  async pull(): Promise<{ records: Array<Record<string, unknown>>; nextCursor?: string }> {
    return { records: [] };
  }
}
