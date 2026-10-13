import { describe, it, expect } from 'vitest';
import {
  isNewerEvent, continuousChart, conditionCounts, teethNeedingAttention,
  WRITABLE_CONDITIONS, type ToothEvent,
} from '@modules/clinical/domain/tooth-chart';

/** Build an event with sane defaults so each test states only what it cares about. */
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

describe('tooth chart — event ordering', () => {
  it('prefers the newer updatedAt', () => {
    const older = ev({ fdiNo: 36, id: 'a', condition: 'decayed', updatedAt: '2026-01-01T00:00:00Z' });
    const newer = ev({ fdiNo: 36, id: 'b', condition: 'filled', updatedAt: '2026-06-01T00:00:00Z' });
    expect(isNewerEvent(newer, older)).toBe(true);
    expect(isNewerEvent(older, newer)).toBe(false);
  });

  it('ORDERS BY updatedAt, not createdAt — a correction inside one encounter wins', () => {
    /* The upsert path UPDATES a row rather than inserting a second one, so a
     * corrected tooth keeps its original createdAt. Ordering by createdAt would
     * show the first, wrong value forever. */
    const first = ev({ fdiNo: 36, id: 'a', condition: 'decayed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const corrected = ev({ fdiNo: 36, id: 'a', condition: 'filled', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' });
    expect(isNewerEvent(corrected, first)).toBe(true);
  });

  it('falls back to createdAt when updatedAt is absent', () => {
    const a = ev({ fdiNo: 11, id: 'a', updatedAt: null, createdAt: '2026-01-01T00:00:00Z' });
    const b = ev({ fdiNo: 11, id: 'b', updatedAt: null, createdAt: '2026-02-01T00:00:00Z' });
    expect(isNewerEvent(b, a)).toBe(true);
  });

  it('treats a MISSING timestamp as oldest, never as newest', () => {
    /* An un-attributed legacy row must not silently overwrite a real finding. */
    const undated = ev({ fdiNo: 36, id: 'zzz', condition: 'healthy', updatedAt: null, createdAt: null });
    const dated = ev({ fdiNo: 36, id: 'aaa', condition: 'decayed', updatedAt: '2020-01-01T00:00:00Z' });
    expect(isNewerEvent(undated, dated)).toBe(false);
    expect(isNewerEvent(dated, undated)).toBe(true);
  });

  it('breaks an exact tie deterministically by id', () => {
    /* Same millisecond, same timestamps: the SAME data must always render the
     * SAME chart, or the screen flickers between two conditions and neither is
     * falsifiable. */
    const a = ev({ fdiNo: 36, id: 'aaa', condition: 'decayed' });
    const b = ev({ fdiNo: 36, id: 'bbb', condition: 'filled' });
    expect(isNewerEvent(b, a)).toBe(true);
    expect(isNewerEvent(a, b)).toBe(false);
    /* and the outcome does not depend on input order */
    const orderOne = continuousChart('p', [a, b]).teeth[0]!.condition;
    const orderTwo = continuousChart('p', [b, a]).teeth[0]!.condition;
    expect(orderOne).toBe(orderTwo);
  });
});

