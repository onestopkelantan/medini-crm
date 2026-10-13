/**
 * FASA 5C-D — send-time guards for the blast drip.
 *
 * WHY THIS EXISTS
 *
 * The single-message send path (staff typing a reply) runs the six-gate safety
 * engine before queueing. The blast path does not: that engine's window gate is
 * 09:00–18:00, so an 08:00 or 21:00 blast would be refused outright, and the
 * client's stated window is 08:00–22:00. Blasts therefore queue without the
 * engine, and every rule it would have applied is re-checked HERE, at send time.
 *
 * Two properties matter more than the rest:
 *
 *   1. OPT-OUT IS RE-READ. A message queued on day 1 may be sent on day 14. The
 *      patient can reply STOP at any point in between, and the queue decision
 *      goes stale the moment they do. Re-reading is the only way the promise
 *      ("STOP means you stop receiving messages") survives a 14-day campaign.
 *
 *   2. FAIL CLOSED ON UNKNOWN. If the opt-out table cannot be read, the answer
 *      is not "nobody has opted out" — it is "unknown", and unknown aborts.
 *      A delayed marketing message costs nothing; messaging someone who said
 *      STOP is the harm this whole module exists to prevent.
 */

export interface SendGuardInput {
  /**
   * True if opted out, false if confirmed not, NULL if the lookup failed.
   * Null is not false — see the fail-closed note above.
   */
  optedOut: boolean | null;
  /** The operator stopped this campaign. */
  campaignStopped: boolean;
  /** Already cancelled by an earlier guard pass. */
  cancelled: boolean;
}

export type AbortReason =
  | 'OPTED_OUT'
  | 'CAMPAIGN_STOPPED'
  | 'ALREADY_CANCELLED'
  | 'OPT_OUT_UNKNOWN';

export interface SendVerdict {
  abort: boolean;
  reason: AbortReason | null;
}

/** Absolute ceiling for one blast payload.
 *
 *  The OPERATIVE limit is the branch's `max_blast_per_day` (100), checked against
 *  the database. This constant only stops an absurd payload from reaching that
 *  check, and exists as a named value so the request schema and the business rule
 *  cannot drift apart — a hardcoded `.max(50)` in the schema silently overrode
 *  every branch's 100/day setting, so the operator could never send the 100 the
 *  panel promised them. */
export const WA_BLAST_HARD_MAX = 1000;

/** Used when a branch has no settings row, for the per-day ceiling.
 *
 * Same reasoning as DEFAULT_SLA_MINUTES: the database default (`max_blast_per_day
 * DEFAULT 100`), this fallback and the screen's placeholder must agree, so the
 * figure is named once instead of written as a literal in three places. */
export const DEFAULT_BLAST_DAILY_CAP = 100;

/**
 * Decide whether a queued message may still be sent.
 *
 * Ordered by severity: opt-out first (it is the legally meaningful one and the
 * reason recorded for audit), then campaign stop, then idempotency.
 */
export function mustAbortSend(input: SendGuardInput): SendVerdict {
  /* Opt-out checked before everything: if the patient said STOP, that is the
   * reason the record should show, whatever else is also true. */
  if (input.optedOut === true) {
    return { abort: true, reason: 'OPTED_OUT' };
  }

  if (input.optedOut === null) {
    return { abort: true, reason: 'OPT_OUT_UNKNOWN' };
  }

  if (input.campaignStopped) {
    return { abort: true, reason: 'CAMPAIGN_STOPPED' };
  }

  if (input.cancelled) {
    return { abort: true, reason: 'ALREADY_CANCELLED' };
  }

  return { abort: false, reason: null };
}

/**
 * The sending window actually in force for a branch.
 *
 * The database is authoritative: each branch configures its own blast window in
 * the Anti-Ban panel. The compile-time constants in whatsapp-lifecycle.ts are
 * the reply-engine defaults and must not override a branch's saved setting —
 * that mismatch is why an 08:00 blast would silently be refused.
 *
 * Defaults are the safe direction: if a branch has never saved a window, it gets
 * the conservative 08:00–22:00 rather than "send any time".
 */
export function effectiveWindow(
  startHour: number | null | undefined,
  endHour: number | null | undefined,
): { windowStartHour: number; windowEndHour: number } {
  const start = startHour ?? 8;
  const end = endHour ?? 22;

  /* An inverted or zero-length window would mean an empty day: every message
   * would be rescheduled forever and the campaign would never progress. Clamp
   * to a 15-minute minimum so the planner always has room. */
  if (end <= start) {
    return { windowStartHour: start, windowEndHour: start + 1 };
  }

  return { windowStartHour: start, windowEndHour: end };
}

/** Has this message's scheduled instant arrived? A missing schedule means now. */
export function isDue(sendAt: Date | null, now: Date): boolean {
  if (!sendAt) return true;
  return sendAt.getTime() <= now.getTime();
}

/**
 * Should a message that is already sitting in the queue be cancelled outright?
 *
 * Used by the reconciliation sweep. A blast message is cancelled when its
 * patient opted out or its campaign stopped. A normal staff reply is cancelled
 * only for opt-out — a STOP applies to the number, not to one kind of message,
 * so a manual reply to an opted-out patient must not go out either. Nothing
 * else touches a queued human message.
 */
export function shouldCancelQueued(input: {
  optedOut: boolean;
  campaignStopped: boolean;
  isBlast: boolean;
}): boolean {
  if (input.optedOut) return true;
  return input.isBlast && input.campaignStopped;
}
