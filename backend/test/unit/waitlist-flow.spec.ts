import { describe, it, expect } from 'vitest';

import {
  canWaitlistTransition, allowedWaitlistTransitions, normalizeDays,
  waitlistMatches, rankMatches, isExpired, TIME_BANDS, WEEKDAYS,
} from '@modules/appointments/domain/waitlist-flow';

/**
 * FASA E — the waitlist rules. These are the tests for a PROMISE, not a
 * schema: "we will call you when a matching slot opens". Each block pins one
 * way that promise would silently break.
 */

describe('waitlist lifecycle', () => {
  it('walks the happy path active → notified → booked', () => {
    expect(canWaitlistTransition('active', 'notified')).toBe(true);
    expect(canWaitlistTransition('notified', 'booked')).toBe(true);
  });

  it('staff may cancel from any live state', () => {
    expect(canWaitlistTransition('active', 'cancelled')).toBe(true);
    expect(canWaitlistTransition('notified', 'cancelled')).toBe(true);
  });

  it('terminal states have no outgoing edges', () => {
    for (const terminal of ['booked', 'cancelled', 'expired']) {
      expect(allowedWaitlistTransitions(terminal)).toEqual([]);
    }
  });

  it('booked cannot be re-notified — the wish is consumed', () => {
    expect(canWaitlistTransition('booked', 'notified')).toBe(false);
    expect(canWaitlistTransition('cancelled', 'active')).toBe(false);
  });
});

describe('normalizeDays — free-form input to canonical weekdays', () => {
  it('uppercases and trims', () => {
    expect(normalizeDays(['monday', ' WEDNESDAY '])).toEqual(['MONDAY', 'WEDNESDAY']);
  });

  it('drops unknown days and dedupes', () => {
    expect(normalizeDays(['MONDAY', 'MONDAY', 'someday', 5])).toEqual(['MONDAY']);
  });

  it('null for non-array or empty-after-cleaning', () => {
    expect(normalizeDays(null)).toBeNull();
    expect(normalizeDays('MONDAY')).toBeNull();
    expect(normalizeDays([])).toBeNull();
    expect(normalizeDays(['nope'])).toBeNull();
  });

  it('exports the seven canonical names', () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS).toContain('SUNDAY');
  });
});

describe('waitlistMatches — does one slot satisfy one wish', () => {
  it('matches when the day is named and the slot is that day', () => {
    expect(waitlistMatches(
      { preferredDays: ['MONDAY', 'WEDNESDAY'] },
      { weekday: 'WEDNESDAY', hour: 10 },
    )).toBe(true);
  });

  it('no match on a different day', () => {
    expect(waitlistMatches(
      { preferredDays: ['MONDAY'] },
      { weekday: 'TUESDAY', hour: 10 },
    )).toBe(false);
  });

  it('no days named = any day (the most eager match)', () => {
    expect(waitlistMatches(
      { preferredDays: null },
      { weekday: 'FRIDAY', hour: 15 },
    )).toBe(true);
  });

  it('time bands cut at the documented hours', () => {
    /* morning < 12, afternoon 12–17, evening >= 17. */
    expect(waitlistMatches({ preferredTime: 'morning' }, { weekday: 'MONDAY', hour: 11 })).toBe(true);
    expect(waitlistMatches({ preferredTime: 'morning' }, { weekday: 'MONDAY', hour: 12 })).toBe(false);
    expect(waitlistMatches({ preferredTime: 'afternoon' }, { weekday: 'MONDAY', hour: 16 })).toBe(true);
    expect(waitlistMatches({ preferredTime: 'afternoon' }, { weekday: 'MONDAY', hour: 17 })).toBe(false);
    expect(waitlistMatches({ preferredTime: 'evening' }, { weekday: 'MONDAY', hour: 17 })).toBe(true);
    expect(TIME_BANDS.morning.to).toBe(12);
    expect(TIME_BANDS.afternoon.to).toBe(17);
  });

  it('a named doctor must be honoured exactly', () => {
    expect(waitlistMatches(
      { doctorId: 'doc-a' },
      { weekday: 'MONDAY', hour: 10, doctorId: 'doc-b' },
    )).toBe(false);
    expect(waitlistMatches(
      { doctorId: 'doc-a' },
      { weekday: 'MONDAY', hour: 10, doctorId: 'doc-a' },
    )).toBe(true);
    /* A slot with no doctor assigned matches a doctor-less wish. */
    expect(waitlistMatches(
      { doctorId: null },
      { weekday: 'MONDAY', hour: 10, doctorId: 'doc-a' },
    )).toBe(true);
  });

  it('all three wishes must agree at once', () => {
    expect(waitlistMatches(
      { preferredDays: ['TUESDAY'], preferredTime: 'evening', doctorId: 'doc-a' },
      { weekday: 'TUESDAY', hour: 18, doctorId: 'doc-a' },
    )).toBe(true);
    expect(waitlistMatches(
      { preferredDays: ['TUESDAY'], preferredTime: 'evening', doctorId: 'doc-a' },
      { weekday: 'TUESDAY', hour: 11, doctorId: 'doc-a' },
    )).toBe(false);
  });
});

