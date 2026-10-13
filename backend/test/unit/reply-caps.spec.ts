import { describe, it, expect } from 'vitest';

import { evaluateReplyCaps, HOURLY_HOLD_MS, type ReplyCapSettings, type ReplyCapCounts } from '@modules/ai-manager/domain/reply-caps';

/**
 * AB2 — the caps the anti-ban panel promises must actually bind the AI
 * reply path, not just blasts. Escalate (never silently drop) on the daily
 * ceiling; hold briefly on the hourly one.
 */

const settings = (over: Partial<ReplyCapSettings> = {}): ReplyCapSettings => ({
  dailyMessageCap: 100,
  hourlyMessageCap: 12,
  daysActive: 30,
  warmupDays: 7,
  warmupDailyCap: 20,
  ...over,
});

const counts = (over: Partial<ReplyCapCounts> = {}): ReplyCapCounts => ({
  sentToday: 0,
  sentLastHour: 0,
  ...over,
});

describe('evaluateReplyCaps', () => {
  it('allows a fresh branch with no traffic', () => {
    expect(evaluateReplyCaps(settings(), counts())).toEqual({ decision: 'ALLOW', reason: null });
  });

  it('allows at exactly one below the daily cap', () => {
    expect(evaluateReplyCaps(settings(), counts({ sentToday: 99 })).decision).toBe('ALLOW');
  });

  it('ESCALATES at the daily cap — the patient is never silently dropped', () => {
    const v = evaluateReplyCaps(settings(), counts({ sentToday: 100 }));
    expect(v).toEqual({ decision: 'ESCALATE', reason: 'daily_cap' });
  });

  it('HOLDS at the hourly cap while the day still has room', () => {
    const v = evaluateReplyCaps(settings(), counts({ sentLastHour: 12 }));
    expect(v.decision).toBe('HOLD');
    expect(v).toMatchObject({ reason: 'hourly_cap', holdMs: HOURLY_HOLD_MS });
  });

  it('DAILY wins over HOURLY when both are exceeded', () => {
    const v = evaluateReplyCaps(settings(), counts({ sentToday: 100, sentLastHour: 12 }));
    expect(v.decision).toBe('ESCALATE');
  });

  describe('warm-up', () => {
    it('a young number uses the lower warm-up cap', () => {
      const v = evaluateReplyCaps(settings({ daysActive: 2 }), counts({ sentToday: 20 }));
      expect(v).toEqual({ decision: 'ESCALATE', reason: 'warmup_cap' });
    });

    it('the same count is fine on an old number', () => {
      const v = evaluateReplyCaps(settings({ daysActive: 30 }), counts({ sentToday: 20 }));
      expect(v.decision).toBe('ALLOW');
    });

    it('warm-up applies up to but not including warmupDays', () => {
      expect(evaluateReplyCaps(settings({ daysActive: 6 }), counts({ sentToday: 20 })).decision).toBe('ESCALATE');
      expect(evaluateReplyCaps(settings({ daysActive: 7 }), counts({ sentToday: 20 })).decision).toBe('ALLOW');
    });

    it('warmupDailyCap above dailyMessageCap is still bounded by the daily cap', () => {
      const v = evaluateReplyCaps(
        settings({ daysActive: 1, warmupDailyCap: 999, dailyMessageCap: 50 }),
        counts({ sentToday: 50 }),
      );
      /* The min() binds the ceiling to 50, and the branch is young — so the
       * violation is reported as the warm-up cap, which is the truthful reason. */
      expect(v).toEqual({ decision: 'ESCALATE', reason: 'warmup_cap' });
    });
  });
});
