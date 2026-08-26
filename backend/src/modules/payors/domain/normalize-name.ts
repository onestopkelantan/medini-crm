/**
 * Payor name normalization — duplicate-detection comparison key (Sprint 2A T2).
 *
 * Contract:
 *   " AIA PANEL "   → "AIA PANEL"   (trim)
 *   " AIA   PANEL " → "AIA PANEL"   (collapse internal whitespace)
 *   "aia panel"     → "aia panel"   (case PRESERVED — display name untouched)
 *
 * Case-insensitivity for duplicate detection is handled at the DB layer by the
 * functional unique index (org_id, lower(name)) created in migration 0006 —
 * the same convention as patients_org_ic_uq. This function provides only the
 * deterministic whitespace rule; it is NOT search intelligence (no fuzzy
 * matching, no transliteration).
 *
 * Returns null when the input has no usable content (empty/whitespace-only) —
 * never throws; validation of required name lives in the service DTO (T3/T4).
 */
export function normalizePayorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}
