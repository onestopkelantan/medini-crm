import { describe, it, expect } from 'vitest';
import { isValidFdi, parseFdi, VALID_FDI } from '@modules/clinical/domain/fdi';

describe('FDI notation (Sprint 3 S3-B — permanent dentition only)', () => {
  it('contains exactly the 32 permanent teeth', () => {
    expect(VALID_FDI.size).toBe(32);
    expect(isValidFdi(11)).toBe(true);  /* upper-right central incisor */
    expect(isValidFdi(18)).toBe(true);  /* upper-right third molar */
    expect(isValidFdi(28)).toBe(true);
    expect(isValidFdi(36)).toBe(true);  /* lower-left first molar */
    expect(isValidFdi(48)).toBe(true);
  });

  it('rejects non-existent teeth (x9, x0, wrong quadrant)', () => {
    expect(isValidFdi(19)).toBe(false);
    expect(isValidFdi(10)).toBe(false);
    expect(isValidFdi(20)).toBe(false);
    expect(isValidFdi(51)).toBe(false); /* deciduous — out of scope v1 */
    expect(isValidFdi(85)).toBe(false);
    expect(isValidFdi(0)).toBe(false);
    expect(isValidFdi(99)).toBe(false);
    expect(isValidFdi(-11)).toBe(false);
    expect(isValidFdi(11.5)).toBe(false);
  });

  it('parseFdi coerces 2-digit strings and rejects garbage', () => {
    expect(parseFdi('36')).toBe(36);
    expect(parseFdi(36)).toBe(36);
    expect(parseFdi('19')).toBeNull();
    expect(parseFdi('abc')).toBeNull();
    expect(parseFdi('3')).toBeNull();
    expect(parseFdi(null)).toBeNull();
    expect(parseFdi(undefined)).toBeNull();
  });
});
