/**
 * Allergy records (Fasa 1A) — the data the safety gate was missing.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `safety-gate.ts` has always been correct in form and hollow in substance. It
 * blocks encounter completion when a severe signal exists and no acknowledgement
 * is recorded — but the only "allergy signal" it could see was a severe ADVERSE
 * EVENT, i.e. a reaction that had ALREADY HAPPENED to this patient in this
 * clinic. So the gate could only ever protect a patient from a drug that had
 * already hurt them, which is the opposite of what an allergy check is for. The
 * module said so itself ("KNOWN BOUNDARY, documented debt M-3").
 *
 * The missing piece was never the rule. It was a place to PUT an allergy:
 * `patients` has no medical-alert column, and there was no allergy table.
 *
 * THE DOMAIN DECISION: THIS IS A SAFETY RECORD, NOT A CLINICAL NOTE
 *
 * Allergies are INSERT + RETIRE, never edit-in-place:
 *
 *   - A recorded allergy is a FACT ABOUT A MOMENT. If a doctor wrote "penicillin
 *     — anaphylaxis" and later decided it was wrong, the honest record is that
 *     the first entry existed and was retired, with a reason. Silently editing
 *     it destroys the audit trail that a clinical governance review needs, and
 *     it makes the safety gate's past decisions unexplainable.
 *   - RETIRE has no "delete": a retired allergy stops gating but stays visible
 *     on the patient's history, because "this was believed once" is information.
 *
 * SEVERITY IS ORDERED, AND THE ORDER IS THE POINT
 *
 * `unknown` sits ABOVE the mild tiers, not below them. An allergy whose severity
 * nobody established is not a mild allergy — it is an UNASSESSED one, and the
 * safe default for an unassessed risk is to treat it as significant. Ranking it
 * below `mild` would let a half-filled form wave a patient through the gate.
 *
 * Pure & deterministic — no database, no clock. The repository stores these
 * verdicts; this file decides them.
 */

/* ------------------------------------------------------------------ severity */

export const ALLERGY_SEVERITIES = [
  'mild', 'moderate', 'unknown', 'severe', 'life_threatening',
] as const;

export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

/** Rank for comparison. Higher = more serious. `unknown` deliberately sits
 * above `moderate`: an unassessed allergy must not out-rank only the trivially
 * mild, it must out-rank the ones a human actually downgraded. */
const SEVERITY_RANK: Readonly<Record<AllergySeverity, number>> = {
  mild: 1,
  moderate: 2,
  unknown: 3,
  severe: 4,
  life_threatening: 5,
};

export function severityRank(s: AllergySeverity): number {
  return SEVERITY_RANK[s];
}

/**
 * Does this allergy require acknowledgement before an encounter may close?
 *
 * `moderate` and up — which includes `unknown`. Mild reactions (a rash that
 * settled, a metallic taste) are recorded and shown but do not hold a visit
 * open: a gate that fires on everything gets clicked through without reading,
 * and a gate that gets clicked through protects nobody.
 */
export function requiresAcknowledgement(severity: AllergySeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK.moderate;
}

/* ---------------------------------------------------------------- categories */

export const ALLERGY_CATEGORIES = ['drug', 'food', 'material', 'environmental', 'other'] as const;
export type AllergyCategory = (typeof ALLERGY_CATEGORIES)[number];

/* -------------------------------------------------------------- the record */

/**
 * The shape the gate evaluates. A deliberately NARROW view of the stored row:
 * the gate needs only these four fields, and pinning them here means a schema
 * change elsewhere cannot quietly alter what the gate believes.
 */
export interface ActiveAllergy {
  readonly id: string;
  readonly allergen: string;
  readonly severity: AllergySeverity;
  /** The reaction as described (free text — "rash", "swelling", "anaphylaxis"). */
  readonly reaction: string | null;
}

/** The gate's own context — what it is allowed to know. */
export interface AllergyGateContext {
  /** ACTIVE allergies only. Retired ones must not be passed here. */
  readonly activeAllergies: readonly ActiveAllergy[];
  /** Did the doctor tick acknowledgement on this encounter? */
  readonly allergyAcknowledgedAt: Date | string | null;
}

