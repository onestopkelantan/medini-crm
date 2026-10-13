/**
 * A1 + A2 — anti-ban circuit breakers for the WAHA transport.
 *
 * Why this file exists (krisis 2 Okt 2026): a spare number was banned. The
 * send-time safety engine did NOT fail — its six gates (health score, sending
 * window, daily cap, auto-pause, opt-out, channel health) never fired. What
 * failed was the TRANSPORT behaving like a bot:
 *
 *   A1 — a QR viewer polled the session and every poll called /restart,
 *        producing 13 restarts in a row and a QR that churned every ~3s.
 *   A2 — after the session dropped to FAILED ("Connection Failure"), the reply
 *        path kept calling sendText at the dead session, producing 422s.
 *
 * Both actions live on the CONTROL plane and bypass every send-time gate, so
 * they need their own brakes that run BEFORE the WAHA call. Keeping the
 * decision pure (no I/O) makes the brake unit-testable without a live WAHA.
 *
 * Honestly: no brake makes the unofficial protocol safe — only the official
 * Cloud API does. These brakes remove the *self-inflicted* ban triggers.
 */

/** A session status as WAHA reports it (lowercased by the adapter). */
export type WahaSessionStatus =
  | 'stopped'
  | 'starting'
  | 'scan_qr_code'
  | 'working'
  | 'failed'
  | 'unknown';

/** A1: at most this many restarts are allowed per window, per session. */
export const MAX_RESTARTS_PER_WINDOW = 1;
/** A1: the sliding window in which restarts are counted (10 minutes). */
export const RESTART_WINDOW_MS = 10 * 60_000;
/** A2: how long a non-working session may sit before it is treated as dead. */
export const SESSION_STUCK_MS = 5 * 60_000;

export type RestartBlockReason = 'RESTART_LIMIT_REACHED' | 'SESSION_FAILED';

export interface RestartDecision {
  allowed: boolean;
  reason?: RestartBlockReason;
}

export interface RestartInput {
  status: WahaSessionStatus;
  /** Epoch-ms of previous restart attempts (any order; filtered internally). */
  restartHistoryMs: readonly number[];
  nowMs: number;
  windowMs?: number;
  maxInWindow?: number;
}

/**
 * A1 — may we restart this session right now?
 *
 * Refuses when the session is FAILED (restarting a dead socket is the exact
 * hammering pattern Meta flags — a human must decide) or when a restart has
 * already happened inside the window.
 */
export function decideRestart(input: RestartInput): RestartDecision {
  if (input.status === 'failed') {
    return { allowed: false, reason: 'SESSION_FAILED' };
  }

  const windowMs = input.windowMs ?? RESTART_WINDOW_MS;
  const maxInWindow = input.maxInWindow ?? MAX_RESTARTS_PER_WINDOW;

  const recent = input.restartHistoryMs.filter(
    (at) => at > input.nowMs - windowMs && at <= input.nowMs,
  );

  if (recent.length >= maxInWindow) {
    return { allowed: false, reason: 'RESTART_LIMIT_REACHED' };
  }

  return { allowed: true };
}

export type SendBlockReason = 'SESSION_FAILED' | 'SESSION_STUCK';

export interface SendDecision {
  allowed: boolean;
  reason?: SendBlockReason;
  /** True when the caller should stop this channel until a human intervenes. */
  shouldLock: boolean;
}

export interface SendInput {
  status: WahaSessionStatus;
  /**
   * How long the session has reported its current status, in ms. The caller
   * tracks this — WAHA does not expose a reliable status timestamp.
   */
  statusAgeMs: number;
  stuckMs?: number;
}

/**
 * A2 — may we send through this session right now?
 *
 * - FAILED            → block, and lock the channel (human must re-pair/reset).
 * - STARTING/STOPPED beyond `stuckMs` → block, and lock the channel.
 * - STARTING/STOPPED within `stuckMs`  → block, but do NOT lock: a session
 *   that just started is legitimately brief; we wait rather than disable it.
 * - WORKING           → allow.
 * - unknown           → allow (fail-open): a failed status READ must not
 *   strand a healthy channel, and the send path has its own gates.
 */
export function decideSend(input: SendInput): SendDecision {
  if (input.status === 'working') {
    return { allowed: true, shouldLock: false };
  }

  if (input.status === 'failed') {
    return { allowed: false, reason: 'SESSION_FAILED', shouldLock: true };
  }

  if (input.status === 'starting' || input.status === 'stopped') {
    const stuckMs = input.stuckMs ?? SESSION_STUCK_MS;
    return {
      allowed: false,
      reason: 'SESSION_STUCK',
      shouldLock: input.statusAgeMs >= stuckMs,
    };
  }

  /* scan_qr_code cannot send; unknown = fail-open. */
  return { allowed: true, shouldLock: false };
}
