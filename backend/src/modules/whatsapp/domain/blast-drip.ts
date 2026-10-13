/**
 * FASA 5C-D — blast drip scheduling.
 *
 * A blast is not "send 100 now". It is "send 100 across a 14-hour working day,
 * never outside 08:00–22:00, never faster than a human could plausibly type".
 * This module owns that arithmetic; the queue only executes what it produces.
 *
 * WHY THIS IS A SEPARATE MODULE
 *
 * The existing transport worker sleeps a fixed 30–60s before each send, and its
 * ceiling is 60s. A 100/day blast needs ~504s between messages. You cannot get
 * there by cranking the sleep — the worker would hold a BullMQ job open for
 * 8 minutes at a time and lose the whole schedule on restart. So the schedule is
 * computed up front and each message is given an explicit `sendAt`; the worker
 * then waits until that moment.
 *
 * WHY SLOTS RATHER THAN A RUNNING CURSOR
 *
 * Adding a jittered gap to a moving cursor accumulates drift: over 99 gaps a
 * ±25% jitter can add more than an hour, and the batch silently spills into a
 * 15th day. For a promotion with an end date that is a real failure. So each
 * day's messages are placed on fixed slots — `start + i * gap` — and jitter is
 * applied as a bounded offset AROUND those slots. The offset is small enough
 * that a slot can never cross its neighbours, so the day's capacity is exact and
 * the batch finishes when the operator was told it would.
 *
 * WALL CLOCK
 *
 * The clinic thinks in Malaysia hours (UTC+8). The server stores UTC. Every
 * conversion here is explicit and tested, because an off-by-eight error means
 * messages arriving at 3am.
 */

/** Malaysia is UTC+8 with no daylight saving — a fixed offset, not a timezone DB. */
export const MY_OFFSET_HOURS = 8;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface BlastWindow {
  /** Local hour the window opens (inclusive), e.g. 8 for 08:00. */
  windowStartHour: number;
  /** Local hour the window closes (exclusive), e.g. 22 for 22:00. */
  windowEndHour: number;
}

export interface DripOptions extends BlastWindow {
  /** How many messages to schedule. */
  count: number;
  /** Time of the first message. Out-of-window values roll forward. */
  startAt: Date;
  /** Hard cap per day. Undefined = fit the batch into the window in one day. */
  perDay?: number;
  /** Gap floor in seconds. */
  minGapSeconds?: number;
  /** Gap ceiling in seconds. */
  maxGapSeconds?: number;
  /** Injectable RNG so tests can assert determinism. */
  rng?: () => number;
}

/** Local hour with minutes as a fraction (e.g. 21.5 for 21:30 local). */
function localHourFloat(d: Date): number {
  return (d.getUTCHours() + MY_OFFSET_HOURS) % 24 + d.getUTCMinutes() / 60;
}

/**
 * Midnight (local) of the day containing `d`, expressed in UTC.
 *
 * This is the anchor for every window calculation: shifting a day is then
 * `+ MS_PER_DAY`, which avoids incrementing month/day fields by hand and the
 * month-boundary bugs that come with it.
 */
function localMidnight(d: Date): Date {
  const shifted = new Date(d.getTime() + MY_OFFSET_HOURS * MS_PER_HOUR);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - MY_OFFSET_HOURS * MS_PER_HOUR);
}

/** Is this instant inside the sending window? */
export function isInsideWindow(d: Date, win: BlastWindow): boolean {
  const h = localHourFloat(d);
  return h >= win.windowStartHour && h < win.windowEndHour;
}

/**
 * The earliest instant at or after `d` that is inside the window.
 *
 * A message that would land at 23:30 waits until 08:00 the NEXT morning — not
 * 08:00 the same day, which is in the past.
 */
export function nextWindowOpen(d: Date, win: BlastWindow): Date {
  if (isInsideWindow(d, win)) return d;

  const hour = localHourFloat(d);
  const midnight = localMidnight(d);

  if (hour < win.windowStartHour) {
    /* Before opening (02:00, 07:59) → today at opening. */
    return new Date(midnight.getTime() + win.windowStartHour * MS_PER_HOUR);
  }

  /* At or after closing → tomorrow at opening. */
  return new Date(
    midnight.getTime() + MS_PER_DAY + win.windowStartHour * MS_PER_HOUR,
  );
}

