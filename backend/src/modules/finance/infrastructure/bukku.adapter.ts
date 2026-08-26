import { Injectable } from '@nestjs/common';
import { AccountingPort, AccountingSyncRequest, AccountingSyncResult } from '../../../shared/ports/accounting.port';

/** Typed Bukku transport error carrying a retry classification. */
export class BukkuError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); this.name = 'BukkuError'; }
}

/**
 * BukkuAdapter — real HTTP adapter behind AccountingPort.
 * Finance domain depends on AccountingPort; this adapter owns Bukku-specific transport.
 * No Bukku HTTP details leak into Finance business logic.
 */
@Injectable()
export class BukkuAdapter extends AccountingPort {
  private get baseUrl(): string { return (process.env.BUKKU_BASE_URL ?? 'https://api.bukku.my').replace(/\/$/, ''); }
  private get apiKey(): string { return process.env.BUKKU_API_KEY ?? ''; }
  private get company(): string { return process.env.BUKKU_COMPANY_SUBDOMAIN ?? ''; }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.company);
  }

  private classify(status: number): boolean {
    if (status === 429) return true;
    if (status >= 500) return true;
    return false;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'Company-Subdomain': this.company,
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.isConfigured()) throw new BukkuError('Bukku adapter is not configured (missing API key or company)', false);
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...init.headers }, signal: ctl.signal });
    } catch (e) {
      throw new BukkuError(`Bukku transport error: ${(e as Error).message}`, true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new BukkuError(`Bukku ${path} failed: ${response.status}`, this.classify(response.status));
    }
    return response;
  }

  async push(req: AccountingSyncRequest): Promise<AccountingSyncResult> {
    /* Map entityType to Bukku endpoint */
    const path = this.endpointFor(req.entityType);
    if (!path) {
      return { ok: false, status: 'error', error: `Unsupported entity type: ${req.entityType}` };
    }

    try {
      const response = await this.request(path, {
        method: 'POST',
        body: JSON.stringify(this.mapPayload(req)),
      });
      const body = await response.json() as Record<string, unknown>;
      const externalId = body.id ? String(body.id) : body.number ? String(body.number) : null;
      if (!externalId) throw new BukkuError('Bukku returned no id/number', false);
      return { ok: true, status: 'synced', externalId };
    } catch (e) {
      if (e instanceof BukkuError) {
        return { ok: false, status: 'error', error: e.message };
      }
      return { ok: false, status: 'error', error: (e as Error).message };
    }
  }

  async pull(cursor?: string): Promise<{ records: Array<Record<string, unknown>>; nextCursor?: string }> {
    /* Polling pull — invoices for now (read-only reconciliation) */
    try {
      const path = cursor ? `/sales/invoices?updated_after=${encodeURIComponent(cursor)}` : '/sales/invoices';
      const response = await this.request(path);
      const body = await response.json() as Record<string, unknown>;
      const records = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
      const paging = body.paging as Record<string, unknown> | undefined;
      const nextCursor = paging?.next_cursor ? String(paging.next_cursor) : undefined;
      return { records, nextCursor };
    } catch {
      return { records: [] };
    }
  }

  private endpointFor(entityType: string): string | null {
    switch (entityType) {
      case 'invoice': return '/sales/invoices';
      case 'payment': return '/sales/payments';
      case 'bill': return '/purchases/bills';
      default: return null;
    }
  }

  private mapPayload(req: AccountingSyncRequest): Record<string, unknown> {
    /* Finance domain → Bukku payload mapping. Minimal for now; extend per entity. */
    return {
      idempotency_key: req.idempotencyKey,
      ...req.payload,
    };
  }
}
