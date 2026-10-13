/**
 * Resolve a date mentioned in a patient's message to a concrete YYYY-MM-DD,
 * or null when the text does not name a specific day.
 *
 * WHY THIS IS ITS OWN MODULE
 * Nur needs to answer "Sabtu pagi ada masa kosong?" on the FIRST message,
 * before any booking memory exists. The accumulated-memory path (extraction
 * step) only runs AFTER her reply, so the first turn has nothing to read.
 * This function is the turn-1 fallback the design spec (§4.3) requires.
 *
 * FAIL-CLOSED, BY RULE
 * Every ambiguous form returns null. A wrong day guess would show slots for
 * the wrong day; null shows nothing and the patient clarifies. The slot
 * engine has the same rule ("a shift whose times cannot be read is DROPPED,
 * not defaulted") — this module follows it.
 *
 * Pure and deterministic — no I/O, no clock. The caller supplies TODAY.
 */

/** Malaysia-relevant weekday names. Sunday-first indexing matches getUTCDay(). */
const WEEKDAYS: ReadonlyArray<{ re: RegExp; dow: number }> = [
  { re: /\bahad\b/i, dow: 0 },
  { re: /\bisnin\b/i, dow: 1 },
  { re: /\bselasa\b/i, dow: 2 },
  { re: /\brabu\b/i, dow: 3 },
  { re: /\bkhamis\b/i, dow: 4 },
  { re: /\bjuma?t\b/i, dow: 5 },
  { re: /\bsabtu\b/i, dow: 6 },
];

const MONTHS: ReadonlyArray<{ re: RegExp; month: number }> = [
  { re: /\b(jan|januari)\b/i, month: 1 },
  { re: /\b(feb|februari)\b/i, month: 2 },
  { re: /\b(mac|march)\b/i, month: 3 },
  { re: /\b(apr|april)\b/i, month: 4 },
  { re: /\b(mei|may)\b/i, month: 5 },
  { re: /\b(jun|june)\b/i, month: 6 },
  { re: /\b(jul|july)\b/i, month: 7 },
  { re: /\b(ogo|ogos|aug|august)\b/i, month: 8 },
  { re: /\b(sep|september)\b/i, month: 9 },
  { re: /\b(okt|oktober|oct|october)\b/i, month: 10 },
  { re: /\b(nov|november)\b/i, month: 11 },
  { re: /\b(dis|dec|december)\b/i, month: 12 },
];

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

/** Date-level validity check without Date's silent rollover. */
function isValidIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parts = iso.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(`${iso}T00:00:00Z`);
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function resolveMentionedDate(
  text: string,
  todayIso: string,
): string | null {
  const today = todayIso.trim();
  if (!isValidIso(today)) return null;

  const lower = text.toLowerCase();

  /* 1. Explicit ISO date anywhere in the message — highest confidence. */
  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch && isoMatch[1]) return isValidIso(isoMatch[1]) ? isoMatch[1] : null;

  /* 2. Relative words. */
  if (/\b(hari ini|today)\b/.test(lower)) return today;
  if (/\besok\b/.test(lower)) return addDays(today, 1);
  if (/\blusa\b/.test(lower)) return addDays(today, 2);

  /* 3. Weekday names — the NEXT occurrence (a patient saying "Sabtu" on a
   * Saturday means the following one, hence diff <= 0 wraps by 7). */
  for (const wd of WEEKDAYS) {
    if (wd.re.test(lower)) {
      const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
      let diff = wd.dow - todayDow;
      if (diff <= 0) diff += 7;
      return addDays(today, diff);
    }
  }

  /* 4. "27 Okt" / "27 Oct" short form. A day number MUST be present: a month
   * alone is ambiguous and returns null (fail-closed). */
  const shortForm = lower.match(
    /\b(\d{1,2})\s+(jan|januari|feb|februari|mac|march|apr|april|mei|may|jun|june|jul|july|ogo|ogos|aug|august|sep|september|okt|oktober|oct|october|nov|november|dis|dec|december)\b/,
  );
  if (shortForm) {
    const day = Number(shortForm[1]);
    const monthWord = shortForm[2] ?? '';
    for (const mo of MONTHS) {
      if (mo.re.test(monthWord)) {
        const year = Number(today.slice(0, 4));
        const iso = `${year}-${String(mo.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!isValidIso(iso)) return null;
        /* A short-form date already past this year is ambiguous (this year's
         * or next year's?). Fail closed rather than guess. */
        if (iso < today) return null;
        return iso;
      }
    }
  }

  return null;
}