/**
 * Build the full send schedule for a blast.
 *
 * Returns one Date per message, in send order. The caller assigns them to
 * messages; this function performs no I/O and never throws — an impossible plan
 * is reported by its shape (short length), not an exception mid-blast.
 */
export function planDrip(opts: DripOptions): Date[] {
  const {
    count,
    startAt,
    perDay,
    minGapSeconds,
    maxGapSeconds,
    rng = Math.random,
  } = opts;

  if (count <= 0) return [];

  const win: BlastWindow = {
    windowStartHour: opts.windowStartHour,
    windowEndHour: opts.windowEndHour,
  };

  /* An inverted or empty window would divide by zero; floor it at 15 minutes. */
  const windowSeconds =
    Math.max(0.25, win.windowEndHour - win.windowStartHour) * 3600;

  const perDayCount = perDay && perDay > 0 ? Math.min(perDay, count) : count;

  /* The ideal pace: fill the working window evenly with this many messages.
   * Bos's arithmetic — 14h / 100 = 504s = 8m24s — falls straight out of this. */
  const idealGap = windowSeconds / Math.max(1, perDayCount);

  const lo = minGapSeconds ?? idealGap * 0.75;
  const hi = maxGapSeconds ?? idealGap * 1.25;
  const centre = Math.min(Math.max(idealGap, lo), hi);

  /* Jitter envelope, sized so the OPERATOR'S range is never violated.
   *
   * Slots sit at `centre * i`; a jittered gap works out to
   * `centre + j[i+1] - j[i]`, so with jitter of ±J the widest possible gap is
   * `centre + 2J` and the narrowest `centre - 2J`. Keeping both inside [lo, hi]
   * therefore needs J <= (hi - centre) / 2 AND J <= (centre - lo) / 2. The extra
   * 45% cap keeps the spacing strictly positive so two messages can never be
   * assigned the same instant. */
  const jitterHalf = Math.max(
    0,
    Math.min((hi - centre) / 2, (centre - lo) / 2, centre * 0.45),
  );

  const schedule: Date[] = [];
  let remaining = count;
  let dayMidnight = localMidnight(nextWindowOpen(startAt, win)).getTime();
  let firstDay = true;
  /* Defensive bound: a day always yields at least one slot, so the loop cannot
   * run longer than one iteration per message. */
  let guard = 0;

  while (remaining > 0 && guard <= count + 1) {
    guard++;

    const open = dayMidnight + win.windowStartHour * MS_PER_HOUR;
    const close = dayMidnight + win.windowEndHour * MS_PER_HOUR;

    /* On the first day the operator may start mid-window (e.g. 20:00), so the
     * usable span is shorter and capacity is smaller. */
    const dayStart = firstDay
      ? Math.max(open, nextWindowOpen(startAt, win).getTime())
      : open;

    const room = close - dayStart;
    const capacity =
      room <= 0 ? 0 : Math.floor(room / (centre * 1000)) + 1;

    if (capacity <= 0) {
      /* No room left today — move to tomorrow's opening. */
      dayMidnight += MS_PER_DAY;
      firstDay = false;
      continue;
    }

    const n = Math.min(remaining, perDayCount, capacity);

    for (let i = 0; i < n; i++) {
      /* The first message of the whole batch goes out immediately: the operator
       * pressed send and expects activity, not an eight-minute silence. */
      const offset =
        firstDay && i === 0 ? 0 : (rng() * 2 - 1) * jitterHalf;

      /* Clamp into the window. A negative offset on the first slot of a day
       * would otherwise land before opening (07:5x), which is exactly the
       * out-of-hours delivery this whole planner exists to prevent. */
      const earliest = Math.max(dayStart, open);
      const latest = close - 1000;
      const t = Math.min(
        Math.max(dayStart + i * centre * 1000 + offset * 1000, earliest),
        latest,
      );

      schedule.push(new Date(t));
    }

    remaining -= n;
    dayMidnight += MS_PER_DAY;
    firstDay = false;
  }

  return schedule;
}
