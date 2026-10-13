import { describe, it, expect } from 'vitest';

import {
  resolveAnalystQuestion,
  wantsComparison,
} from '../../src/modules/ai-manager/domain/analyst-question';
import { previousPeriodRange } from '../../src/modules/reports/domain/period-resolver';

/**
 * Phase B — period comparison (dental-erp clinic-analyst pattern, facts-first).
 *
 * wantsComparison is a PURE keyword detector: it decides whether the question
 * asks "how does this period compare to the last one" BEFORE any fetch
 * happens, so the service can fetch both windows and hand the model two fact
 * blocks. The model never chooses to compare — code does.
 */
describe('wantsComparison — comparison-intent detection', () => {
  it('detects the canonical comparison phrases (BM)', () => {
    expect(wantsComparison('bandingkan kutipan bulan ini dengan bulan lepas')).toBe(true);
    expect(wantsComparison('macam mana trend jualan minggu ini berbanding minggu lepas?')).toBe(true);
  });

  it('detects the canonical comparison phrases (EN)', () => {
    expect(wantsComparison('compare revenue this month vs last month')).toBe(true);
    expect(wantsComparison('how does this week compare to last week?')).toBe(true);
  });

  it('bare "vs" is NOT enough — it appears in non-comparison questions too', () => {
    /* Fail-closed: fetching a second window doubles the query load and gives
     * the model facts the user did not ask about. Only explicit comparison
     * wording triggers the second fetch. */
    expect(wantsComparison('doktor vs pesakit siapa lebih ramai')).toBe(false);
  });

  it('a plain single-period question does not compare', () => {
    expect(wantsComparison('berapa kutipan bulan lepas?')).toBe(false);
    expect(wantsComparison('campuran rawatan 90 hari')).toBe(false);
  });
});

describe('previousPeriod — the comparison window mapping (Period type guard)', () => {
  /* The mapping itself is exercised through resolveAnalystQuestion below; the
   * pure function is previousPeriodOf in period-resolver. Guard the type. */
  it('resolveAnalystQuestion returns a compare flag alongside keys and period', () => {
    const q = resolveAnalystQuestion('bandingkan kutipan bulan ini dengan bulan lepas', '2026-10-05');
    expect(q.keys.length).toBeGreaterThan(0);
    expect(q.period).toBe('30D');
    expect(q.compare).toBe(true);
  });

  it('a non-comparison question returns compare: false', () => {
    const q = resolveAnalystQuestion('berapa kutipan bulan lepas?', '2026-10-05');
    expect(q.compare).toBe(false);
  });
});

describe('previousPeriodRange — the window immediately BEFORE the current one', () => {
  /* Fixed `now` so the test is deterministic (S8 nowFn lesson). */
  const now = new Date(2026, 9, 5); // 2026-10-05 — current 7D window is 09-29..10-05

  it('7D: the week before this week', () => {
    expect(previousPeriodRange('7D', now)).toEqual({ from: '2026-09-22', to: '2026-09-28' });
  });

  it('30D: the 30 days before this 30-day window (NOT the calendar month)', () => {
    /* The current window is 2026-09-06..2026-10-05, so the previous one is
     * 2026-08-07..2026-09-05. Same length, immediately before, no gap and
     * no overlap — anything else double-counts or skips days. */
    expect(previousPeriodRange('30D', now)).toEqual({ from: '2026-08-07', to: '2026-09-05' });
  });

  it('90D: the quarter before this quarter', () => {
    expect(previousPeriodRange('90D', now)).toEqual({ from: '2026-04-09', to: '2026-07-07' });
  });

  it('12M: the year before this year', () => {
    expect(previousPeriodRange('12M', now)).toEqual({ from: '2024-10-06', to: '2025-10-05' });
  });

  it('is injectable and deterministic: a different now moves the window with it', () => {
    expect(previousPeriodRange('7D', new Date(2026, 9, 6))).toEqual({ from: '2026-09-23', to: '2026-09-29' });
  });
});
