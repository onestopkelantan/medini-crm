/**
 * Safety gate (Sprint 3 S3-B) — Blueprint §5/§310: a severe-allergy situation
 * must be ACKNOWLEDGED before the encounter can be completed. BLOCK, not warn.
 *
 * KNOWN BOUNDARY (documented debt M-3): the locked patients schema carries no
 * allergy/medical-alert column (medical profile ownership = Patients domain,
 * future sprint). The gate therefore evaluates the structured safety signals
 * that DO exist inside the clinical domain:
 *   - severe adverse events recorded for the patient (severity = 'severe')
 *   - the encounter's explicit allergy acknowledgement (allergy_acknowledged_at)
 * Fail-safe: a severe signal WITHOUT acknowledgement blocks completion.
 * Pure & deterministic.
 */

export interface SafetyContext {
  /** Count of severe adverse events on record for this patient. */
  severeAdverseEventCount: number;
  /** Encounter allergy acknowledgement timestamp (null = not acknowledged). */
  allergyAcknowledgedAt: Date | string | null;
}

export interface SafetyVerdict {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
}

/** Evaluate whether an encounter may transition to completed. */
export function evaluateCompletionGate(ctx: SafetyContext): SafetyVerdict {
  const blockers: string[] = [];
  if (ctx.severeAdverseEventCount > 0 && ctx.allergyAcknowledgedAt == null) {
    blockers.push('SEVERE_ALLERGY_UNACKNOWLEDGED');
  }
  return { allowed: blockers.length === 0, blockers };
}
