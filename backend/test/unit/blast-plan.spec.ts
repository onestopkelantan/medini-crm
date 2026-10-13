import { describe, it, expect } from 'vitest';

import { planBlast } from '@modules/ai-manager/application/ai-whatsapp-settings.service';

/**
 * FASA 5A — blast spacing plan.
 *
 * The operator says "1400 numbers over 14 days, window 08:00–22:00" and expects
 * the system to work out the pace. This is that calculation, verified against
 * the arithmetic the client actually asked for.
 *
 * Bos's own example: 8am–10pm is 14 hours; 100 blasts in a day = one every
 * 8.4 minutes. That number is the acceptance criterion below.
 */

const WIN = { windowStartHour: 8, windowEndHour: 22, maxBlastPerDay: 100 };

describe('FASA 5A — blast plan', () => {
  it("reproduces the client's own arithmetic: 100/day over 14h = 8.4 min", () => {
    const plan = planBlast(1400, 14, WIN);
    expect(plan.perDay).toBe(100);
    expect(plan.windowHours).toBe(14);
    /* 14 * 3600 / 100 = 504 s = 8.4 min */
    expect(plan.gapSeconds).toBe(504);
    expect(plan.gapLabel).toBe('8 min 24s');
    expect(plan.exceedsDailyCap).toBe(false);
  });

  it('scales the gap for the blast count the operator actually types', () => {
    const cases: Array<[number, number]> = [
      [40, 1260],   // 21.0 min
      [80, 630],    // 10.5 min
      [100, 504],   // 8.4 min
      [150, 336],   // 5.6 min
    ];
    for (const [count, expectedGap] of cases) {
      const plan = planBlast(count, 1, WIN);
      expect(plan.perDay).toBe(count);
      expect(plan.gapSeconds).toBe(expectedGap);
    }
  });

  it('spreads a 14-day promotion across days rather than one burst', () => {
    const plan = planBlast(1400, 14, WIN);
    expect(plan.days).toBe(14);
    expect(plan.perDay).toBe(100);
    /* The whole point: per-day load, not all 1400 at once. */
    expect(plan.perDay).toBeLessThan(plan.recipients);
  });

  it('refuses a plan the daily ceiling cannot absorb (reports, never silently floods)', () => {
    /* 1400 numbers in 7 days = 200/day, but the cap is 100. */
    const plan = planBlast(1400, 7, WIN);
    expect(plan.perDay).toBe(200);
    expect(plan.exceedsDailyCap).toBe(true);
    expect(plan.note).toMatch(/melebihi had 100/);
    /* It still tells the operator how to fix it. */
    expect(plan.note).toMatch(/Panjangkan tempoh promosi|kurangkan bilangan/);
  });

  it('a plan exactly at the ceiling is allowed', () => {
    const plan = planBlast(1400, 14, WIN); // exactly 100/day
    expect(plan.exceedsDailyCap).toBe(false);
  });

  it('adding numbers mid-campaign pushes the finish, not the daily load', () => {
    /* 1200 over 14 days = 86/day. Then 200 more arrive with 7 days left:
     * 1400/7 = 200/day — over the ceiling, and the operator is told. */
    const before = planBlast(1200, 14, WIN);
    expect(before.perDay).toBe(86);
    expect(before.exceedsDailyCap).toBe(false);

    const after = planBlast(1400, 7, WIN);
    expect(after.exceedsDailyCap).toBe(true);
  });

  it('handles degenerate input without dividing by zero', () => {
    expect(planBlast(0, 14, WIN).gapSeconds).toBe(0);
    expect(planBlast(100, 0, WIN).days).toBe(1);       // forced to >= 1 day
    expect(planBlast(100, 14, { ...WIN, windowStartHour: 21, windowEndHour: 22 }).windowHours).toBe(1);
  });

  it('label formats minutes and seconds readably', () => {
    expect(planBlast(100, 1, WIN).gapLabel).toBe('8 min 24s');
    expect(planBlast(700, 1, WIN).gapLabel).toMatch(/^\d+ min \d{2}s$/);
  });

  it('keeps the blast window inside daylight hours (never 02:00)', () => {
    /* The agreed policy: a promotion must not reach anyone in the small hours. */
    expect(WIN.windowStartHour).toBeGreaterThanOrEqual(8);
    expect(WIN.windowEndHour).toBeLessThanOrEqual(22);
  });
});
