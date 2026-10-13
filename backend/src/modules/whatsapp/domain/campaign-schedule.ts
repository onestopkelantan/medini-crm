/**
 * FASA 5F — campaign scheduling: when a promotion runs, and whether it is on
 * track.
 *
 * WHAT THIS ADDS OVER 5C-D
 *
 * 5C-D answers "how do I spread 100 messages across a day without getting
 * banned". That is the DRIP — an anti-ban mechanism, measured in minutes.
 *
 * This module answers a different question the operator actually asked:
 * "Promosi Merdeka runs 1–14 September for 1400 patients — am I on track?"
 * That is the SCHEDULE, measured in days. It has to survive the campaign being
 * paused overnight, the branch having a holiday, and the operator adding
 * patients in the middle.
 *
 * WHY THE DATES MATTER MORE THAN THEY LOOK
 *
 * Without an end date, "behind schedule" is not detectable: 300 of 1400 sent
 * looks identical on day 3 and day 13. The whole point of a dated promotion is
 * that it ends — a blast that finishes on the 20th for a Merdeka sale on the
 * 14th has failed even though every message was delivered.
 */

const MS_PER_DAY = 86_400_000;

export interface CampaignSchedule {
  /** ISO date (YYYY-MM-DD) or Date. Local clinic days, not UTC instants. */
  readonly startDate: Date | string | null;
  readonly endDate: Date | string | null;
  /** Messages the campaign intends to send per day. */
  readonly dailyTarget?: number | null;
  /** The branch's hard ceiling — never send more than this from one number. */
  readonly branchDailyCap: number;
  /** Total recipients planned. */
  readonly totalCount: number;
  /** Sent so far. */
  readonly sentCount: number;
}

export type ScheduleVerdict =
  | { ok: true; days: number; perDay: number; cappedBy: 'target' | 'branch' }
  | { ok: false; reason: ScheduleProblem; message: string };

export type ScheduleProblem =
  | 'missing_dates'
  | 'end_before_start'
  | 'too_short'
  | 'exceeds_branch_cap'
  | 'empty';

/** Local calendar day index, so date maths ignores the time of day. */
function dayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
}

function asDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inclusive day count: 1 Sept to 14 Sept is 14 days, not 13. */
export function scheduleDays(
  startDate: Date | string | null,
  endDate: Date | string | null,
): number | null {
  const s = asDate(startDate);
  const e = asDate(endDate);
  if (!s || !e) return null;
  return dayIndex(e) - dayIndex(s) + 1;
}

/**
 * Is this campaign sendable, and at what daily rate?
 *
 * Returns a PROBLEM rather than clamping silently. An operator who plans 1400
 * over 7 days is asking for 200 a day from a number capped at 100; quietly
 * sending 100 and finishing late is worse than saying so, because the promotion
 * date is the one thing that cannot be moved.
 */
export function reviewSchedule(s: CampaignSchedule): ScheduleVerdict {
  if (s.totalCount <= 0) {
    return { ok: false, reason: 'empty', message: 'Tiada penerima dipilih.' };
  }

  const days = scheduleDays(s.startDate, s.endDate);

  if (days === null) {
    /* Allowed while drafting — the operator may not have picked dates yet. The
     * check is enforced at send time, not at save time. */
    return {
      ok: false,
      reason: 'missing_dates',
      message: 'Tetapkan tarikh mula dan tamat supaya kemajuan boleh diukur.',
    };
  }

  if (days <= 0) {
    return {
      ok: false,
      reason: 'end_before_start',
      message: 'Tarikh tamat mesti selepas tarikh mula.',
    };
  }

  /* The branch ceiling wins when the plan asks for more than the number can
   * safely send. Both limits are real: the plan is what the operator wants, the
   * ceiling is what the WhatsApp account can survive. */
  const wanted = Math.ceil(s.totalCount / days);
  const target = s.dailyTarget && s.dailyTarget > 0 ? s.dailyTarget : wanted;
  const allowed = Math.min(target, s.branchDailyCap);

  if (target > s.branchDailyCap) {
    const feasible = days * s.branchDailyCap;
    return {
      ok: false,
      reason: 'exceeds_branch_cap',
      message:
        `${target}/hari melebihi had ${s.branchDailyCap}/hari untuk nombor ini. ` +
        `Perlu sekurang-kurangnya ${Math.ceil(s.totalCount / s.branchDailyCap)} hari ` +
        `(sekarang ${days} hari, muat ${feasible} penerima).`,
    };
  }

  return {
    ok: true,
    days,
    perDay: allowed,
    cappedBy: target > wanted ? 'branch' : 'target',
  };
}

