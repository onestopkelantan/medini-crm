import { describe, it, expect } from 'vitest';
import { periodWindow } from '../../src/modules/finance/domain/period-window';

/**
 * P2 — the commission period window.
 *
 * The window decides WHICH charges a doctor's commission is computed from, so
 * an off-by-one here silently pays the wrong amount. These are pure assertions:
 * no database, so they ALWAYS run and can always fail.
 */
describe('periodWindow — YYYY-MM becomes a half-open month window', () => {
  it('turns 2026-10 into [2026-10-01, 2026-11-01)', () => {
    expect(periodWindow('2026-10')).toEqual({ from: '2026-10-01', to: '2026-11-01' });
  });

  it('rolls December into January of the NEXT year', () => {
    expect(periodWindow('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('pads a single-digit month correctly', () => {
    expect(periodWindow('2026-01')).toEqual({ from: '2026-01-01', to: '2026-02-01' });
    expect(periodWindow('2026-09')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
  });

  it('rejects an out-of-range month rather than shifting the window', () => {
    expect(periodWindow('2026-00')).toBeNull();
    expect(periodWindow('2026-13')).toBeNull();
    expect(periodWindow('2026-99')).toBeNull();
  });

  it('returns null for a non-YYYY-MM period (caller then sums ALL TIME)', () => {
    /* Deliberate: '2026-Q3', a range, or a rolling window must not be rejected —
     * it falls back to the lifetime figure until the format is defined. */
    expect(periodWindow('2026-Q3')).toBeNull();
    expect(periodWindow('2026-10-01..2026-10-15')).toBeNull();
    expect(periodWindow('lifetime')).toBeNull();
    expect(periodWindow('')).toBeNull();
    expect(periodWindow(null)).toBeNull();
    expect(periodWindow(undefined)).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(periodWindow('  2026-10 ')).toEqual({ from: '2026-10-01', to: '2026-11-01' });
  });
});
