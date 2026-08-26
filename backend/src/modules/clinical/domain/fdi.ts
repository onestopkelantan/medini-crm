/**
 * FDI World Dental Federation notation — PERMANENT dentition only (Sprint 3).
 * Deciduous (5x–8x) is deliberately out of scope for v1 (documented debt).
 * Quadrants: 1x upper-right, 2x upper-left, 3x lower-left, 4x lower-right.
 * Pure & deterministic.
 */
export const VALID_FDI: ReadonlySet<number> = new Set([
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]);

export function isValidFdi(n: number): boolean {
  return Number.isInteger(n) && VALID_FDI.has(n);
}

/** Coerce a client value (number or numeric string like "36") to a valid FDI. */
export function parseFdi(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d{2}$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof n === 'number' && isValidFdi(n) ? n : null;
}
