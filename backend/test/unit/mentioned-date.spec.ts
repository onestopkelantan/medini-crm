import { describe, it, expect } from 'vitest';

import { resolveMentionedDate } from '@modules/ai-manager/domain/mentioned-date';

/* TARIKH is a fixed "today" in ISO format so every case is deterministic
 * regardless of when the suite runs. 2026-10-02 is a FRIDAY. */
const TODAY = '2026-10-02';

describe('resolveMentionedDate — fail-closed date extraction from patient text', () => {
  it('returns null for text with no date mention', () => {
    expect(resolveMentionedDate('Salam, apa khabar?', TODAY)).toBeNull();
  });

  it('resolves "Sabtu" (the next Saturday) from a Friday', () => {
    expect(resolveMentionedDate('Sabtu pagi ada masa kosong?', TODAY)).toBe('2026-10-03');
  });

  it('resolves a weekday further ahead (wraps to next week)', () => {
    // From Friday 2026-10-02, "Rabu" is 2026-10-07 (next Wednesday).
    expect(resolveMentionedDate('Rabu boleh?', TODAY)).toBe('2026-10-07');
  });

  it('resolves "esok" (tomorrow)', () => {
    expect(resolveMentionedDate('Esok ada slot?', TODAY)).toBe('2026-10-03');
  });

  it('resolves "lusa" (day after tomorrow)', () => {
    expect(resolveMentionedDate('Lusa boleh datang', TODAY)).toBe('2026-10-04');
  });

  it('resolves "hari ini" (today) to TODAY itself', () => {
    expect(resolveMentionedDate('Hari ini ada masa?', TODAY)).toBe('2026-10-02');
  });

  it('resolves short-form date "27 Okt" to ISO', () => {
    expect(resolveMentionedDate('Nak tempah 27 Okt', TODAY)).toBe('2026-10-27');
  });

  it('resolves full ISO date in text', () => {
    expect(resolveMentionedDate('Boleh 2026-10-04?', TODAY)).toBe('2026-10-04');
  });

  it('returns null for an ISO-looking but INVALID date (fail-closed)', () => {
    expect(resolveMentionedDate('2026-13-45', TODAY)).toBeNull();
  });

  it('returns null for a month with no date ("Okt saja")', () => {
    expect(resolveMentionedDate('Mana-mana hari dalam Okt pun ok', TODAY)).toBeNull();
  });

  it('case-insensitive weekday ("SABTU ini")', () => {
    expect(resolveMentionedDate('SABTU ini boleh?', TODAY)).toBe('2026-10-03');
  });

  it('weekday with suffix "Sabtu ini" same as plain weekday', () => {
    expect(resolveMentionedDate('Sabtu ini saya datang', TODAY)).toBe('2026-10-03');
  });
});
