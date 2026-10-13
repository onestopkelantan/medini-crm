import { describe, it, expect } from 'vitest';

import {
  decideRestart,
  decideSend,
  RESTART_WINDOW_MS,
  MAX_RESTARTS_PER_WINDOW,
  SESSION_STUCK_MS,
} from '@modules/whatsapp/domain/waha-session-guard';

/**
 * A1 + A2 — anti-ban circuit breakers (pelajaran bencana 2 Okt 2026).
 *
 * The number was not banned by the six send-time gates (health, window, daily
 * cap, auto-pause, opt-out, channel health) — those never fired. It was banned
 * by the TRANSPORT behaving like a bot: 13 session restarts in a row, then
 * sendText hammered at a session stuck in FAILED ("Connection Failure").
 *
 * Both of those are control-plane actions that bypassed every send-time gate,
 * so they need their own brakes, placed before the WAHA call:
 *
 *  A1 — a restart circuit breaker: at most one restart per window. The QR
 *       viewer polls, so a broken session used to be restarted on every poll.
 *  A2 — a hard stop on a dead session: never send (or restart) when the
 *       session is FAILED or stuck STARTING. A human must intervene.
 *
 * These are pure functions so the brake can be unit-tested without WAHA.
 */

describe('A1 — restart circuit breaker', () => {
  const now = 1_000_000_000_000;

  it('allows the first restart when the session has no restart history', () => {
    const d = decideRestart({ status: 'stopped', restartHistoryMs: [], nowMs: now });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it('blocks a second restart inside the window (the 13-restart loop)', () => {
    /* The exact disaster: viewer polls, each poll restarts, QR churns forever. */
    const d = decideRestart({
      status: 'stopped',
      restartHistoryMs: [now - 2_000], // restarted 2 seconds ago
      nowMs: now,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('RESTART_LIMIT_REACHED');
  });

  it('allows a restart again once the previous one is outside the window', () => {
    const d = decideRestart({
      status: 'stopped',
      restartHistoryMs: [now - RESTART_WINDOW_MS - 1],
      nowMs: now,
    });
    expect(d.allowed).toBe(true);
  });

  it('never auto-restarts a FAILED session, even with no history', () => {
    /* A FAILED session means WhatsApp closed the socket. Restarting it is the
     * hammering pattern Meta flags. It must be a human decision. */
    const d = decideRestart({ status: 'failed', restartHistoryMs: [], nowMs: now });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('SESSION_FAILED');
  });

  it('honours custom window and max overrides', () => {
    const d = decideRestart({
      status: 'stopped',
      restartHistoryMs: [now - 1_000, now - 2_000],
      nowMs: now,
      windowMs: 60_000,
      maxInWindow: 3,
    });
    expect(d.allowed).toBe(true); // 2 in window < 3 allowed
  });

  it('exposes documented defaults', () => {
    expect(RESTART_WINDOW_MS).toBe(600_000); // 10 min
    expect(MAX_RESTARTS_PER_WINDOW).toBe(1);
    expect(SESSION_STUCK_MS).toBe(300_000); // 5 min
  });
});

describe('A2 — hard stop on a dead session', () => {
  it('blocks sending on a FAILED session and asks the caller to lock the channel', () => {
    const d = decideSend({ status: 'failed', statusAgeMs: 0 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('SESSION_FAILED');
    expect(d.shouldLock).toBe(true);
  });

  it('blocks sending while STARTING beyond the stuck threshold, and locks', () => {
    const d = decideSend({ status: 'starting', statusAgeMs: SESSION_STUCK_MS + 1 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('SESSION_STUCK');
    expect(d.shouldLock).toBe(true);
  });

  it('blocks sending while STARTING within the threshold, without locking', () => {
    /* A session that just started is expected to be briefly STARTING — that is
     * transient, so we wait rather than lock the channel. */
    const d = decideSend({ status: 'starting', statusAgeMs: 1_000 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('SESSION_STUCK');
    expect(d.shouldLock).toBe(false);
  });

  it('blocks sending on a STOPPED session beyond the threshold, and locks', () => {
    const d = decideSend({ status: 'stopped', statusAgeMs: SESSION_STUCK_MS + 1 });
    expect(d.allowed).toBe(false);
    expect(d.shouldLock).toBe(true);
  });

  it('allows sending on a WORKING session', () => {
    const d = decideSend({ status: 'working', statusAgeMs: 60_000 });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it('allows sending when the status is unknown (fail-open on read failure)', () => {
    /* Status could not be read — the send path already has its own gates, and
     * locking on a read failure would strand a healthy channel. */
    const d = decideSend({ status: 'unknown', statusAgeMs: 0 });
    expect(d.allowed).toBe(true);
  });
});
