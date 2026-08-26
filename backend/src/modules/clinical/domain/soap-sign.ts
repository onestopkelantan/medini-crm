/**
 * SOAP note rules (Sprint 3 S3-B) — ADR-009: signed clinical records are
 * immutable; corrections happen via a NEW amendment version row.
 * Pure & deterministic.
 */

export interface SoapFields {
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
}

/** A note is signable only when all four SOAP sections carry content. */
export function isSignable(f: SoapFields): boolean {
  return [f.soapSubjective, f.soapObjective, f.soapAssessment, f.soapPlan]
    .every((s) => typeof s === 'string' && s.trim().length >= 2);
}

/**
 * Draft-replace rule: an existing note row may be superseded (a new unsigned
 * version replacing the draft content) ONLY while it is unsigned. Signed
 * notes can never be replaced — only amended.
 */
export function canReplaceDraft(existingSignedAt: Date | string | null): boolean {
  return existingSignedAt == null;
}

/**
 * Amendment rule: only a SIGNED note can be amended; the amendment is a new
 * row (amendsNoteId → original, version = original.version + 1) that itself
 * starts unsigned and must pass isSignable() before signing.
 */
export function canAmend(originalSignedAt: Date | string | null): boolean {
  return originalSignedAt != null;
}

/** Next version number for an amendment chain. */
export function nextVersion(originalVersion: number): number {
  return originalVersion + 1;
}
