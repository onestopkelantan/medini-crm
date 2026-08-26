import { describe, it, expect } from 'vitest';
import {
  canTransitionWaChannel, canTransitionWaConversation, canTransitionWaMessage, canTransitionWaAiQueue,
  evaluateWaSafety, waHealthBand, normalizePhone,
} from '@modules/whatsapp/domain/whatsapp-lifecycle';

/**
 * S6-T4 unit suite — deterministic lifecycle + safety engine + health band +
 * phone normalisation. Pure functions, no DB (mirrors M2 locked gates).
 */
describe('S6 whatsapp lifecycle — channel', () => {
  it('stopped→starting→working; working↔need_qr; failed→starting (restart)', () => {
    expect(canTransitionWaChannel('stopped', 'starting')).toBe(true);
    expect(canTransitionWaChannel('starting', 'working')).toBe(true);
    expect(canTransitionWaChannel('working', 'need_qr')).toBe(true);
    expect(canTransitionWaChannel('need_qr', 'working')).toBe(true);
    expect(canTransitionWaChannel('failed', 'starting')).toBe(true);
    expect(canTransitionWaChannel('stopped', 'working')).toBe(false);
    expect(canTransitionWaChannel('working', 'starting')).toBe(false);
  });
});

describe('S6 whatsapp lifecycle — conversation (archived TERMINAL per governance §10)', () => {
  it('new→open→pending→resolved→archived; open→escalated→open; resolved→open', () => {
    expect(canTransitionWaConversation('new', 'open')).toBe(true);
    expect(canTransitionWaConversation('open', 'pending')).toBe(true);
    expect(canTransitionWaConversation('pending', 'resolved')).toBe(true);
    expect(canTransitionWaConversation('resolved', 'archived')).toBe(true);
    expect(canTransitionWaConversation('open', 'escalated')).toBe(true);
    expect(canTransitionWaConversation('escalated', 'open')).toBe(true);
    expect(canTransitionWaConversation('resolved', 'open')).toBe(true);
  });
  it('archived cannot reopen or move anywhere (terminal)', () => {
    for (const next of ['new', 'open', 'pending', 'escalated', 'resolved'] as const) {
      expect(canTransitionWaConversation('archived', next)).toBe(false);
    }
    expect(canTransitionWaConversation('archived', 'archived')).toBe(true);
  });
  it('invalid transitions denied', () => {
    expect(canTransitionWaConversation('new', 'archived')).toBe(false);
    expect(canTransitionWaConversation('pending', 'escalated')).toBe(false);
  });
});

describe('S6 whatsapp lifecycle — message', () => {
  it('queued→sent→delivered→read; queued→failed; failed terminal', () => {
    expect(canTransitionWaMessage('queued', 'sent')).toBe(true);
    expect(canTransitionWaMessage('sent', 'delivered')).toBe(true);
    expect(canTransitionWaMessage('delivered', 'read')).toBe(true);
    expect(canTransitionWaMessage('queued', 'failed')).toBe(true);
    expect(canTransitionWaMessage('failed', 'queued')).toBe(false);
    expect(canTransitionWaMessage('read', 'sent')).toBe(false);
    expect(canTransitionWaMessage('queued', 'read')).toBe(false);
  });
});

describe('S6 whatsapp lifecycle — AI queue state foundation', () => {
  it('received→buffering→ready→processing→responded/waiting/handoff→closed', () => {
    expect(canTransitionWaAiQueue('received', 'buffering')).toBe(true);
    expect(canTransitionWaAiQueue('buffering', 'ready')).toBe(true);
    expect(canTransitionWaAiQueue('ready', 'processing')).toBe(true);
    expect(canTransitionWaAiQueue('processing', 'responded')).toBe(true);
    expect(canTransitionWaAiQueue('processing', 'waiting')).toBe(true);
    expect(canTransitionWaAiQueue('processing', 'handoff')).toBe(true);
    expect(canTransitionWaAiQueue('responded', 'closed')).toBe(true);
    expect(canTransitionWaAiQueue('closed', 'received')).toBe(false);
    expect(canTransitionWaAiQueue('received', 'processing')).toBe(false);
  });
});

