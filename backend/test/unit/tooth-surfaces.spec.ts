import { describe, it, expect } from 'vitest';
import {
  continuousChart, normalizeSurfaces, CANONICAL_SURFACES, type ToothEvent,
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
 * Surface charting — the surfaces column has existed in the database since
 * Fasa 1B (the demo rows carry ["O"], ["O","M"]), but the read side never
 * carried it out: ToothEvent had no field, so `GET /patients/:id/chart`
 * returned teeth the UI could only paint whole. These tests pin the read
 * contract that unblocks the per-surface odontogram.
 *
 * The vocabulary rule is the load-bearing part. The column is JSON — a
 * foreign writer or a legacy bug can put ANYTHING in it — so `normalizeSurfaces`
 * decides, once, at the boundary between the database and the chart:
 *
 *   - only the five canonical letters survive (a chart cannot draw a surface
 *     that does not exist on a tooth);
 *   - case and padding are forgiven ("o " is O — humans type);
 *   - duplicates collapse, order preserved (["O","M","O"] is ["O","M"]);
 *   - anything else, or nothing at all, means NULL = whole tooth — the
 *     conservative rendering, never a crash on a clinical screen.
 */
describe('normalizeSurfaces — the boundary between JSON and the chart', () => {
  it('keeps the five canonical letters, in the order given', () => {
    expect(normalizeSurfaces(['O', 'M'])).toEqual(['O', 'M']);
    expect(normalizeSurfaces(['M', 'O', 'D', 'B', 'L'])).toEqual(['M', 'O', 'D', 'B', 'L']);
  });

  it('forgives case and surrounding whitespace', () => {
    expect(normalizeSurfaces(['o', ' m '])).toEqual(['O', 'M']);
  });

  it('collapses duplicates, keeping first occurrence', () => {
    expect(normalizeSurfaces(['O', 'M', 'O'])).toEqual(['O', 'M']);
  });

  it('drops letters a tooth does not have', () => {
    /* "X", "P", "I" are NOT canonical: P/I are CONTEXT-SUAL display forms of
     * L/O (palatal on uppers, incisal on anteriors) — the stored value stays
     * canonical and the UI translates for the dentist. Storing "P" would make
     * the same mouth render differently on two screens. */
    expect(normalizeSurfaces(['O', 'X', 'P', 'I'])).toEqual(['O']);
  });

  it('null for anything that is not an array', () => {
    expect(normalizeSurfaces(null)).toBeNull();
    expect(normalizeSurfaces(undefined)).toBeNull();
    expect(normalizeSurfaces('O')).toBeNull();
    expect(normalizeSurfaces({ 0: 'O' })).toBeNull();
  });

  it('null for an empty array or an array with no canonical letter', () => {
    /* Whole tooth, not "no surfaces charted": an empty value must read as the
     * whole tooth carrying the condition, which is how every pre-surface row
     * (all of Fasa 1B) already renders. */
    expect(normalizeSurfaces([])).toBeNull();
    expect(normalizeSurfaces(['x', 'y'])).toBeNull();
  });

  it('non-string entries are ignored, not fatal', () => {
    expect(normalizeSurfaces(['O', 5, null, 'M'] as unknown[])).toEqual(['O', 'M']);
  });

  it('exports the canonical vocabulary in picker order', () => {
    expect([...CANONICAL_SURFACES]).toEqual(['M', 'O', 'D', 'B', 'L']);
  });
});

describe('continuousChart — surfaces on the reduced chart', () => {
  it('carries the latest event\'s surfaces to the tooth', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 16, id: 'a', condition: 'decayed', surfaces: ['O'], updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 16, id: 'b', condition: 'decayed', surfaces: ['O', 'M'], updatedAt: '2026-02-01T00:00:00Z' }),
    ]);
    const t16 = chart.teeth.find((t) => t.fdiNo === 16)!;
    expect(t16.condition).toBe('decayed');
    expect(t16.surfaces).toEqual(['O', 'M']);
  });

  it('null surfaces when the event carried none (whole tooth)', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 18, id: 'a', condition: 'missing', surfaces: null }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 18)!.surfaces).toBeNull();
  });

  it('normalizes garbage from the JSON column instead of passing it through', () => {
    const chart = continuousChart('p1', [
      ev({ fdiNo: 26, id: 'a', condition: 'filled', surfaces: ['O', 'wat', ''] as unknown as string[] }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 26)!.surfaces).toEqual(['O']);
  });

  it('a later whole-tooth record clears the surfaces of an earlier surfaced one', () => {
    /* The reduction is by tooth, latest wins — surfaces are part of that
     * winning event, not merged across events. A crown placed over a previously
     * charted occlusal caries replaces the surface detail, it does not stack. */
    const chart = continuousChart('p1', [
      ev({ fdiNo: 36, id: 'a', condition: 'decayed', surfaces: ['O'], updatedAt: '2026-01-01T00:00:00Z' }),
      ev({ fdiNo: 36, id: 'b', condition: 'crowned', surfaces: null, updatedAt: '2026-06-01T00:00:00Z' }),
    ]);
    expect(chart.teeth.find((t) => t.fdiNo === 36)!.surfaces).toBeNull();
  });
});
