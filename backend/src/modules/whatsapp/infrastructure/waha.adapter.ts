import { Injectable } from '@nestjs/common';

export interface WahaQrResult { qr: string; expiresAt: Date | null; }
export interface WahaSendResult { externalMessageId: string | null; }

/** Typed transport error carrying a retry classification. */
export class WahaError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); this.name = 'WahaError'; }
}

/** HTTP-only WAHA boundary. Domain safety, scope and audit remain in WhatsappService. */
@Injectable()
export class WahaAdapter {
  private get baseUrl(): string { return (process.env.WAHA_BASE_URL ?? '').replace(/\/$/, ''); }
  private headers(): Record<string, string> {
    const key = process.env.WAHA_API_KEY ?? '';
    return { 'Content-Type': 'application/json', ...(key ? { 'X-Api-Key': key } : {}) };
  }
  get configured(): boolean { return Boolean(this.baseUrl && process.env.WAHA_API_KEY); }

  private classify(status: number): boolean {
    /* retryable: transient / rate-limited / server-side. non-retryable: client/auth. */
    if (status === 429) return true;
    if (status >= 500) return true;
    return false;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.configured) throw new WahaError('WAHA adapter is not configured', false);
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...init.headers }, signal: ctl.signal });
    } catch (e) {
      /* network / abort(timeout) → retryable */
      throw new WahaError(`WAHA transport error: ${(e as Error).message}`, true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new WahaError(`WAHA ${path} failed: ${response.status}`, this.classify(response.status));
    }
    return response;
  }

  async startSession(session: string): Promise<WahaQrResult> {
    const response = await this.request('/api/sessions/start', { method: 'POST', body: JSON.stringify({ name: session }) });
    const body = await response.json() as Record<string, unknown>;
    return { qr: String(body.qr ?? body.qrCode ?? ''), expiresAt: null };
  }
  async stopSession(session: string): Promise<void> {
    const response = await this.request(`/api/sessions/${encodeURIComponent(session)}/stop`, { method: 'POST' });
    await response.text();
  }
  async sessionStatus(session: string): Promise<string> {
    const response = await this.request(`/api/sessions/${encodeURIComponent(session)}`);
    const body = await response.json() as Record<string, unknown>;
    return String(body.status ?? body.state ?? 'unknown').toLowerCase();
  }
  /** Sends a text message. Throws WahaError (retryable flag) on failure. */
  async sendText(session: string, chatId: string, text: string): Promise<WahaSendResult> {
    const response = await this.request('/api/sendText', { method: 'POST', body: JSON.stringify({ session, chatId, text }) });
    const body = await response.json() as Record<string, unknown>;
    const externalMessageId = body.id ? String(body.id) : body.messageId ? String(body.messageId) : null;
    if (!externalMessageId) throw new WahaError('WAHA sendText returned no message id', false);
    return { externalMessageId };
  }
  async health(): Promise<boolean> {
    if (!this.configured) return false;
    try { return (await this.request('/api/sessions')).ok; } catch { return false; }
  }
}
