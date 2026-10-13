/**
 * Waitlist lifecycle + matching — FASA E (0027).
 *
 * Pure and deterministic: no I/O, no clock. The service supplies `now`.
 *
 * WHY A STATE MACHINE AND NOT A FREE STATUS COLUMN
 *
 * The waitlist is a QUEUE with a promise attached: "we will call you when a
 * slot opens". Every state change is spoken to a patient or decided by staff,
 * so an illegal jump is not a data nit — it is a broken promise or a phantom
 * notification. Same discipline as appointment-flow.ts: terminal states have
 * no outgoing edges, everything else fails closed at the service.
 *
 * THE MATCHING RULE (the heart of "tawarkan slot bila pembatalan")
 *
 * An open slot matches a waitlist entry when all three agree:
 *   1. DAY: the slot's weekday is in preferred_days — or the entry named no
 *      days (a patient who said "any day" is the most eager match there is;
 *      making them pick days would turn a wish into a booking form).
 *   2. TIME: the slot's hour falls in the entry's preferred_time band, or the
 *      entry named none. Bands: morning < 12, afternoon 12–17, evening >= 17 —
 *      the clinic's own operating reality (opens 10:00, last weekday slot
 *      20:30), not a textbook's.
 *   3. DOCTOR: the entry did not name a doctor, or named exactly this one.
 *      "Prefer Dr. Siti" must never surface a Dr. Ahmad slot as a match —
 *      offering the wrong doctor is how a waitlist teaches patients to ignore
 *      its notifications.
 */

export const WAITLIST_STATUS_FLOW: Record<string, string[]> = {
  active: ['notified', 'cancelled', 'expired'],
  notified: ['booked', 'cancelled', 'expired'],
  booked: [],   // terminal — the wish came true
  cancelled: [], // terminal — staff or patient withdrew it
  expired: [],   // terminal — nobody matched it before it aged out
};

export function canWaitlistTransition(from: string, to: string): boolean {
  return (WAITLIST_STATUS_FLOW[from] ?? []).includes(to);
}

export function allowedWaitlistTransitions(from: string): string[] {
  return WAITLIST_STATUS_FLOW[from] ?? [];
}

/** Statuses a cron may still offer slots to. */
export const WAITLIST_OFFERABLE_STATUSES = ['active', 'notified'] as const;

/** Time-of-day bands, in hours. Shared by the matcher and its tests. */
export const TIME_BANDS = {
  morning: { from: 0, to: 12 },
  afternoon: { from: 12, to: 17 },
  evening: { from: 17, to: 24 },
} as const;

export type TimeBand = keyof typeof TIME_BANDS;

/** Canonical weekday names — the JSON shape the reference system stores. */
export const WEEKDAYS = [
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Normalise free-form day input to canonical weekday names (case/space
 * forgiving, unknown days dropped, deduped). `null` when nothing valid. */
export function normalizeDays(raw: unknown): Weekday[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = new Set<string>(WEEKDAYS);
  const kept: Weekday[] = [];
  for (const v of raw) {
    const day = typeof v === 'string' ? v.trim().toUpperCase() as Weekday : null;
    if (day && valid.has(day) && !kept.includes(day)) kept.push(day);
  }
  return kept.length ? kept : null;
}

/** Does one slot match one waitlist entry's wishes? */
export function waitlistMatches(
  entry: {
    preferredDays?: Weekday[] | string[] | null;
    preferredTime?: TimeBand | string | null;
    doctorId?: string | null;
  },
  slot: {
    weekday: Weekday | string;
    /** Hour 0–23 of the slot's start. */
    hour: number;
    doctorId?: string | null;
  },
): boolean {
  /* Doctor: an explicit preference must be honoured exactly. */
  if (entry.doctorId && slot.doctorId && entry.doctorId !== slot.doctorId) return false;

  /* Day: no days named = any day. */
  const days = entry.preferredDays ?? null;
  if (days && days.length > 0 && !days.includes(slot.weekday as Weekday)) return false;

  /* Time band: no band named = any time. */
  const band = entry.preferredTime as TimeBand | null | undefined;
  if (band && TIME_BANDS[band]) {
    const { from, to } = TIME_BANDS[band];
    if (slot.hour < from || slot.hour >= to) return false;
  }

  return true;
}

/**
 * Rank matching entries for one open slot.
 *
 * MOST SPECIFIC FIRST: a patient who named days AND a band AND a doctor is
 * the one this slot was made for; "any day, any time" is the fallback. Within
 * equal specificity, oldest entry first (createdAt) — the queue's promise is
 * first-come-first-served among equals. Ties beyond that break by id so the
 * order is deterministic across two calls with identical data.
 */
export function rankMatches<T extends {
  preferredDays?: Weekday[] | string[] | null;
  preferredTime?: TimeBand | string | null;
  doctorId?: string | null;
  createdAt?: Date | string | null;
  id: string;
}>(
  entries: readonly T[],
  slot: { weekday: Weekday | string; hour: number; doctorId?: string | null },
): T[] {
  const specificity = (e: T): number =>
    (e.preferredDays?.length ? 1 : 0) +
    (e.preferredTime ? 1 : 0) +
    (e.doctorId ? 1 : 0);

  const ts = (v: Date | string | null | undefined): number => {
    if (v == null) return Number.MAX_SAFE_INTEGER; /* undated sorts last */
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };

  return entries
    .filter((e) => waitlistMatches(e, slot))
    .sort((a, b) =>
      specificity(b) - specificity(a) ||
      ts(a.createdAt) - ts(b.createdAt) ||
      a.id.localeCompare(b.id),
    );
}

/** When does an entry age out? Configurable horizon, default 90 days from
 * creation — long enough for a recall cycle, short enough that the list
 * does not become a graveyard of patients who moved on. */
export function isExpired(
  entry: { createdAt?: Date | string | null },
  now: Date,
  maxAgeDays = 90,
): boolean {
  const created = entry.createdAt ? new Date(entry.createdAt).getTime() : NaN;
  if (Number.isNaN(created)) return false; /* undated entries never auto-expire */
  return now.getTime() - created > maxAgeDays * 86_400_000;
}
