/**
 * Period parsing for commission revenue derivation (P2).
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION
 *
 * The date window decides WHICH payments a doctor's commission is calculated
 * from, so it must be provable without a database. The repository supplies the
 * `from`/`to` pair to SQL; this module decides what that pair IS.
 *
 * CURRENT CONVENTION: `YYYY-MM` (one calendar month).
 *
 * HONEST LIMITATION — deliberately not an error. The caller's period semantics
 * may broaden later (a range, a rolling window, "Q3"). Until then, anything that
 * is not `YYYY-MM` yields `null`, which the repository reads as ALL-TIME. The
 * alternative — rejecting an unfamiliar period — would break a caller for a
 * format we have not defined yet.
 */

export interface PeriodWindow {
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from: string;
  /** Exclusive upper bound, `YYYY-MM-DD` (first day of the NEXT month). */
  to: string;
}

/**
 * Turn a `YYYY-MM` period into a half-open month window.
 *
 * Returns `null` when the period is absent or not in `YYYY-MM` form — the caller
 * treats that as "all time".
 *
 * Half-open (`>= from`, `< to`) rather than `BETWEEN`: a month's last day has a
 * time component in some columns, and an inclusive upper bound would silently
 * drop charges made late on the final day.
 */
export function periodWindow(period?: string | null): PeriodWindow | null {
  if (!period) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  /* Reject 2026-00 and 2026-13: the regex alone would accept them, and a bogus
   * month must not silently widen or shift the window. */
  if (month < 1 || month > 12) return null;

  const from = `${m[1]}-${m[2]}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;

  return { from, to };
}
