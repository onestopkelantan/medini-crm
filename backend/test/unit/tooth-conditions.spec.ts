import { describe, it, expect } from 'vitest';
import {
  TOOTH_CONDITIONS, DEFAULT_CHART_SYMBOLS, CONDITION_APPEARANCE, SYMBOL_MARKS,
  resolveToothAppearance, normaliseSymbolCode, findSymbolCollision,
  isDeletableSymbol, MAX_SYMBOL_CODE_LENGTH,
} from '@modules/clinical/domain/tooth-conditions';

describe('tooth conditions — the 7 immutable enum values', () => {
  it('is exactly the set the database enum carries', () => {
    expect(TOOTH_CONDITIONS).toHaveLength(7);
    expect(TOOTH_CONDITIONS).toEqual([
      'healthy', 'decayed', 'filled', 'missing', 'crowned', 'root_canal', 'implant',
    ]);
  });

  it('has an appearance for every condition, with a real colour', () => {
    for (const c of TOOTH_CONDITIONS) {
      const a = CONDITION_APPEARANCE[c];
      expect(a).toBeDefined();
      expect(a.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(SYMBOL_MARKS).toContain(a.mark);
    }
  });
});

describe('chart symbols — the 7 shipped defaults', () => {
  it('ships exactly the 7 distinctions the enum could not express', () => {
    expect(DEFAULT_CHART_SYMBOLS.map((s) => s.code).sort()).toEqual([
      'bridge', 'denture', 'extracted', 'impacted', 'mobility', 'periapical', 'veneer',
    ]);
  });

  it('every default is valid: colour, mark, order, built-in flag', () => {
    for (const s of DEFAULT_CHART_SYMBOLS) {
      expect(s.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(SYMBOL_MARKS).toContain(s.mark);
      expect(s.sortOrder).toBeGreaterThan(0);
      expect(s.isBuiltIn).toBe(true);
    }
  });

  it('has no duplicate codes and a deterministic display order', () => {
    const codes = DEFAULT_CHART_SYMBOLS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    const orders = DEFAULT_CHART_SYMBOLS.map((s) => s.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('uses a distinct colour per symbol, and none collides with a condition colour', () => {
    const symbolColours = DEFAULT_CHART_SYMBOLS.map((s) => s.colour);
    expect(new Set(symbolColours).size).toBe(symbolColours.length);

    const conditionColours = new Set(Object.values(CONDITION_APPEARANCE).map((c) => c.colour));
    for (const c of symbolColours) {
      expect(conditionColours.has(c)).toBe(false);
    }
  });
});

describe('resolveToothAppearance — how one tooth is drawn', () => {
  it('draws the condition when no symbol is set', () => {
    const a = resolveToothAppearance({ condition: 'decayed' });
    expect(a.colour).toBe(CONDITION_APPEARANCE.decayed.colour);
    expect(a.symbolCode).toBeNull();
  });

  it('lets a SYMBOL WIN over the condition — the more specific fact is shown', () => {
    /* 46 is missing BECAUSE it was extracted. The chart must say "extracted". */
    const a = resolveToothAppearance({ condition: 'missing', symbolCode: 'extracted' });
    expect(a.symbolCode).toBe('extracted');
    expect(a.colour).toBe('#111827');
    expect(a.colour).not.toBe(CONDITION_APPEARANCE.missing.colour);
  });

  it('falls back to the condition for an unknown symbol — never throws', () => {
    const a = resolveToothAppearance({ condition: 'crowned', symbolCode: 'symbol_the_clinic_removed' });
    expect(a.symbolCode).toBeNull();
    expect(a.colour).toBe(CONDITION_APPEARANCE.crowned.colour);
  });

  it('treats an empty symbol code as no symbol at all', () => {
    expect(resolveToothAppearance({ condition: 'filled', symbolCode: '' }).symbolCode).toBeNull();
    expect(resolveToothAppearance({ condition: 'filled', symbolCode: null }).symbolCode).toBeNull();
  });

  it('falls back to healthy for an unknown condition', () => {
    expect(resolveToothAppearance({ condition: 'something_removed' }).colour)
      .toBe(CONDITION_APPEARANCE.healthy.colour);
  });

  it('honours a clinic-defined symbol list', () => {
    const custom = [
      { code: 'implant_failed', label: 'Failed implant', colour: '#ff00ff', mark: 'dot' as const, sortOrder: 5, isBuiltIn: false },
    ];
    const a = resolveToothAppearance({ condition: 'implant', symbolCode: 'implant_failed' }, custom);
    expect(a.colour).toBe('#ff00ff');
    expect(a.mark).toBe('dot');
  });
});

describe('symbol codes — normalisation and collision', () => {
  it('normalises case, spaces and punctuation to one storable slug', () => {
    expect(normaliseSymbolCode('Bridge')).toBe('bridge');
    expect(normaliseSymbolCode('  Root Canal  ')).toBe('root_canal');
    expect(normaliseSymbolCode('crown-porcelain')).toBe('crown_porcelain');
    expect(normaliseSymbolCode('a---b')).toBe('a_b');
  });

  it('returns null for input that normalises to nothing — reject, do not store blank', () => {
    expect(normaliseSymbolCode('   ')).toBeNull();
    expect(normaliseSymbolCode('---')).toBeNull();
    expect(normaliseSymbolCode(123)).toBeNull();
    expect(normaliseSymbolCode(null)).toBeNull();
    expect(normaliseSymbolCode(undefined)).toBeNull();
  });

  it('caps length instead of storing an over-long code', () => {
    const long = normaliseSymbolCode('x'.repeat(200));
    expect(long).not.toBeNull();
    expect(long!.length).toBe(MAX_SYMBOL_CODE_LENGTH);
  });

  it('detects a collision through DIFFERENT spellings of the same code', () => {
    /* Without normalising both sides, "Bridge" and "bridge" become two symbols
     * that draw identically — a duplicate the clinic can see but not explain. */
    const existing = [{ code: 'bridge', label: 'Bridge', colour: '#16a34a', mark: 'bar' as const, sortOrder: 30, isBuiltIn: true }];
    expect(findSymbolCollision({ code: 'Bridge' }, existing)).not.toBeNull();
    expect(findSymbolCollision({ code: ' BRIDGE ' }, existing)).not.toBeNull();
    expect(findSymbolCollision({ code: 'veneer' }, existing)).toBeNull();
  });

  it('lets a symbol be re-saved without colliding with itself', () => {
    const existing = [{ id: 'abc', code: 'bridge', label: 'Bridge', colour: '#16a34a', mark: 'bar' as const, sortOrder: 30, isBuiltIn: true }];
    expect(findSymbolCollision({ id: 'abc', code: 'bridge' }, existing)).toBeNull();
    expect(findSymbolCollision({ id: 'xyz', code: 'bridge' }, existing)).not.toBeNull();
  });

  it('ignores a code that normalises to nothing rather than reporting a collision', () => {
    const existing = [{ code: 'bridge', label: 'Bridge', colour: '#16a34a', mark: 'bar' as const, sortOrder: 30, isBuiltIn: true }];
    expect(findSymbolCollision({ code: '  ' }, existing)).toBeNull();
  });
});

describe('built-in symbols are protected from deletion', () => {
  it('refuses to delete a built-in — historical charts still draw it', () => {
    for (const s of DEFAULT_CHART_SYMBOLS) {
      expect(isDeletableSymbol(s)).toBe(false);
    }
  });

  it('allows a clinic-defined symbol to be deleted', () => {
    expect(isDeletableSymbol({
      code: 'my_symbol', label: 'Mine', colour: '#123456',
      mark: 'dot', sortOrder: 99, isBuiltIn: false,
    })).toBe(true);
  });
});
