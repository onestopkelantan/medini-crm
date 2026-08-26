/**
 * Phone normalization — Malaysian mobile semantics (locked for Sprint 2).
 *
 * Rule: strip all non-digits, drop a single leading country code `60` or a
 * single leading trunk `0`, and compare the remaining 9–10 digit subscriber
 * number. This makes `0123456789`, `+60123456789`, and `60123456789`
 * equivalent for duplicate detection.
 *
 * Returns null when the input has too few digits to be a real number
 * (never throws — normalization failure must not crash registration).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('60')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  if (d.length < 8 || d.length > 10) return null;
  return d;
}
