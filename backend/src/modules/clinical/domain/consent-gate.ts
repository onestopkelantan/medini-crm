/**
 * Consent gate (Sprint 3 S3-B) — a treatment plan flagged consent_required
 * cannot be ACCEPTED until a consent record exists for the plan.
 * Pure & deterministic.
 */

export interface ConsentGateContext {
  readonly consentRequired: boolean;
  /** Matching consent records (plan_id = this plan) already recorded. */
  readonly recordedConsentCount: number;
}

export interface ConsentVerdict {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
}

export function evaluateConsentGate(ctx: ConsentGateContext): ConsentVerdict {
  if (ctx.consentRequired && ctx.recordedConsentCount === 0) {
    return { allowed: false, blockers: ['CONSENT_REQUIRED'] };
  }
  return { allowed: true, blockers: [] };
}
