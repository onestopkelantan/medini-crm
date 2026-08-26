import { describe, it, expect } from 'vitest';
import {
  evaluateWaSafety, canTransitionWaMessage,
  WaSafetyInput, WA_AUTO_PAUSE_EVERY, WA_AUTO_PAUSE_MS, WaSafetyGateResult,
} from '@modules/whatsapp/domain/whatsapp-lifecycle';

const base: WaSafetyInput = {
  channelStatus: 'working',
  healthScore: 85,
  sentTodayCount: 0,
  lastSentAt: null,
  now: new Date('2026-08-17T10:00:00+08:00'),
};

describe('T2 — message lifecycle with processing state', () => {
  it('queued → processing → sent', () => {
    expect(canTransitionWaMessage('queued', 'processing')).toBe(true);
    expect(canTransitionWaMessage('processing', 'sent')).toBe(true);
    expect(canTransitionWaMessage('sent', 'delivered')).toBe(true);
    expect(canTransitionWaMessage('delivered', 'read')).toBe(true);
  });
  it('queued → processing → failed (terminal)', () => {
    expect(canTransitionWaMessage('queued', 'processing')).toBe(true);
    expect(canTransitionWaMessage('processing', 'failed')).toBe(true);
    expect(canTransitionWaMessage('failed', 'queued')).toBe(false);
    expect(canTransitionWaMessage('failed', 'sent')).toBe(false);
  });
  it('queued → sent directly (legacy/compat path still allowed)', () => {
    expect(canTransitionWaMessage('queued', 'sent')).toBe(true);
  });
  it('processing → queued NOT allowed (no requeue from processing)', () => {
    expect(canTransitionWaMessage('processing', 'queued')).toBe(false);
  });
});

describe('T2 — N6-3 auto-pause threshold + skipAutoPause', () => {
  it('gate 6 engages at every 25th send', () => {
    expect(evaluateWaSafety({ ...base, sentTodayCount: WA_AUTO_PAUSE_EVERY - 1 }).blockedReason).toBe('AUTO_PAUSED');
    expect(evaluateWaSafety({ ...base, sentTodayCount: WA_AUTO_PAUSE_EVERY }).allowed).toBe(true); /* 25+1=26, 26%25=1 ≠ 0 */
    expect(evaluateWaSafety({ ...base, sentTodayCount: WA_AUTO_PAUSE_EVERY * 2 - 1 }).blockedReason).toBe('AUTO_PAUSED');
  });
  it('skipAutoPause bypasses gate 6 (post-resume)', () => {
    const r = evaluateWaSafety({ ...base, sentTodayCount: WA_AUTO_PAUSE_EVERY - 1, skipAutoPause: true });
    expect(r.allowed).toBe(true);
    expect(r.gates.find((g: WaSafetyGateResult) => g.gate === 'auto_pause')?.passed).toBe(true);
  });
  it('auto-pause duration constant is 15 minutes', () => {
    expect(WA_AUTO_PAUSE_MS).toBe(15 * 60_000);
  });
});

describe('T2 — safety gate ordering with processing state', () => {
  it('gates short-circuit in order (health failure hides later gates)', () => {
    const r = evaluateWaSafety({ ...base, healthScore: 10, sentTodayCount: 999 });
    expect(r.blockedReason).toBe('LOW_HEALTH');
    expect(r.gates).toHaveLength(2);
  });
  it('cooldown gate: 30s floor (D18 override)', () => {
    const now = new Date('2026-08-17T10:00:29+08:00');
    const last = new Date('2026-08-17T10:00:00+08:00');
    expect(evaluateWaSafety({ ...base, now, lastSentAt: last }).blockedReason).toBe('RATE_LIMIT');
    const ok = new Date('2026-08-17T10:00:30+08:00');
    expect(evaluateWaSafety({ ...base, now: ok, lastSentAt: last }).allowed).toBe(true);
  });
});
