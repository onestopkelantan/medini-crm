/**
 * Reply cap policy — anti-ban, AB2.
 *
 * WHY THIS EXISTS
 *
 * The anti-ban panel promises caps (messages per day, per hour, warm-up
 * limits for a young number) but only the BLAST path enforced them. AI
 * replies went out uncounted: a branch under a spam attack, a webhook
 * storm, or simply a very busy Monday could exceed every cap the operator
 * set and the system would never notice. WhatsApp's own ban heuristics
 * weight OUTBOUND VOLUME PER DAY heavily — this gap is the largest single
 * ban-risk the reply path had.
 *
 * WHAT THE POLICY DECIDES
 *
 * Given the branch's settings and today's outbound count, one of:
 *
 *   ALLOW    — send the reply.
 *   ESCALATE — do not send; hand the conversation to a human (the patient
 *              is told someone will follow up, and the thread lands in the
 *              "perlu reply manual" queue). Used when the DAILY cap or a
 *              warm-up limit is reached: a patient mid-conversation must
 *              not be silently dropped.
 *   HOLD     — the HOURLY cap is hit but the day still has room. A short,
 *              bounded wait is honest (a busy human replies minutes later
 *              too) — but it must never become a silent black hole, so the
 *              caller learns how long the hold is and may escalate instead
 *              if the wait is longer than it is willing to accept.
 *
 * PURE: settings + counts in, verdict out. No I/O, no clock, no rand.
 */

export interface ReplyCapSettings {
  /** Outbound AI replies allowed per calendar day. */
  dailyMessageCap: number;
  /** Outbound AI replies allowed per rolling hour. */
  hourlyMessageCap: number;
  /** Days since the branch's WhatsApp number was first paired. */
  daysActive: number;
  /** While younger than warmupDays, the daily cap is warmupDailyCap. */
  warmupDays: number;
  warmupDailyCap: number;
}

export interface ReplyCapCounts {
  /** AI replies sent so far today (calendar day, branch scope). */
  sentToday: number;
  /** AI replies sent in the last hour. */
  sentLastHour: number;
}

export type CapVerdict =
  | { decision: 'ALLOW'; reason: null }
  /** Daily ceiling reached (regular or warm-up): never silently drop. */
  | { decision: 'ESCALATE'; reason: 'daily_cap' | 'warmup_cap' }
  /** Hourly ceiling reached: wait `holdMs`, then re-check. */
  | { decision: 'HOLD'; reason: 'hourly_cap'; holdMs: number };

/** How long the hourly hold waits before re-checking, ms. Long enough for
 * the count to age out of the hour window at a plausible rate, short
 * enough that a patient is not left hanging for an operator's shift. */
export const HOURLY_HOLD_MS = 5 * 60_000;

export function evaluateReplyCaps(
  settings: ReplyCapSettings,
  counts: ReplyCapCounts,
): CapVerdict {
  const inWarmup = settings.daysActive < settings.warmupDays;
  const dailyCeiling = inWarmup
    ? Math.min(settings.warmupDailyCap, settings.dailyMessageCap)
    : settings.dailyMessageCap;

  if (counts.sentToday >= dailyCeiling) {
    return {
      decision: 'ESCALATE',
      reason: inWarmup ? 'warmup_cap' : 'daily_cap',
    };
  }

  if (counts.sentLastHour >= settings.hourlyMessageCap) {
    /* The day still has room — this is congestion, not exhaustion. */
    return { decision: 'HOLD', reason: 'hourly_cap', holdMs: HOURLY_HOLD_MS };
  }

  return { decision: 'ALLOW', reason: null };
}
