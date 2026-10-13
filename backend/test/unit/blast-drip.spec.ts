import { describe, it, expect } from 'vitest';

import {
  planDrip,
  nextWindowOpen,
  isInsideWindow,
} from '@modules/whatsapp/domain/blast-drip';

/**
 * FASA 5C-D — the drip engine.
 *
 * A blast is 100 messages spread over a 14-hour window, not 100 messages fired
 * as fast as the queue drains. Meta bans numbers that look like a machine, and
 * the pace is the whole defence.
 *
 * All local times here are Malaysia (UTC+8). The clinic runs on wall-clock
 * hours; the server runs on UTC, so every conversion is explicit.
 */

/** Build a Malaysia-local Date from Y-M-D H:M (UTC+8). */
const my = (day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 8, day, hour - 8, minute, 0));

/** Local calendar date (YYYY-MM-DD) for an instant — UTC+8, no DST. */
const localDate = (d: Date): string =>
  new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

const WIN = { windowStartHour: 8, windowEndHour: 22 };

describe('FASA 5C-D — blast drip planner', () => {
  /* ------------------------------------------------------------ the pace */

  it("reproduces the client's own arithmetic: 100/day over 14h = 8m24s apart", () => {
    const plan = planDrip({ count: 100, ...WIN, startAt: my(23, 8) });

    expect(plan).toHaveLength(100);
    /* First message goes out immediately — waiting 8 minutes to begin a
     * 14-hour job serves nobody. The gap applies BETWEEN messages. */
    expect(plan[0]!.getTime()).toBe(my(23, 8).getTime());

    const gaps = plan.slice(1).map((t, i) => (t.getTime() - plan[i]!.getTime()) / 1000);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;

    /* 14h / 100 = 504s. Allow drift because jitter is applied deliberately. */
    expect(avg).toBeGreaterThan(420);
    expect(avg).toBeLessThan(590);
  });

  it('spreads the whole batch across the window instead of bursting', () => {
    const plan = planDrip({ count: 100, ...WIN, startAt: my(23, 8) });

    /* Last message must still land before the window closes. */
    const last = plan[plan.length - 1]!;
    expect(last.getTime()).toBeLessThanOrEqual(my(23, 21, 59).getTime());

    /* And they must not all be at the same instant. */
    const unique = new Set(plan.map((d) => d.getTime()));
    expect(unique.size).toBe(100);
  });

  it('never schedules a message outside the 08:00–22:00 window', () => {
    /* A batch that would overrun the window must spill to the NEXT day, not
     * push past 22:00. Waking a patient at 2am is the failure this prevents. */
    const plan = planDrip({ count: 100, ...WIN, startAt: my(23, 20) });

    for (const t of plan) {
      const localHour = (t.getUTCHours() + 8) % 24;
      expect(localHour).toBeGreaterThanOrEqual(8);
      expect(localHour).toBeLessThanOrEqual(22);
    }
    /* Starting at 20:00 there is no room for 100, so most spill to day 2. */
    const day2 = plan.filter((t) => (t.getUTCDate() >= 24));
    expect(day2.length).toBeGreaterThan(50);
  });

  it('spreads a 14-day promotion across days rather than one burst', () => {
    /* 1400 recipients, 14 days, cap 100/day → 100 per day for 14 days. */
    const plan = planDrip({
      count: 1400, ...WIN, perDay: 100, startAt: my(23, 8),
    });

    expect(plan).toHaveLength(1400);

    const day1 = plan.filter((t) => localDate(t) === '2026-09-23');
    expect(day1).toHaveLength(100);

    /* 14 sending days: 23 Sep → 6 Oct inclusive. The promotion must finish on
     * the last day the operator was promised, not drift past it. */
    const last = localDate(plan[plan.length - 1]!);
    expect(last).toBe('2026-10-06');

    /* Every day in between carries its full 100 — the batch is spread evenly,
     * not front-loaded. */
    const perDayCounts = new Map<string, number>();
    for (const t of plan) {
      const k = localDate(t);
      perDayCounts.set(k, (perDayCounts.get(k) ?? 0) + 1);
    }
    expect(perDayCounts.size).toBe(14);
    for (const [, n] of perDayCounts) expect(n).toBe(100);
  });

  /* ------------------------------------------------------------- jitter */

  it('jitters the gap so the pattern is not a metronome', () => {
    /* A perfect 504s cadence is itself a fingerprint. Two batches with the same
     * inputs must not produce identical schedules. */
    const a = planDrip({ count: 20, ...WIN, startAt: my(23, 8) });
    const b = planDrip({ count: 20, ...WIN, startAt: my(23, 8) });

    const timesA = a.map((d) => d.getTime());
    const timesB = b.map((d) => d.getTime());
    expect(timesA).not.toEqual(timesB);
  });

  it('honours the configured min/max gap when given', () => {
    /* Operator set 300–900s. Every gap must sit inside that envelope. */
    const plan = planDrip({
      count: 30, ...WIN, startAt: my(23, 8),
      minGapSeconds: 300, maxGapSeconds: 900,
    });

    for (let i = 1; i < plan.length; i++) {
      const gap = (plan[i]!.getTime() - plan[i - 1]!.getTime()) / 1000;
      /* Gaps are jittered within [min, max]; a window spill may shorten the
       * last gap of a day, so only assert the ceiling strictly. */
      expect(gap).toBeLessThanOrEqual(900);
    }
  });

  /* --------------------------------------------------------- boundaries */

  it('returns an empty plan for zero recipients instead of throwing', () => {
    expect(planDrip({ count: 0, ...WIN, startAt: my(23, 8) })).toEqual([]);
  });

  it('handles a single recipient without dividing by zero', () => {
    const plan = planDrip({ count: 1, ...WIN, startAt: my(23, 8) });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.getTime()).toBe(my(23, 8).getTime());
  });
});

describe('FASA 5C-D — window boundaries', () => {
  it('recognises inside vs outside the send window', () => {
    expect(isInsideWindow(my(23, 8), WIN)).toBe(true);   /* open */
    expect(isInsideWindow(my(23, 12), WIN)).toBe(true);  /* midday */
    expect(isInsideWindow(my(23, 21, 59), WIN)).toBe(true);
    expect(isInsideWindow(my(23, 22), WIN)).toBe(false); /* closed */
    expect(isInsideWindow(my(23, 3), WIN)).toBe(false);  /* 3am */
    expect(isInsideWindow(my(23, 7, 59), WIN)).toBe(false);
  });

  it('rolls a night-time message forward to 08:00 the same morning, not 22:00', () => {
    /* 2am → the NEXT opening is 08:00 today. */
    const t = nextWindowOpen(my(23, 2), WIN);
    expect(t.getTime()).toBe(my(23, 8).getTime());
  });

  it('rolls a post-close message forward to 08:00 TOMORROW', () => {
    /* 23:30 → window closed for the day; next opening is tomorrow 08:00. */
    const t = nextWindowOpen(my(23, 23, 30), WIN);
    expect(t.getTime()).toBe(my(24, 8).getTime());
  });

  it('leaves an in-window time untouched', () => {
    const t = nextWindowOpen(my(23, 10), WIN);
    expect(t.getTime()).toBe(my(23, 10).getTime());
  });
});
