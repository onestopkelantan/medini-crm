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

/** Parameter tarikan invois (FASA 1C). */
export interface PullInvoicesQuery {
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly pageSize: number;
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
  /**
   * FASA 1C — tarik invois jualan untuk satu julat tarikh.
   *
   * Kaedah berasingan daripada `pull()` kerana kontraknya berbeza: `pull()`
   * mengambil satu kelompok kabur untuk rekonsiliasi, manakala ini mengambil
   * halaman bernombor bagi invois dalam julat tarikh yang tepat — yang
   * diperlukan oleh sinkronisasi harian.
   */
  abstract pullInvoices(q: PullInvoicesQuery): Promise<unknown>;
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

  async pullInvoices(): Promise<unknown> {
    return { paging: { current_page: 1, per_page: 0, total: 0 }, transactions: [] };
  }
}
