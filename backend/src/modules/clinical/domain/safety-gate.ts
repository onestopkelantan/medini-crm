/**
 * Safety gate (Sprint 3 S3-B, extended in Fasa 1A) — Blueprint §5/§310: a
 * severe-allergy situation must be ACKNOWLEDGED before the encounter can be
 * completed. BLOCK, not warn.
 *
 * WHAT CHANGED IN FASA 1A, AND WHY IT MATTERED
 *
 * The original gate was honest about its own hole: it had no allergy data to
 * read, because `patients` carries no medical-alert column and no allergy table
 * existed. Its only "severe signal" was a severe ADVERSE EVENT — a reaction this
 * patient had ALREADY suffered, in this clinic. So the gate could only protect a
 * patient from a drug that had already hurt them. That is backwards: an allergy
 * check exists to prevent the first exposure.
 *
 * Fasa 1A adds `patient_allergies` (`domain/allergies.ts` owns its rules). This
 * file now evaluates TWO independent severe signals:
 *
 *   1. allergies the patient is KNOWN to have      → ALLERGY_UNACKNOWLEDGED
 *   2. severe adverse events already on record     → SEVERE_ALLERGY_UNACKNOWLEDGED
 *
 * They stay as SEPARATE blockers on purpose. They mean different things to the
 * person reading the screen: (1) is "this patient has a serious allergy, confirm
 * you saw it", (2) is "something went badly wrong here before". Collapsing them
 * into one message would make the UI unable to say which, and the second is the
 * one a clinician escalates.
 *
 * ONE ACKNOWLEDGEMENT COVERS BOTH. `allergyAcknowledgedAt` is the doctor saying
 * "I have seen the safety alerts on this encounter". Requiring a second tick for
 * a second alert trains people to tick without reading.
 *
 * Fail-safe in both directions: a severe signal WITHOUT acknowledgement blocks.
 *
 * Pure & deterministic — no database, no clock.
 */

import {
  ActiveAllergy,
  evaluateAllergyGate,
} from './allergies';

export interface SafetyContext {
  /**
   * Severe adverse events on record for this patient — a reaction that has
   * already happened here (original signal, retained).
   */
  severeAdverseEventCount: number;
  /** Encounter allergy acknowledgement timestamp (null = not acknowledged). */
  allergyAcknowledgedAt: Date | string | null;
  /**
   * ACTIVE allergies for this patient (Fasa 1A). Omit or pass `[]` and the gate
   * behaves exactly as it did before — the adverse-event signal alone.
   *
   * Retired allergies must NOT be passed: retiring one is the documented way to
   * say "this is no longer a risk", and re-gating on it would make the retire
   * action do nothing visible.
   */
  activeAllergies?: readonly ActiveAllergy[];
}

export interface SafetyVerdict {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
  /**
   * The specific allergies that blocked, most serious first, so the UI can NAME
   * them. A gate that says only "blocked" forces the doctor to hunt through the
   * chart to find out why — and the fix for that is a doctor who stops reading
   * the message.
   */
  readonly blockingAllergies: readonly ActiveAllergy[];
}

/** Evaluate whether an encounter may transition to completed. */
export function evaluateCompletionGate(ctx: SafetyContext): SafetyVerdict {
  const allergyVerdict = evaluateAllergyGate({
    activeAllergies: ctx.activeAllergies ?? [],
    allergyAcknowledgedAt: ctx.allergyAcknowledgedAt,
  });

  const blockers: string[] = [...allergyVerdict.blockers];

  if (ctx.severeAdverseEventCount > 0 && ctx.allergyAcknowledgedAt == null) {
    blockers.push('SEVERE_ALLERGY_UNACKNOWLEDGED');
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    blockingAllergies: allergyVerdict.blockingAllergies,
  };
}
