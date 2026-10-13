import { describe, it, expect } from 'vitest';
import {
  continuousChart, type ToothEvent,
} from '@modules/clinical/domain/tooth-chart';

function ev(p: Partial<ToothEvent> & { fdiNo: number; id: string }): ToothEvent {
  return {
    condition: 'healthy',
    encounterId: 'enc-1',
    doctorId: 'doc-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...p,
  };
}

/**
 * `continuousChart` serves TWO callers with the same signature, and the event
 * count means something different for each. This block exists because the first
 * implementation got the second case wrong in a way NO existing test caught —
 * every tooth reported a history of 1 regardless of how often it had been
 * charted, and the UI badge that says "there is history here" never appeared.
 *
 *  - A RAW EVENT LOG: every event is passed in, so counting them is the answer.
 *  - A PRE-REDUCED SET: the SQL read path returns ONE row per tooth (that is its
 *    entire purpose — the caller should not reduce 12 visits x 32 teeth itself),
 *    and carries the real count in `eventCount`. Counting that array gives 1.
 */
describe('tooth chart — eventCount across both call shapes', () => {
  it('counts the events when handed a RAW log (existing behaviour, must not regress)', () => {
    const chart = continuousChart('p', [
      ev({ fdiNo: 36, id: 'a', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', updatedAt: '2026-02-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'c', updatedAt: '2026-03-01T00:00:00Z' }),
      ev({ fdiNo: 11, id: 'd' }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 36)!.eventCount).toBe(3);
    expect(chart.teeth.find((t) => t.fdiNo === 11)!.eventCount).toBe(1);
  });

  it('TRUSTS the carried count when handed a PRE-REDUCED set (one row per tooth)', () => {
    /* This is the SQL path. Counting the array would say 1 — the bug. */
    const chart = continuousChart('p', [
      ev({ fdiNo: 36, id: 'a', condition: 'crowned', eventCount: 3 }),
      ev({ fdiNo: 11, id: 'b', eventCount: 1 }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 36)!.eventCount).toBe(3);
    expect(chart.teeth.find((t) => t.fdiNo === 11)!.eventCount).toBe(1);
  });

  it('never UNDER-reports when a caller passes a mix', () => {
    const chart = continuousChart('p', [
      ev({ fdiNo: 36, id: 'a', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', updatedAt: '2026-02-01T00:00:00Z', eventCount: 7 }),
    ]);
    /* 7 is the larger truth; reporting 2 would silently hide four visits. */
    expect(chart.teeth.find((t) => t.fdiNo === 36)!.eventCount).toBe(7);
  });

  it('still collapses to ONE entry per tooth when counts are carried', () => {
    const chart = continuousChart('p', [
      ev({ fdiNo: 36, id: 'a', eventCount: 5 }),
      ev({ fdiNo: 75, id: 'b', eventCount: 2 }),
    ]);
    expect(chart.teeth).toHaveLength(2);
    expect(chart.chartedCount).toBe(2);
  });

  it('treats a contradictory carried 0 as 1 — a real event EXISTS', () => {
    /* A caller passing one event with `eventCount: 0` is self-contradictory. The
     * answer cannot be 0: 0 means "no history", and a dentist reading that stops
     * looking. The event in hand is proof that at least one exists, and `max`
     * resolves in favour of the evidence rather than the claim. */
    const chart = continuousChart('p', [ev({ fdiNo: 36, id: 'a', eventCount: 0 })]);
    expect(chart.teeth[0]!.eventCount).toBe(1);
  });
});
