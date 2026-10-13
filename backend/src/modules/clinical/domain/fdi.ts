/**
 * FDI World Dental Federation notation — BOTH dentitions (Fasa 1A).
 *
 * Permanent  : quadrants 1–4, positions 1–8  → 11–48 (32 teeth)
 * Deciduous  : quadrants 5–8, positions 1–5  → 51–85 (20 teeth)
 *
 * Quadrant grid (patient's own left/right, as every dental chart is drawn):
 *   1x upper-right   2x upper-left
 *   4x lower-right   3x lower-left
 *   5x upper-right   6x upper-left   (deciduous)
 *   8x lower-right   7x lower-left   (deciduous)
 *
 * WHY DECIDUOUS WAS ADDED (Fasa 1A)
 * The v1 module declared 5x–8x "deliberately out of scope" — which meant no
 * child could be charted at all: a 5-year-old's mouth has no 11–48 in it yet.
 * A chart that cannot represent a primary dentition cannot record a paediatric
 * patient, and paediatrics is a normal part of this clinic's day.
 *
 * Pure & deterministic — no database, no clock.
 */

/* ------------------------------------------------------------------ sets */

/** Permanent dentition — 32 teeth (11–48). Historic name kept: callers and
 * tests refer to it, and it has always meant exactly this set. */
export const VALID_FDI: ReadonlySet<number> = new Set([
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]);

/** Deciduous (primary) dentition — 20 teeth, positions 1–5 only (51–85).
 * A primary arch carries no premolars and no third molar, so positions 6–8 are
 * NOT valid here; accepting them would let a chart hold a tooth that cannot
 * exist, which is worse than rejecting it. */
export const VALID_FDI_DECIDUOUS: ReadonlySet<number> = new Set([
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
]);

/** Both dentitions — what one mouth can hold at mixed dentition (≈6–12y). */
export const VALID_FDI_ALL: ReadonlySet<number> = new Set([
  ...VALID_FDI, ...VALID_FDI_DECIDUOUS,
]);

export type Dentition = 'permanent' | 'deciduous';

/* ----------------------------------------------------------------- helpers */

export function isValidPermanentFdi(n: number): boolean {
  return Number.isInteger(n) && VALID_FDI.has(n);
}

export function isValidDeciduousFdi(n: number): boolean {
  return Number.isInteger(n) && VALID_FDI_DECIDUOUS.has(n);
}

/** Any real tooth, either dentition. */
export function isValidFdi(n: number): boolean {
  return Number.isInteger(n) && VALID_FDI_ALL.has(n);
}

/** Which dentition a tooth number belongs to. Null for a non-tooth. */
export function dentitionOf(fdi: number): Dentition | null {
  if (isValidPermanentFdi(fdi)) return 'permanent';
  if (isValidDeciduousFdi(fdi)) return 'deciduous';
  return null;
}

/** Quadrant digit: 1–4 permanent, 5–8 deciduous. Null for a non-tooth. */
export function quadrantOf(fdi: number): number | null {
  return isValidFdi(fdi) ? Math.floor(fdi / 10) : null;
}

/** Position within the arch, 1..8 (permanent) or 1..5 (deciduous). */
export function positionOf(fdi: number): number | null {
  return isValidFdi(fdi) ? fdi % 10 : null;
}

/** Arch: maxillary (upper) for quadrants 1,2,5,6; mandibular for 3,4,7,8. */
export function archOf(fdi: number): 'upper' | 'lower' | null {
  const q = quadrantOf(fdi);
  if (q == null) return null;
  return q === 1 || q === 2 || q === 5 || q === 6 ? 'upper' : 'lower';
}

/** The patient's own side. `right` = quadrants 1,4,5,8; `left` = 2,3,6,7. */
export function sideOf(fdi: number): 'right' | 'left' | null {
  const q = quadrantOf(fdi);
  if (q == null) return null;
  return q === 1 || q === 4 || q === 5 || q === 8 ? 'right' : 'left';
}