describe('tooth chart — reduction to one entry per tooth', () => {
  it('keeps only the latest event per tooth', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 36, id: 'a', condition: 'decayed', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', condition: 'filled', updatedAt: '2026-03-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'c', condition: 'crowned', updatedAt: '2026-06-01T00:00:00Z' }),
      ev({ fdiNo: 11, id: 'd', condition: 'healthy' }),
    ]);
    expect(chart.teeth).toHaveLength(2);
    expect(chart.teeth.find((t) => t.fdiNo === 36)!.condition).toBe('crowned');
    expect(chart.teeth.find((t) => t.fdiNo === 11)!.condition).toBe('healthy');
  });

  it('counts the events behind each tooth so the UI can show history depth', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 36, id: 'a', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', updatedAt: '2026-02-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'c', updatedAt: '2026-03-01T00:00:00Z' }),
      ev({ fdiNo: 11, id: 'd' }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 36)!.eventCount).toBe(3);
    expect(chart.teeth.find((t) => t.fdiNo === 11)!.eventCount).toBe(1);
  });

  it('returns teeth in ascending FDI order regardless of input order', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 48, id: 'a' }), ev({ fdiNo: 11, id: 'b' }), ev({ fdiNo: 36, id: 'c' }),
    ]);
    expect(chart.teeth.map((t) => t.fdiNo)).toEqual([11, 36, 48]);
  });

  it('reports an EMPTY chart for a patient with no events — not 32 healthy teeth', () => {
    /* "Not examined" is not "no disease". The UI must be able to tell them apart. */
    const chart = continuousChart('p1', []);
    expect(chart.teeth).toEqual([]);
    expect(chart.chartedCount).toBe(0);
    expect(chart.lastRecordedAt).toBeNull();
  });

  it('carries the audit handle: encounter and doctor of the LATEST event', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 36, id: 'a', encounterId: 'enc-old', doctorId: 'doc-old', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', encounterId: 'enc-new', doctorId: 'doc-new', updatedAt: '2026-05-01T00:00:00Z' }),
    ]);
    const t = chart.teeth[0]!;
    expect(t.encounterId).toBe('enc-new');
    expect(t.doctorId).toBe('doc-new');
  });

  it('carries the symbol code through, defaulting to null', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 46, id: 'a', condition: 'missing', symbolCode: 'extracted' }),
      ev({ fdiNo: 47, id: 'b', condition: 'missing' }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 46)!.symbolCode).toBe('extracted');
    expect(chart.teeth.find((t) => t.fdiNo === 47)!.symbolCode).toBeNull();
  });

  it('reports the most recent activity across the whole mouth', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 11, id: 'a', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', updatedAt: '2026-09-01T00:00:00Z' }),
      ev({ fdiNo: 47, id: 'c', updatedAt: '2026-05-01T00:00:00Z' }),
    ]);
    expect(new Date(chart.lastRecordedAt as string).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('tolerates any input order — correctness must not depend on the SQL ORDER BY', () => {
    const events = [
      ev({ fdiNo: 36, id: 'a', condition: 'decayed', updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 11, id: 'b', condition: 'filled', updatedAt: '2026-02-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'c', condition: 'crowned', updatedAt: '2026-07-01T00:00:00Z' }),
      ev({ fdiNo: 11, id: 'd', condition: 'healthy', updatedAt: '2026-03-01T00:00:00Z' }),
    ];
    const forward = continuousChart('p', events);
    const reversed = continuousChart('p', [...events].reverse());
    const mixed = continuousChart('p', [events[2]!, events[0]!, events[3]!, events[1]!]);
    const shape = (c: typeof forward) => c.teeth.map((t) => `${t.fdiNo}:${t.condition}`);
    expect(shape(reversed)).toEqual(shape(forward));
    expect(shape(mixed)).toEqual(shape(forward));
  });
});

describe('tooth chart — summary', () => {
  it('counts by condition', () => {
    const chart = continuousChart('p', [
      ev({ fdiNo: 11, id: 'a', condition: 'healthy' }),
      ev({ fdiNo: 12, id: 'b', condition: 'healthy' }),
      ev({ fdiNo: 36, id: 'c', condition: 'decayed' }),
      ev({ fdiNo: 46, id: 'd', condition: 'missing', symbolCode: 'extracted' }),
    ]);
    expect(conditionCounts(chart)).toEqual({ healthy: 2, decayed: 1, missing: 1 });
  });

  it('NAMES the teeth needing attention, worst first', () => {
    /* "4 teeth need attention" makes a dentist hunt; naming them is the value. */
    const chart = continuousChart('p', [
      ev({ fdiNo: 11, id: 'a', condition: 'healthy' }),
      ev({ fdiNo: 46, id: 'b', condition: 'missing', symbolCode: 'extracted' }),
      ev({ fdiNo: 36, id: 'c', condition: 'decayed' }),
      ev({ fdiNo: 14, id: 'd', condition: 'crowned' }),
      ev({ fdiNo: 22, id: 'e', condition: 'filled', symbolCode: 'periapical' }),
    ]);
    const teeth = teethNeedingAttention(chart);
    expect(teeth).toEqual([36, 22, 14]); /* decayed first, then periapical, then crowned */
    expect(teeth).not.toContain(11);     /* healthy is not "attention" */
    expect(teeth).not.toContain(46);     /* extracted is resolved, not pending */
  });

  it('returns nothing for an empty or fully-healthy mouth', () => {
    expect(teethNeedingAttention(continuousChart('p', []))).toEqual([]);
    expect(teethNeedingAttention(continuousChart('p', [
      ev({ fdiNo: 11, id: 'a', condition: 'healthy' }),
    ]))).toEqual([]);
  });

  it('lets a SYMBOL raise attention even when the condition is benign', () => {
    /* missing + mobility: the tooth is gone but the cause still matters. */
    const chart = continuousChart('p', [
      ev({ fdiNo: 31, id: 'a', condition: 'missing', symbolCode: 'mobility' }),
    ]);
    expect(teethNeedingAttention(chart)).toEqual([31]);
  });
});

describe('writable conditions', () => {
  it('is exactly the enum, not a second list that can drift', () => {
    expect(WRITABLE_CONDITIONS).toEqual([
      'healthy', 'decayed', 'filled', 'missing', 'crowned', 'root_canal', 'implant',
    ]);
    expect(WRITABLE_CONDITIONS).toHaveLength(7);
  });
});
