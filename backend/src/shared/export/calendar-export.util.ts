/**
 * calendar-export.util — pure ICS (iCalendar) + CSV formatting helpers.
 * No DI, no I/O. Used by the appointments and finance calendar exports.
 */

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Timed event: JS Date for start; `end` required. */
  start?: Date;
  end?: Date;
  /** All-day event: 'YYYY-MM-DD'. Takes precedence over start/end when set. */
  allDayDate?: string;
}

function icsEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** Floating local timestamp: YYYYMMDDTHHMMSS (no timezone — clinic-local). */
function icsLocal(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Date-only stamp for all-day events: YYYYMMDD. */
function icsDate(ymd: string): string { return ymd.replace(/-/g, ''); }

/** UTC stamp for DTSTAMP. */
function icsStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function toIcs(events: CalendarEvent[], calName: string): string {
  const now = new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Medini CRM//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${icsEscape(e.uid)}`);
    lines.push(`DTSTAMP:${icsStamp(now)}`);
    if (e.allDayDate) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.allDayDate)}`);
    } else if (e.start && e.end) {
      lines.push(`DTSTART:${icsLocal(e.start)}`);
      lines.push(`DTEND:${icsLocal(e.end)}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const head = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\r\n');
  return body ? `${head}\r\n${body}` : head;
}

/** Combine a 'YYYY-MM-DD' date and 'HH:MM[:SS]' time into a local Date. */
export function parseLocalDateTime(ymd: string, hms: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const parts = hms.split(':').map(Number);
  return new Date(y!, (m! - 1), d!, parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}