describe('S6 safety engine — six locked gates in order (M2 Fasa 1)', () => {
  const base = {
    channelStatus: 'working' as const,
    healthScore: 80,
    sentTodayCount: 5,
    lastSentAt: null,
    now: new Date('2026-08-17T10:00:00+08:00'), /* 10:00 MYT — inside the 09:00–18:00 window */
  };
  it('all gates pass → allowed with 6 gate records', () => {
    const r = evaluateWaSafety(base);
    expect(r.allowed).toBe(true);
    expect(r.blockedReason).toBeNull();
    expect(r.gates).toHaveLength(6);
  });
  it('gate 1: channel not working → CHANNEL_UNAVAILABLE', () => {
    const r = evaluateWaSafety({ ...base, channelStatus: 'need_qr' });
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe('CHANNEL_UNAVAILABLE');
    expect(r.gates).toHaveLength(1);
  });
  it('gate 2: health < 70 → LOW_HEALTH', () => {
    const r = evaluateWaSafety({ ...base, healthScore: 69 });
    expect(r.blockedReason).toBe('LOW_HEALTH');
    expect(waHealthBand(69)).toBe('warming');
    expect(waHealthBand(39)).toBe('critical');
    expect(waHealthBand(85)).toBe('healthy');
    expect(waHealthBand(70)).toBe('ready');
  });
  it('gate 3: sentToday >= cap (default 50) → DAILY_CAP_REACHED', () => {
    expect(evaluateWaSafety({ ...base, sentTodayCount: 50 }).blockedReason).toBe('DAILY_CAP_REACHED');
    /* 49 < 50 passes gate 3 but (49+1) % 25 === 0 → gate 6 AUTO_PAUSED engages */
    expect(evaluateWaSafety({ ...base, sentTodayCount: 49 }).blockedReason).toBe('AUTO_PAUSED');
    /* 48: under cap AND (48+1) % 25 !== 0 → fully allowed */
    expect(evaluateWaSafety({ ...base, sentTodayCount: 48 }).allowed).toBe(true);
  });
  it('gate 4: outside 09:00–18:00 MYT → OUTSIDE_SENDING_WINDOW', () => {
    expect(evaluateWaSafety({ ...base, now: new Date('2026-08-17T08:59:00+08:00') }).blockedReason).toBe('OUTSIDE_SENDING_WINDOW');
    expect(evaluateWaSafety({ ...base, now: new Date('2026-08-17T18:00:00+08:00') }).blockedReason).toBe('OUTSIDE_SENDING_WINDOW');
    expect(evaluateWaSafety({ ...base, now: new Date('2026-08-17T09:00:00+08:00') }).allowed).toBe(true);
    /* 10:00 MYT expressed in UTC (02:00Z) is INSIDE the window — MYT interpretation */
    expect(evaluateWaSafety({ ...base, now: new Date('2026-08-17T02:00:00Z') }).allowed).toBe(true);
  });
  it('gate 5: < 30s since last send → RATE_LIMIT (D18 override: 30–60s randomized floor)', () => {
    const now = new Date('2026-08-17T10:00:29+08:00');
    const last = new Date('2026-08-17T10:00:00+08:00');
    expect(evaluateWaSafety({ ...base, now, lastSentAt: last }).blockedReason).toBe('RATE_LIMIT');
    const ok = new Date('2026-08-17T10:00:30+08:00');
    expect(evaluateWaSafety({ ...base, now: ok, lastSentAt: last }).allowed).toBe(true);
  });
  it('gate 6: every 25th send → AUTO_PAUSED', () => {
    expect(evaluateWaSafety({ ...base, sentTodayCount: 24 }).blockedReason).toBe('AUTO_PAUSED');
    expect(evaluateWaSafety({ ...base, sentTodayCount: 23 }).allowed).toBe(true);
  });
  it('gates short-circuit in order (health failure hides later gates)', () => {
    const r = evaluateWaSafety({ ...base, healthScore: 10, sentTodayCount: 999 });
    expect(r.blockedReason).toBe('LOW_HEALTH');
    expect(r.gates).toHaveLength(2);
  });
});

describe('S6 phone normalisation (deterministic contact identity)', () => {
  it('normalises Malaysia variants to 60x digits', () => {
    expect(normalizePhone('012-345 6789')).toBe('60123456789');
    expect(normalizePhone('+6012-3456789')).toBe('60123456789');
    expect(normalizePhone('60123456789')).toBe('60123456789');
    expect(normalizePhone(' 012 345 6789 ')).toBe('60123456789');
  });
});
