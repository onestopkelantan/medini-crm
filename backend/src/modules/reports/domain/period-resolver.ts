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
