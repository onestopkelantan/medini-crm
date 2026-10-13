import { describe, it, expect } from 'vitest';

import { cleanDoctorName, matchDoctorName } from '@modules/ai-manager/domain/doctor-continuity';

/**
 * FASA 6B — resolving the doctor a PATIENT NAMED.
 *
 * WHY THE AMBIGUOUS CASE MATTERS MOST
 *
 * These tests are about a safety rule, not a convenience. When a patient writes
 * "nak Dr Siti" and the branch has TWO doctors named Siti, the code must return
 * nothing and let the AI ask again. The alternative — picking the first, the
 * closest, the alphabetically-earlier — books the patient with a stranger, which
 * is exactly the failure this whole feature exists to prevent.
 *
 * So the interesting assertions here are the ones that expect NULL.
 */

const BRANCH = [
  { doctorId: 'd-siti', doctorName: 'Dr. Siti Halim' },
  { doctorId: 'd-ahmad', doctorName: 'Dr. Ahmad Zaki' },
  { doctorId: 'd-aina', doctorName: 'Dr. Aina Rahman' },
];

describe('cleanDoctorName — forgiving about how a title is written', () => {
  it('drops "Dr." and punctuation', () => {
    expect(cleanDoctorName('Dr. Siti Halim')).toBe('siti halim');
  });

  it('drops "Dr" without a full stop', () => {
    expect(cleanDoctorName('Dr Siti')).toBe('siti');
  });

  it('drops the Malay "Doktor"', () => {
    expect(cleanDoctorName('Doktor Siti Halim')).toBe('siti halim');
  });

  it('is case-insensitive', () => {
    expect(cleanDoctorName('dR SiTi')).toBe('siti');
  });

  it('collapses extra spaces', () => {
    expect(cleanDoctorName('  Dr.   Siti   Halim  ')).toBe('siti halim');
  });

  it('handles an empty or missing value without throwing', () => {
    expect(cleanDoctorName('')).toBe('');
    expect(cleanDoctorName(undefined as unknown as string)).toBe('');
  });
});

describe('matchDoctorName — resolves exactly one, or nobody', () => {
  it('matches a bare first name', () => {
    expect(matchDoctorName(BRANCH, 'Dr Siti')?.doctorId).toBe('d-siti');
  });

  it('matches a full name', () => {
    expect(matchDoctorName(BRANCH, 'Dr. Siti Halim')?.doctorId).toBe('d-siti');
  });

  it('matches regardless of title style used by the patient', () => {
    expect(matchDoctorName(BRANCH, 'doktor siti')?.doctorId).toBe('d-siti');
    expect(matchDoctorName(BRANCH, 'siti')?.doctorId).toBe('d-siti');
  });

  it('matches when the patient writes the name with noise around it', () => {
    expect(matchDoctorName(BRANCH, 'nak Dr Siti please')?.doctorId).toBe('d-siti');
  });

  it('returns null for a name that is not in this branch', () => {
    expect(matchDoctorName(BRANCH, 'Dr. Lim')).toBeNull();
  });

  it('returns null for an empty or one-letter fragment', () => {
    expect(matchDoctorName(BRANCH, '')).toBeNull();
    expect(matchDoctorName(BRANCH, 'S')).toBeNull();
    expect(matchDoctorName(BRANCH, 'Dr')).toBeNull();
  });

  it('does NOT match on a surname — first names only', () => {
    /* "Halim" is Dr. Siti Halim's surname. A patient typing it is ambiguous at
     * best; matching it would be guessing. */
    expect(matchDoctorName(BRANCH, 'Halim')).toBeNull();
  });

  it('REFUSES when two doctors share the first name', () => {
    /* The case that matters. Two "Siti"s means we do not know which was meant,
     * and the cost of guessing is a wasted visit. */
    const twoSitis = [
      { doctorId: 'd-1', doctorName: 'Dr. Siti Halim' },
      { doctorId: 'd-2', doctorName: 'Dr. Siti Nurhaliza' },
    ];
    expect(matchDoctorName(twoSitis, 'Dr Siti')).toBeNull();
    expect(matchDoctorName(twoSitis, 'siti')).toBeNull();
  });

  it('still resolves when the patient gives enough to disambiguate', () => {
    const twoSitis = [
      { doctorId: 'd-1', doctorName: 'Dr. Siti Halim' },
      { doctorId: 'd-2', doctorName: 'Dr. Siti Nurhaliza' },
    ];
    /* Full name is unique — this is the escape hatch from ambiguity. */
    expect(matchDoctorName(twoSitis, 'Dr. Siti Nurhaliza')?.doctorId).toBe('d-2');
    expect(matchDoctorName(twoSitis, 'Dr. Siti Halim')?.doctorId).toBe('d-1');
  });

  it('returns null when the branch has no doctors', () => {
    expect(matchDoctorName([], 'Dr Siti')).toBeNull();
  });

  it('ignores candidate rows with a missing name', () => {
    const messy = [
      { doctorId: 'd-x', doctorName: '' },
      { doctorId: 'd-siti', doctorName: 'Dr. Siti Halim' },
    ];
    expect(matchDoctorName(messy, 'Dr Siti')?.doctorId).toBe('d-siti');
  });
});
