import { describe, it, expect } from 'vitest';
import { normalizePhone } from '@modules/patients/domain/phone';

describe('normalizePhone — Malaysian mobile semantics', () => {
  it('treats 0123456789, +60123456789, 60123456789 as the same subscriber', () => {
    const a = normalizePhone('0123456789');
    const b = normalizePhone('+60123456789');
    const c = normalizePhone('60123456789');
    expect(a).toBe('123456789');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('strips spaces/dashes/whitespace', () => {
    expect(normalizePhone(' 012-345 6789 ')).toBe('123456789');
  });

  it('returns null for empty/undefined/null', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for too-short numbers', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('012')).toBeNull();
  });

  it('keeps landline-style numbers with leading area code intact', () => {
    expect(normalizePhone('0312345678')).toBe('312345678');
    expect(normalizePhone('0312345678')).toBe(normalizePhone('+60312345678'));
  });
});
