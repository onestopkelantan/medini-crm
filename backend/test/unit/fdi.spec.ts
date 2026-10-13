import { describe, it, expect } from 'vitest';
import {
  isValidPermanentFdi, isValidDeciduousFdi, parseFdi,
  VALID_FDI, VALID_FDI_DECIDUOUS, VALID_FDI_ALL,
  dentitionOf, quadrantOf, positionOf, archOf, sideOf,
  permanentCounterpartOf, deciduousCounterpartOf,
  expectedDentition, toothPlausibleForAge, ageYearsFrom,
} from '@modules/clinical/domain/fdi';

describe('FDI notation — permanent dentition (unchanged contract)', () => {
  it('contains exactly the 32 permanent teeth', () => {
    expect(VALID_FDI.size).toBe(32);
    expect(isValidPermanentFdi(11)).toBe(true);
    expect(isValidPermanentFdi(18)).toBe(true);
    expect(isValidPermanentFdi(28)).toBe(true);
    expect(isValidPermanentFdi(36)).toBe(true);
    expect(isValidPermanentFdi(48)).toBe(true);
  });

  it('rejects non-existent permanent teeth (x9, x0)', () => {
    expect(isValidPermanentFdi(19)).toBe(false);
    expect(isValidPermanentFdi(10)).toBe(false);
    expect(isValidPermanentFdi(20)).toBe(false);
    expect(isValidPermanentFdi(0)).toBe(false);
    expect(isValidPermanentFdi(99)).toBe(false);
    expect(isValidPermanentFdi(-11)).toBe(false);
    expect(isValidPermanentFdi(11.5)).toBe(false);
  });
});

describe('FDI notation — deciduous dentition (Fasa 1A)', () => {
  it('contains exactly the 20 primary teeth, positions 1–5 only', () => {
    expect(VALID_FDI_DECIDUOUS.size).toBe(20);
    expect(isValidDeciduousFdi(51)).toBe(true);  /* upper-right central primary incisor */
    expect(isValidDeciduousFdi(55)).toBe(true);  /* upper-right second primary molar */
    expect(isValidDeciduousFdi(65)).toBe(true);
    expect(isValidDeciduousFdi(75)).toBe(true);
    expect(isValidDeciduousFdi(85)).toBe(true);  /* lower-right second primary molar */
  });

  it('REFUSES positions 6–8 in a primary quadrant — they cannot exist', () => {
    /* A primary arch has no premolars and no third molar. Accepting 56 would let
     * a chart hold a tooth that is not a tooth. */
    expect(isValidDeciduousFdi(56)).toBe(false);
    expect(isValidDeciduousFdi(57)).toBe(false);
    expect(isValidDeciduousFdi(58)).toBe(false);
    expect(isValidDeciduousFdi(86)).toBe(false);
    expect(isValidDeciduousFdi(60)).toBe(false);
    expect(isValidDeciduousFdi(50)).toBe(false);
  });

  it('keeps the two dentitions disjoint — no tooth is in both', () => {
    const overlap = [...VALID_FDI].filter((n) => VALID_FDI_DECIDUOUS.has(n));
    expect(overlap).toEqual([]);
    expect(VALID_FDI_ALL.size).toBe(52);
  });
});

describe('FDI parsing — dentition-aware, default stays narrow', () => {
  it('defaults to PERMANENT so existing callers keep their old meaning', () => {
    expect(parseFdi('36')).toBe(36);
    expect(parseFdi(36)).toBe(36);
    expect(parseFdi('55')).toBeNull();   /* deciduous refused when unspecified */
    expect(parseFdi('19')).toBeNull();
    expect(parseFdi('abc')).toBeNull();
    expect(parseFdi('3')).toBeNull();
    expect(parseFdi(null)).toBeNull();
    expect(parseFdi(undefined)).toBeNull();
  });

  it('accepts the requested dentition only', () => {
    expect(parseFdi('55', 'deciduous')).toBe(55);
    expect(parseFdi('36', 'deciduous')).toBeNull();
    expect(parseFdi('36', 'permanent')).toBe(36);
    expect(parseFdi('55', 'permanent')).toBeNull();
  });

  it("dentition 'any' accepts either — the mixed-dentition case", () => {
    expect(parseFdi('36', 'any')).toBe(36);
    expect(parseFdi('55', 'any')).toBe(55);
    expect(parseFdi('56', 'any')).toBeNull();  /* still not a tooth */
    expect(parseFdi('19', 'any')).toBeNull();
  });
});