export interface AllergyGateVerdict {
  readonly allowed: boolean;
  /** Machine codes the UI turns into a sentence — never prose from the server. */
  readonly blockers: readonly string[];
  /** Blocking allergies, most serious first, so the UI can name them. */
  readonly blockingAllergies: readonly ActiveAllergy[];
}

/**
 * The allergy half of the completion gate.
 *
 * Blocks when at least one ACTIVE allergy is at `requiresAcknowledgement` level
 * and the encounter carries no acknowledgement timestamp.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not check whether the prescribed
 * drug matches the allergen. That is a different capability (drug-interaction
 * checking against a formulary) and pretending to do it with string matching
 * would produce confident-looking misses on the cases that matter — "penicillin"
 * vs "amoxicillin" are the same allergy to a clinician and different strings to
 * a matcher. The gate's job here is narrower and honest: a serious allergy
 * exists, a human must have seen it and said so before the visit closes.
 */
export function evaluateAllergyGate(ctx: AllergyGateContext): AllergyGateVerdict {
  const blocking = ctx.activeAllergies
    .filter((a) => requiresAcknowledgement(a.severity))
    .slice()
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  if (blocking.length === 0) {
    return { allowed: true, blockers: [], blockingAllergies: [] };
  }
  if (ctx.allergyAcknowledgedAt != null) {
    return { allowed: true, blockers: [], blockingAllergies: blocking };
  }
  return {
    allowed: false,
    blockers: ['ALLERGY_UNACKNOWLEDGED'],
    blockingAllergies: blocking,
  };
}

/* ------------------------------------------------------------- consistency */

/**
 * Is a severity consistent with its context?
 *
 * `life_threatening` demands a recorded reaction: a chart that claims a
 * life-threatening allergy but cannot say what happened is not a safety record,
 * it is a rumour, and it will be treated as noise by the next reader. This rule
 * exists because that is exactly how a real alert gets ignored.
 *
 * Returns a field→message map; empty means valid. Shaped like the repo's zod
 * `flatten().fieldErrors` so the service can return it unchanged.
 */
export function validateAllergyDraft(input: {
  allergen?: unknown;
  severity?: unknown;
  reaction?: unknown | null;
}): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  const allergen = typeof input.allergen === 'string' ? input.allergen.trim() : '';
  if (allergen.length < 2) {
    errors.allergen = ['Allergen must be at least 2 characters'];
  } else if (allergen.length > 256) {
    errors.allergen = ['Allergen must be at most 256 characters'];
  }

  const severity = input.severity as AllergySeverity;
  if (!ALLERGY_SEVERITIES.includes(severity)) {
    errors.severity = [`Severity must be one of: ${ALLERGY_SEVERITIES.join(', ')}`];
  }

  const reaction = typeof input.reaction === 'string' ? input.reaction.trim() : '';
  if (severity === 'life_threatening' && reaction.length === 0) {
    errors.reaction = ['A life-threatening allergy must record the reaction observed'];
  }
  if (reaction.length > 512) {
    errors.reaction = ['Reaction must be at most 512 characters'];
  }

  return errors;
}

/**
 * Retire decision — the ONLY way an allergy stops being active.
 *
 * Requires a reason. "Why is this no longer a risk" is the question a clinical
 * review asks, and an allergy that vanished without an answer is indistinguish-
 * able from one that was deleted by mistake.
 */
export function validateRetire(input: { reason?: unknown }): Record<string, string[]> {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3) {
    return { reason: ['A reason is required to retire an allergy'] };
  }
  if (reason.length > 512) {
    return { reason: ['Reason must be at most 512 characters'] };
  }
  return {};
}

/** Most serious first, then alphabetically — so a list read top-down puts the
 * allergy that matters at the top and stays stable between renders. */
export function sortAllergies<T extends { severity: AllergySeverity; allergen: string }>(
  rows: readonly T[],
): T[] {
  return rows.slice().sort((a, b) => {
    const byRank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (byRank !== 0) return byRank;
    return a.allergen.localeCompare(b.allergen);
  });
}