/** How many days have elapsed so far, 1-based. Before the start, 0. */
export function elapsedDays(
  startDate: Date | string | null,
  now: Date = new Date(),
): number {
  const s = asDate(startDate);
  if (!s) return 0;
  const d = dayIndex(now) - dayIndex(s) + 1;
  return d > 0 ? d : 0;
}

export interface Progress {
  readonly days: number;
  readonly elapsed: number;
  readonly remaining: number;
  readonly sent: number;
  readonly total: number;
  /** What should have gone out by now, at the planned rate. */
  readonly expected: number;
  /** sent - expected. Negative means behind. */
  readonly delta: number;
  readonly onTrack: boolean;
  readonly done: boolean;
  readonly text: string;
}

/**
 * Progress against the plan.
 *
 * "Behind" is measured against the plan, not against zero. A campaign that has
 * sent 300 of 1400 is fine on day 3 and badly behind on day 13 — the same number
 * and an opposite conclusion, which is why the dates are not optional.
 */
export function campaignProgress(
  s: CampaignSchedule,
  now: Date = new Date(),
): Progress | null {
  const verdict = reviewSchedule(s);
  if (!verdict.ok) return null;

  const elapsed = Math.min(elapsedDays(s.startDate, now), verdict.days);
  const expected = Math.min(elapsed * verdict.perDay, s.totalCount);
  const remaining = verdict.days - elapsed;
  const delta = s.sentCount - expected;
  const done = s.sentCount >= s.totalCount;

  /* A one-day grace: a campaign slightly under at the end of a working day is
   * normal, and an alarm that fires every afternoon stops being read. Behind by
   * a full day's worth is a real problem worth surfacing. */
  const onTrack = done || delta >= -verdict.perDay;

  const head = `Hari ${elapsed}/${verdict.days}`;
  const body = `${s.sentCount}/${s.totalCount} dihantar`;

  if (done) {
    return {
      days: verdict.days, elapsed, remaining, sent: s.sentCount, total: s.totalCount,
      expected, delta, onTrack: true, done: true,
      text: `${head} · ${body} · selesai`,
    };
  }

  const tail = onTrack
    ? 'ikut jadual'
    : `lewat ${Math.abs(delta)} mesej`;

  return {
    days: verdict.days, elapsed, remaining, sent: s.sentCount, total: s.totalCount,
    expected, delta, onTrack, done: false,
    text: `${head} · ${body} · ${tail}`,
  };
}

/**
 * Where a newly added recipient should go: appended to the plan if it fits, or
 * pushed past the end date if it does not.
 *
 * The operator's instinct is "add 200 more". Silently refusing is unhelpful;
 * silently exceeding the branch ceiling risks the number. So the overflow is
 * PLACED — the campaign keeps its dates, and the tail is scheduled after them,
 * which is visible rather than hidden.
 */
export function placeExtraRecipients(
  s: CampaignSchedule,
  extra: number,
): { withinPlan: number; overflow: number; note: string } | null {
  const verdict = reviewSchedule(s);
  if (!verdict.ok) return null;

  /* CAPACITY IS MEASURED AGAINST THE BRANCH CEILING, NOT THE PLAN RATE.
   *
   * `verdict.perDay` is the rate derived from the current list size, so
   * days x perDay is always approximately totalCount — it says nothing about
   * whether more recipients would fit. The number that answers that is the
   * branch's hard ceiling: the account can carry days x cap within these dates,
   * whatever the plan currently intends.
   *
   * An operator may also have set a deliberate lower target. That is a pacing
   * choice, not a capacity limit, so it does not cap what can physically be
   * added — the ceiling does. */
  const capacity = verdict.days * s.branchDailyCap;
  const room = Math.max(capacity - s.totalCount, 0);
  const withinPlan = Math.min(extra, room);
  const overflow = extra - withinPlan;

  if (overflow === 0) {
    return {
      withinPlan, overflow: 0,
      note: `${extra} penerima ditambah dalam jadual sedia ada.`,
    };
  }

  const daysNeeded = Math.ceil(overflow / s.branchDailyCap);
  return {
    withinPlan, overflow,
    note:
      `${withinPlan} ditambah dalam jadual; ${overflow} ditangguhkan ` +
      `${daysNeeded} hari selepas tarikh tamat supaya had harian tidak dilanggar.`,
  };
}
