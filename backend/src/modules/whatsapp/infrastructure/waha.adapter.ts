import { Injectable, Logger } from '@nestjs/common';

import {
  decideRestart,
  decideSend,
  RESTART_WINDOW_MS,
  type SendDecision,
  type WahaSessionStatus,
} from '../domain/waha-session-guard';

export interface WahaQrResult { qr: string; expiresAt: Date | null; }
export interface WahaSendResult { externalMessageId: string | null; }

/** Typed transport error carrying a retry classification. */
export class WahaError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); this.name = 'WahaError'; }
}

/**
 * Where WAHA should deliver inbound messages.
 *
 * WAHA calls this URL from INSIDE its own container, so `localhost` would point
 * at WAHA itself. The docker service name is therefore the correct default when
 * both containers share the compose network; `WA_WEBHOOK_URL` overrides it for
 * deployments where WAHA runs elsewhere.
 *
 * An empty result means "not configured" and the caller skips registration
 * rather than registering a URL nothing can reach.
 */
function resolveWebhookUrl(): string | null {
  const explicit = (process.env.WA_WEBHOOK_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const base = (process.env.WA_WEBHOOK_BASE ?? '').trim();
  if (base) return `${base.replace(/\/$/, '')}/api/v1/whatsapp/webhook`;

  /* Default: the backend service on the shared docker network. */
  return 'http://medini-prod-backend-1:3000/api/v1/whatsapp/webhook';
}

/** HTTP-only WAHA boundary. Domain safety, scope and audit remain in WhatsappService. */
@Injectable()
export class WahaAdapter {
  private readonly logger = new Logger(WahaAdapter.name);
  /**
   * A1 — restart history per session (epoch-ms), for the circuit breaker.
   *
   * In-memory on purpose: the disaster this guards against is a BURST of
   * restarts inside one process lifetime (a QR viewer that restarts on every
   * poll), which a Map catches exactly. A restart of the backend clears it,
   * which is acceptable — escalation to a DB-backed counter is deferred until
   * evidence shows a process restart is being used to evade the breaker.
   */
  private readonly restartHistory = new Map<string, number[]>();
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
    /* QR/session-start calls can exceed the default; allow a longer budget. */
    const timeoutMs = /\/auth\/qr|\/sessions/.test(path) ? 15000 : 5000;
    const timeout = setTimeout(() => ctl.abort(), timeoutMs);
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

  async startSession(session: string, opts?: { manualPairing?: boolean }): Promise<WahaQrResult> {
    /* WAHA returns 422 when the session is already started/working — that is
     * not a failure for our purpose: we still want the current QR (or the
     * working status). Only surface the error when the session truly cannot
     * be reached. */
    let qr: WahaQrResult;
    try {
      const response = await this.request('/api/sessions/start', { method: 'POST', body: JSON.stringify({ name: session }) });
      const body = await response.json() as Record<string, unknown>;
      const inline = String(body.qr ?? body.qrCode ?? '');
      qr = inline ? { qr: inline, expiresAt: null } : await this.fetchQr(session, opts);
    } catch (e) {
      if (!(e instanceof WahaError) || !/422/.test(e.message)) throw e;
      qr = await this.fetchQr(session, opts);
    }

    /* Register the inbound webhook AFTER the session exists.
     *
     * ORDER MATTERS: WAHA returns 404 "Session not found" when the session does
     * not exist yet, so registering first silently failed for exactly the case
     * that needs it most — a brand-new branch being set up for the first time.
     * Its socket would then exist while inbound messages went nowhere.
     *
     * The failure is logged rather than swallowed, because "session created but
     * not receiving" is otherwise invisible. QR generation still succeeds either
     * way, so the operator can complete the scan and the webhook can be
     * re-registered on the next call. */
    try {
      await this.configureWebhook(session);
    } catch (e) {
      this.logger.warn(
        `Gagal daftar webhook untuk sesi "${session}": ${(e as Error)?.message ?? e}`,
      );
    }

    return qr;
  }

  /**
   * Point a session's inbound events at this backend.
   *
   * The URL must be reachable FROM the WAHA container, so the default targets
   * the backend service on the shared docker network rather than localhost.
   * Override with WA_WEBHOOK_URL when WAHA runs outside the compose network.
   *
   * Returns the registered URL, or null when no URL is configured.
   */
  async configureWebhook(session: string): Promise<string | null> {
    const url = resolveWebhookUrl();
    if (!url) return null;

    await this.request(`/api/sessions/${encodeURIComponent(session)}`, {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          webhooks: [
            {
              url,
              /* Only `message` is needed: everything the AI receptionist does is
               * driven by an inbound patient message. */
              events: ['message'],
              /* WAHA retries delivery itself, so a brief backend restart does
               * not lose a patient's message. */
              retries: { attempts: 3, delaySeconds: 2 },
              hmac: null,
            },
          ],
        },
      }),
    });

    return url;
  }

  /** Read a session's current config back, to confirm the webhook landed. */
  async getSessionConfig(session: string): Promise<{ webhooks: Array<{ url: string }> } | null> {
    const response = await this.request(`/api/sessions/${encodeURIComponent(session)}`);
    const body = await response.json() as { config?: { webhooks?: Array<{ url: string }> } };
    return body?.config ? { webhooks: body.config.webhooks ?? [] } : null;
  }

  /** Liveness probe for the Settings → Integrations "Test Connection" action. */
  async ping(): Promise<boolean> {
    try {
      await this.request('/api/sessions');
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Fetches the current pairing QR for a session.
   * WAHA serves it as PNG at GET /api/{session}/auth/qr — returns base64 so the
   * frontend can render it inline without a direct WAHA call.
   */
  async fetchQr(session: string, opts?: { manualPairing?: boolean }): Promise<WahaQrResult> {
      const encoded = encodeURIComponent(session);
      /* A FAILED/STOPPED session cannot serve a QR. WAHA exposes /restart for
       * exactly this transition (plain /start returns 422 once a session exists
       * on the engine). Restart, then poll briefly until SCAN_QR_CODE.
       *
       * A1 CIRCUIT BREAKER (2 Okt 2026): the QR screen polls this endpoint, so an
       * unguarded restart here fired on EVERY poll — 13 restarts in a row and a QR
       * that changed every ~3s, which no phone can scan. WhatsApp reads that burst
       * as bot behaviour. The brake allows at most one restart per window and
       * never auto-restarts a FAILED session (a human must act).
       *
       * MANUAL PAIRING EXCEPTION: generateChannelQr() is itself the human act —
       * an operator clicked "QR" intending to pair (or re-pair after a ban/kill).
       * Refusing that click turned a legitimate repair into a 500 the UI could
       * only show as "gagal jana QR". The A1 restart-limit still applies (one
       * per window), and the QR-screen's 25s refresh NEVER passes manualPairing,
       * so polling remains fully braked. */
      let status = await this.sessionStatus(session);
      if (status !== 'scan_qr_code' && status !== 'starting') {
        const nowMs = Date.now();
        const decision = decideRestart(
          {
            status: (opts?.manualPairing && status === 'failed' ? 'stopped' : status) as WahaSessionStatus,
            restartHistoryMs: this.restartHistory.get(session) ?? [],
            nowMs,
          },
        );

        if (!decision.allowed) {
          this.logger.warn(
            `Restart sesi "${session}" disekat (${decision.reason}). ` +
              (decision.reason === 'SESSION_FAILED'
                ? 'Sesi FAILED — perlu tindakan manual (pair semula), bukan restart automatik.'
                : 'Had restart dicapai — elak gelung restart yang boleh menyebabkan ban.'),
          );
          throw new WahaError(
            `WAHA restart blocked (${decision.reason}) for session ${session}`,
            true,
          );
        }

        this.recordRestart(session, nowMs);
        await this.request(`/api/sessions/${encoded}/restart`, { method: 'POST' });
        status = await this.waitForQr(session);
      }
    const response = await this.request(`/api/${encoded}/auth/qr`, {
      headers: { Accept: 'image/png' },
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const qr = buffer.toString('base64');
    /* WhatsApp rotates the pairing QR on its own schedule (~20s). We advertise
     * a shorter freshness window so the frontend refreshes ahead of expiry and
     * the user always has a scannable code on screen. */
    const ttlSeconds = Number(process.env.WAHA_QR_TTL_SECONDS ?? 45);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return { qr: `data:${contentType};base64,${qr}`, expiresAt };
  }
  /** Polls session status until it is ready to present a QR (bounded wait). */
  private async waitForQr(session: string, attempts = 10, delayMs = 1200): Promise<string> {
    let status = 'unknown';
    for (let i = 0; i < attempts; i++) {
      status = await this.sessionStatus(session);
      if (status === 'scan_qr_code' || status === 'working') return status;
      if (status === 'failed') break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return status;
  }

  /**
   * Records a restart attempt for the A1 circuit breaker, dropping entries
   * older than the window so the list cannot grow without bound.
   */
  private recordRestart(session: string, nowMs: number): void {
    const history = this.restartHistory.get(session) ?? [];
    history.push(nowMs);
    const cutoff = nowMs - RESTART_WINDOW_MS - 60_000;
    this.restartHistory.set(session, history.filter((at) => at > cutoff));
  }

  /**
   * A2 — hard stop before sending through a dead session.
   *
   * We kept calling sendText at a session that had dropped to FAILED, which is
   * exactly the "hammering" pattern Meta flags. This refuses the send and, when
   * the session is dead or stuck, asks the caller to lock the channel so no
   * further sends or restarts happen until a human intervenes.
   *
   * Fail-open on an unreadable status: the send path already has its own six
   * gates, and locking a healthy channel over one failed status read would be
   * worse than the risk it prevents.
   */
  async assertSendable(session: string): Promise<SendDecision> {
    let status: WahaSessionStatus = 'unknown';
    try {
      status = (await this.sessionStatus(session)) as WahaSessionStatus;
    } catch (e) {
      this.logger.warn(
        `Status sesi "${session}" tidak dapat dibaca sebelum hantar: ${(e as Error)?.message ?? e}`,
      );
      return decideSend({ status: 'unknown', statusAgeMs: 0 });
    }

    const nowMs = Date.now();
    let ageMs = 0;
    if (status === 'working') {
      this.stuckSince.delete(session);
    } else {
      const existing = this.stuckSince.get(session);
      if (existing == null) this.stuckSince.set(session, nowMs);
      ageMs = nowMs - (existing ?? nowMs);
    }

    const decision = decideSend({ status, statusAgeMs: ageMs });
    if (!decision.allowed) {
      this.logger.warn(
        `Hantar disekat untuk sesi "${session}": ${decision.reason}` +
          (decision.shouldLock ? ' — saluran perlu dikunci sehingga tindakan manual.' : ''),
      );
    }
    return decision;
  }

  /**
   * Tracks when a session entered a non-working state, so A2 can tell a
   * transient STARTING (wait) from a stuck one (lock). One entry per session;
   * cleared when the session returns to WORKING.
   */
  private readonly stuckSince = new Map<string, number>();

  async stopSession(session: string): Promise<void> {
    const response = await this.request(`/api/sessions/${encodeURIComponent(session)}/stop`, { method: 'POST' });
    await response.text();
  }
  async sessionStatus(session: string): Promise<string> {
    const encoded = encodeURIComponent(session);

    const response =
      await this.request(
        `/api/sessions/${encoded}`,
      );

    const body =
      await response.json() as Record<string, unknown>;

    const status =
      String(
        body.status ??
        body.state ??
        'unknown',
      ).toLowerCase();

    if (status !== 'starting') {
      return status;
    }

    /*
     * Sesetengah sesi WAHA boleh kekal melaporkan STARTING
     * walaupun akaun WhatsApp sebenarnya sudah authenticated.
     *
     * Semak endpoint /me sebagai pengesahan kedua.
     * Jika /me berjaya, sesi boleh digunakan dan dianggap WORKING.
     */
    try {
      const me =
        await this.request(
          `/api/sessions/${encoded}/me`,
        );

      if (me.ok) {
        const account =
          await me.json() as Record<string, unknown>;

        if (
          account &&
          Object.keys(account).length > 0
        ) {
          return 'working';
        }
      }
    } catch {
      // Belum authenticated / WAHA belum benar-benar ready.
    }

    return status;
  }
  /** Sends a text message. Throws WahaError (retryable flag) on failure. */
  async sendText(session: string, chatId: string, text: string): Promise<WahaSendResult> {
    const response = await this.request('/api/sendText', { method: 'POST', body: JSON.stringify({ session, chatId, text }) });
    const body = await response.json() as Record<string, unknown>;
    const externalMessageId = body.id ? String(body.id) : body.messageId ? String(body.messageId) : null;
    if (!externalMessageId) throw new WahaError('WAHA sendText returned no message id', false);
    return { externalMessageId };
  }

  /**
   * Set the chat presence — `typing` makes the patient see "sedang menaip…"
   * before the reply lands, `paused` clears it.
   *
   * WAHA does NOT send typing automatically (its own docs: "It doesn't send
   * typing automatically, so remember to send it manually before /api/sendText
   * to emulate real user behavior"), so the bot must do it explicitly.
   *
   * Best-effort by design: a failed presence call must never prevent the reply
   * itself from being sent, so callers treat a throw as non-fatal.
   */
  async setPresence(
    session: string,
    chatId: string,
    presence: 'typing' | 'paused' | 'recording',
  ): Promise<void> {
    await this.request(`/api/${encodeURIComponent(session)}/presence`, {
      method: 'POST',
      body: JSON.stringify({ chatId, presence }),
    });
  }
  async health(): Promise<boolean> {
    if (!this.configured) return false;
    try { return (await this.request('/api/sessions')).ok; } catch { return false; }
  }
}
