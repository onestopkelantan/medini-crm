import { describe, it, expect } from 'vitest';
import { normalizePayorName } from '@modules/payors/domain/normalize-name';

describe('normalizePayorName (Sprint 2A T2)', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizePayorName(' AIA PANEL ')).toBe('AIA PANEL');
  });

  it('collapses repeated internal whitespace', () => {
    expect(normalizePayorName(' AIA   PANEL ')).toBe('AIA PANEL');
    expect(normalizePayorName('Med  \t Kad')).toBe('Med Kad');
  });

  it('preserves case (display name untouched — case handled by DB lower() index)', () => {
    expect(normalizePayorName('aia panel')).toBe('aia panel');
    expect(normalizePayorName('AIA PANEL')).toBe('AIA PANEL');
    expect(normalizePayorName('Aia Panel')).toBe('Aia Panel');
  });

  it('returns null for empty and whitespace-only input (never throws)', () => {
    expect(normalizePayorName('')).toBeNull();
    expect(normalizePayorName('   ')).toBeNull();
    expect(normalizePayorName(null)).toBeNull();
    expect(normalizePayorName(undefined)).toBeNull();
  });

  it('passes through normal Malaysian/Unicode names unchanged apart from whitespace', () => {
    expect(normalizePayorName('TuneProtect')).toBe('TuneProtect');
    expect(normalizePayorName('Syarikat Takaful Malaysia Berhad')).toBe('Syarikat Takaful Malaysia Berhad');
  });

  it('does NOT do fuzzy matching or transliteration (deterministic rule only)', () => {
    /* different characters stay different — duplicate equality is exact-after-normalize */
    expect(normalizePayorName('MedKad')).not.toBe(normalizePayorName('Med Kad'));
  });
});