describe('FDI geometry — quadrant, arch, side', () => {
  it('labels dentition, quadrant and position', () => {
    expect(dentitionOf(36)).toBe('permanent');
    expect(dentitionOf(75)).toBe('deciduous');
    expect(dentitionOf(19)).toBeNull();
    expect(quadrantOf(36)).toBe(3);
    expect(quadrantOf(75)).toBe(7);
    expect(quadrantOf(19)).toBeNull();
    expect(positionOf(36)).toBe(6);
    expect(positionOf(51)).toBe(1);
  });

  it('maps arch and side the way a chart is drawn', () => {
    expect(archOf(11)).toBe('upper');
    expect(archOf(48)).toBe('lower');
    expect(archOf(55)).toBe('upper');
    expect(archOf(85)).toBe('lower');
    expect(archOf(19)).toBeNull();

    expect(sideOf(11)).toBe('right');  /* patient's own right */
    expect(sideOf(21)).toBe('left');
    expect(sideOf(31)).toBe('left');
    expect(sideOf(41)).toBe('right');
    expect(sideOf(55)).toBe('right');
    expect(sideOf(75)).toBe('left');
  });
});

describe('FDI counterparts between dentitions', () => {
  it('maps a primary tooth to the permanent tooth in the same position', () => {
    expect(permanentCounterpartOf(55)).toBe(15);
    expect(permanentCounterpartOf(75)).toBe(35);
    expect(permanentCounterpartOf(85)).toBe(45);
  });

  it('REFUSES to invent a counterpart that cannot exist', () => {
    /* 16 is the first permanent molar — there is no 56 in the primary arch. */
    expect(deciduousCounterpartOf(16)).toBeNull();
    expect(deciduousCounterpartOf(17)).toBeNull();
    expect(deciduousCounterpartOf(28)).toBeNull();
  });

  it('round-trips within positions 1–5', () => {
    for (const perm of [11, 12, 13, 14, 15, 21, 25, 34, 45, 48]) {
      const dec = deciduousCounterpartOf(perm);
      if (dec != null) expect(permanentCounterpartOf(dec)).toBe(perm);
    }
    expect(deciduousCounterpartOf(1)).toBeNull(); /* not a tooth at all */
    expect(permanentCounterpartOf(99)).toBeNull();
  });
});

describe('FDI paediatric expectations', () => {
  it('expects the dentition the age implies', () => {
    expect(expectedDentition(2)).toBe('deciduous');
    expect(expectedDentition(5)).toBe('deciduous');
    expect(expectedDentition(6)).toBe('mixed');
    expect(expectedDentition(12)).toBe('mixed');
    expect(expectedDentition(13)).toBe('permanent');
    expect(expectedDentition(40)).toBe('permanent');
  });

  it('never guesses age into a verdict — unknown age gives no expectation', () => {
    expect(expectedDentition(null)).toBeNull();
    expect(expectedDentition(-1)).toBeNull();
    expect(expectedDentition(Number.NaN)).toBeNull();
    expect(toothPlausibleForAge(36, null)).toBe(true);
    expect(toothPlausibleForAge(75, null)).toBe(true);
  });

  it('flags an implausible tooth for a known age', () => {
    expect(toothPlausibleForAge(75, 3)).toBe(true);    /* primary tooth, toddler */
    expect(toothPlausibleForAge(36, 3)).toBe(false);   /* permanent molar, toddler */
    expect(toothPlausibleForAge(36, 30)).toBe(true);
    expect(toothPlausibleForAge(75, 30)).toBe(false);  /* retained primary, adult */
  });

  it('treats mixed dentition as always plausible — both arches are live', () => {
    expect(toothPlausibleForAge(36, 8)).toBe(true);
    expect(toothPlausibleForAge(75, 8)).toBe(true);
  });

  it('reports a non-tooth as implausible at any age', () => {
    expect(toothPlausibleForAge(19, 30)).toBe(false);
    expect(toothPlausibleForAge(56, 8)).toBe(false);
  });

  it('computes age in whole years, and refuses to read bad dates as age 0', () => {
    expect(ageYearsFrom('2000-01-01', new Date('2026-01-01'))).toBe(26);
    expect(ageYearsFrom('2000-06-15', new Date('2026-01-01'))).toBe(25); /* birthday not yet */
    expect(ageYearsFrom('2000-01-01T00:00:00Z', new Date('2026-01-01T12:00:00Z'))).toBe(26);
    expect(ageYearsFrom(null)).toBeNull();
    expect(ageYearsFrom('not-a-date')).toBeNull();
    expect(ageYearsFrom('2030-01-01', new Date('2026-01-01'))).toBeNull(); /* future DOB */
  });
});