describe('rankMatches — who gets offered the slot first', () => {
  const mk = (id: string, over: Record<string, unknown>) => ({
    id, createdAt: '2026-01-01T00:00:00Z', ...over,
  });

  it('most specific wish wins over any-day-any-time', () => {
    const vague = mk('vague', {});
    const specific = mk('specific', { preferredDays: ['MONDAY'], preferredTime: 'morning', doctorId: 'doc-a' });
    const ranked = rankMatches([vague, specific], { weekday: 'MONDAY', hour: 10, doctorId: 'doc-a' });
    expect(ranked[0]!.id).toBe('specific');
  });

  it('equal specificity: oldest entry first (the queue is first-come)', () => {
    const older = mk('older', { createdAt: '2026-01-01T00:00:00Z', preferredDays: ['MONDAY'] });
    const newer = mk('newer', { createdAt: '2026-06-01T00:00:00Z', preferredDays: ['MONDAY'] });
    const ranked = rankMatches([newer, older], { weekday: 'MONDAY', hour: 10 });
    expect(ranked[0]!.id).toBe('older');
  });

  it('exact tie breaks deterministically by id', () => {
    const a = mk('aaa', { preferredDays: ['MONDAY'] });
    const b = mk('bbb', { preferredDays: ['MONDAY'] });
    expect(rankMatches([b, a], { weekday: 'MONDAY', hour: 10 })[0]!.id).toBe('aaa');
    expect(rankMatches([a, b], { weekday: 'MONDAY', hour: 10 })[0]!.id).toBe('aaa');
  });

  it('non-matching entries are filtered out entirely', () => {
    const wrongDay = mk('wrong', { preferredDays: ['FRIDAY'] });
    const right = mk('right', { preferredDays: ['MONDAY'] });
    const ranked = rankMatches([wrongDay, right], { weekday: 'MONDAY', hour: 10 });
    expect(ranked.map((e) => e.id)).toEqual(['right']);
  });

  it('undated entries sort last, not first', () => {
    /* A legacy row with no createdAt must not jump the queue. */
    const undated = mk('undated', { createdAt: null, preferredDays: ['MONDAY'] });
    const dated = mk('dated', { createdAt: '2026-03-01T00:00:00Z', preferredDays: ['MONDAY'] });
    expect(rankMatches([undated, dated], { weekday: 'MONDAY', hour: 10 })[0]!.id).toBe('dated');
  });
});

describe('isExpired — the ageing rule', () => {
  it('expires after the horizon (default 90 days)', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    /* Jan 1 + 90 days = Apr 1 exactly: the boundary is > maxAge, so Apr 1
     * itself (exactly 90 days) is NOT yet expired, Apr 2 is. Pin both sides. */
    const day90 = new Date('2026-04-01T00:00:00Z');
    const day91 = new Date('2026-04-02T00:00:00Z');
    expect(isExpired({ createdAt: created }, day90)).toBe(false);
    expect(isExpired({ createdAt: created }, day91)).toBe(true);
  });

  it('custom horizon is honoured', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(isExpired({ createdAt: created }, new Date('2026-01-15T00:00:00Z'), 30)).toBe(false);
    expect(isExpired({ createdAt: created }, new Date('2026-02-15T00:00:00Z'), 30)).toBe(true);
  });

  it('undated entries never auto-expire (a human decides)', () => {
    expect(isExpired({ createdAt: null }, new Date('2030-01-01T00:00:00Z'))).toBe(false);
    expect(isExpired({}, new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});