/**
 * The normal counterpart of a tooth in the other dentition, if one exists.
 *
 * Used when a chart switches between dentitions and a doctor wants the same
 * POSITION on screen: 55 (upper-right second primary molar) sits where 15
 * (upper-right second premolar) will eventually erupt. Positions 6–8 have no
 * primary counterpart — mapping 16 → 56 would invent a tooth that never exists.
 */
export function permanentCounterpartOf(fdi: number): number | null {
  if (isValidDeciduousFdi(fdi)) return fdi - 40;
  return isValidPermanentFdi(fdi) ? fdi : null;
}

export function deciduousCounterpartOf(fdi: number): number | null {
  if (!isValidPermanentFdi(fdi)) return isValidDeciduousFdi(fdi) ? fdi : null;
  const pos = fdi % 10;
  if (pos > 5) return null; /* no primary premolar (4) or molar 6–8 at this position */
  const q = Math.floor(fdi / 10);
  const qMap: Record<number, number> = { 1: 5, 2: 6, 3: 7, 4: 8 };
  return (qMap[q] ?? 0) * 10 + pos;
}

/* ---------------------------------------------------------------- parsing */

/**
 * Coerce a client value (number or 2-digit numeric string like "36") to a valid
 * FDI tooth for the requested dentition.
 *
 * `dentition` defaults to `'permanent'` so an existing call site that says
 * nothing keeps its old, narrower meaning — accepting a deciduous number by
 * accident is how a chart ends up holding a tooth the UI cannot draw.
 */
export function parseFdi(value: unknown, dentition: Dentition | 'any' = 'permanent'): number | null {
  const n =
    typeof value === 'string' && /^\d{2}$/.test(value.trim())
      ? Number(value.trim())
      : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  if (dentition === 'permanent') return isValidPermanentFdi(n) ? n : null;
  if (dentition === 'deciduous') return isValidDeciduousFdi(n) ? n : null;
  return isValidFdi(n) ? n : null;
}

/* --------------------------------------------------- paediatric age rules */

/**
 * The dentition to EXPECT for a patient of a given age, or null when age is
 * unknown.
 *
 * This returns an expectation, NOT a permission. Primary teeth erupt from about
 * 6 months and the last sheds around 12, so:
 *   under 6   → deciduous only
 *   6 to 12   → mixed; either dentition is legitimate
 *   13 and up → permanent only (a retained primary tooth after 13 is possible,
 *               so the CALLER decides whether to block or flag — see
 *               `toothPlausibleForAge`, which only ever reports "implausible")
 */
export function expectedDentition(ageYears: number | null): Dentition | 'mixed' | null {
  if (ageYears == null || !Number.isFinite(ageYears) || ageYears < 0) return null;
  if (ageYears < 6) return 'deciduous';
  if (ageYears <= 12) return 'mixed';
  return 'permanent';
}

/**
 * Is this tooth plausible for a patient of this age?
 *
 * ADVISORY, not a gate. It answers only "is this worth a second look", because
 * the exceptions are real and clinical: a 3-year-old can have a natal tooth, a
 * 14-year-old can retain a primary molar, and an adult can present with a
 * primary tooth still in place. Blocking on this rule would refuse correct
 * clinical records, so the caller decides — flag for the doctor to confirm, do
 * not silently reject.
 *
 * Unknown age → always plausible. Never guess age into a block.
 */
export function toothPlausibleForAge(fdi: number, ageYears: number | null): boolean {
  if (!isValidFdi(fdi)) return false;
  const expected = expectedDentition(ageYears);
  if (expected == null || expected === 'mixed') return true;
  const actual = dentitionOf(fdi);
  return actual === expected;
}

/** Whole years between a date of birth and a reference date (default: now).
 * Null when the input is unusable, so a missing DOB can never be read as age 0. */
export function ageYearsFrom(dob: string | Date | null | undefined, at: Date = new Date()): number | null {
  if (dob == null) return null;
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > at.getTime()) return null; /* future DOB is bad data, not age -1 */
  let age = at.getFullYear() - d.getFullYear();
  const beforeBirthday =
    at.getMonth() < d.getMonth() ||
    (at.getMonth() === d.getMonth() && at.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}
