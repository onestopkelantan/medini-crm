/** S9 — Report period pills (7D/30D/90D/12M). PURE domain: no I/O. */

export type ReportPeriod = '7D' | '30D' | '90D' | '12M';

export interface PeriodRange {
  /** Inclusive, YYYY-MM-DD (server-local). */
  from: string;
  /** Inclusive, YYYY-MM-DD (server-local). */
  to: string;
}

const DAYS: Record<ReportPeriod, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '12M': 365,
};

export function isReportPeriod(v: unknown): v is ReportPeriod {
  return typeof v === 'string' && v in DAYS;
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve a period pill to an INCLUSIVE date range ending today.
 * `now` is injectable for deterministic tests (S8 nowFn lesson).
 */
export function resolvePeriod(period: ReportPeriod, now: Date = new Date()): PeriodRange {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - (DAYS[period] - 1));
  return { from: iso(from), to: iso(to) };
}

/**
 * The SAME-LENGTH window immediately BEFORE the current one — the comparison
 * window for "bandingkan ... dengan tempoh lepas" questions (Phase B, the
 * dental-erp clinic-analyst pattern).
 *
 * WHY SAME-LENGTH AND IMMEDIATELY-BEFORE, NOT A CALENDAR MONTH
 * The current 30D window is "the 30 days ending today", so its natural
 * counterpart is "the 30 days ending yesterday" — no gap, no overlap. Using
 * the calendar month before would (a) drift as today moves, (b) sometimes
 * overlap the current window (a 31-day month before a 30-day window), and
 * (c) silently double-count days that are already in the current window.
 * Both windows have exactly DAYS[period] days.
 *
 * `now` is injectable for deterministic tests (S8 nowFn lesson).
 */
export function previousPeriodRange(period: ReportPeriod, now: Date = new Date()): PeriodRange {
  const current = resolvePeriod(period, now);
  /* The previous window ends the day before the current one starts. */
  const to = new Date(current.from + 'T00:00:00');
  to.setDate(to.getDate() - 1);
  const from = new Date(to);
  from.setDate(from.getDate() - (DAYS[period] - 1));
  return { from: iso(from), to: iso(to) };
}
