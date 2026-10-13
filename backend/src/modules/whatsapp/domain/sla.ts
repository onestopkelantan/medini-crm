/**
 * FASA 5D-C — SLA: how long a patient has been waiting for a human.
 *
 * WHAT THIS IS NOT
 *
 * It is not the ten-second reply delay. That is the AI's tempo, an anti-ban
 * measure — the AI always answers, it is a machine. SLA measures the wait AFTER
 * the AI steps aside: the clock starts when the patient's message arrives and
 * stops when a person (or the AI) actually replies. The patient does not care
 * who answers; they care how long it took.
 *
 * WHY THE CLOCK STARTS AT THE FIRST PATIENT MESSAGE
 *
 * The alternative — starting it when the AI hands over — would report a short
 * wait for a clinic that let a patient sit unanswered for an hour before anyone
 * noticed. What is measured must be what the patient experienced.
 */

/** A conversation as far as the SLA is concerned. */
export interface SlaSubject {
  /** When the patient's message arrived (or the conversation opened). */
  readonly lastMessageAt: Date | string | null;
  readonly createdAt: Date | string | null;
  /** Set the moment a reply goes out — the clock stops here. */
  readonly firstResponseAt: Date | string | null;
  readonly needsHuman: boolean;
  readonly needsHumanReason?: string | null;
}

export type SlaLevel = 'ok' | 'warning' | 'breached';

/** Share of the budget spent before the row is shown as a warning. */
const WARN_AT = 0.66;

/**
 * Used when a branch has no settings row yet.
 *
 * Defined here rather than written as a literal at each call site: the database
 * default, the service fallback and the screen's placeholder must agree, and
 * three copies of `15` drift the moment someone changes one of them.
 */
export const DEFAULT_SLA_MINUTES = 15;

/**
 * Minutes the patient has waited, or null when the clock is not running.
 *
 * Returns null once a reply has gone out: a settled conversation has no wait to
 * display, and showing the time from arrival would imply it is still waiting.
 */
export function waitingMinutes(
  subject: SlaSubject,
  now: Date = new Date(),
): number | null {
  if (subject.firstResponseAt) return null;

  const from = subject.lastMessageAt ?? subject.createdAt;
  if (!from) return null;

  const started = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(started.getTime())) return null;

  /* Negative elapsed means the clock and the database disagree (skew). Clamp to
   * zero rather than showing "-3 minit", which reads as a bug to the operator. */
  const elapsed = Math.floor((now.getTime() - started.getTime()) / 60_000);
  return elapsed > 0 ? elapsed : 0;
}

/**
 * How urgent the wait is, against the branch's limit.
 *
 * Deliberately about the CONVERSATION, not the staff member. The issue is a
 * patient waiting, not someone to blame — the moment this becomes a
 * performance stick, people stop trusting it and the number loses its purpose.
 */
export function slaLevel(
  minutes: number | null,
  limitMinutes: number,
): SlaLevel {
  if (minutes === null) return 'ok';
  if (minutes >= limitMinutes) return 'breached';
  if (minutes >= limitMinutes * WARN_AT) return 'warning';
  return 'ok';
}

/**
 * Sort key: longest wait first, then the ones needing a human.
 *
 * The order is the point of the whole feature. A newest-first inbox buries the
 * patient who has been waiting longest; sorting by wait puts them where the
 * operator looks first.
 */
export function waitingFirst<T extends SlaSubject>(
  rows: readonly T[],
  now: Date = new Date(),
): T[] {
  return [...rows].sort((a, b) => {
    const wa = waitingMinutes(a, now);
    const wb = waitingMinutes(b, now);

    /* Rows with a stopped clock (already answered) sink below waiting ones. */
    if (wa === null && wb === null) return 0;
    if (wa === null) return 1;
    if (wb === null) return -1;

    if (wb !== wa) return wb - wa;
    /* Same wait: the flagged handover is the more urgent of the two. */
    return Number(b.needsHuman) - Number(a.needsHuman);
  });
}

/** The longest current wait, for the summary line. Null when nobody waits. */
export function longestWait(
  rows: readonly SlaSubject[],
  now: Date = new Date(),
): number | null {
  const waits = rows
    .map((r) => waitingMinutes(r, now))
    .filter((m): m is number => m !== null);
  return waits.length ? Math.max(...waits) : null;
}

/** Summary for the header: how many wait, and the worst of them. */
export function slaSummary(
  rows: readonly SlaSubject[],
  limitMinutes: number,
  now: Date = new Date(),
): {
  waiting: number;
  breaching: number;
  longest: number | null;
  text: string;
} {
  const withWait = rows
    .map((r) => ({ row: r, minutes: waitingMinutes(r, now) }))
    .filter((x): x is { row: SlaSubject; minutes: number } => x.minutes !== null);

  const waiting = withWait.length;
  const breaching = withWait.filter((x) => x.minutes >= limitMinutes).length;
  const longest = longestWait(rows, now);

  if (waiting === 0) {
    return { waiting: 0, breaching: 0, longest: null, text: 'Tiada pesakit menunggu' };
  }

  /* Malay pluralisation is not inflectional, so the same noun works for any
   * count — "3 pesakit", not "3 pesakits". Keep the number and the noun apart so
   * the sentence reads naturally at 1 and at 40. */
  const head =
    waiting === 1
      ? '1 pesakit menunggu'
      : `${waiting} pesakit menunggu`;

  const tail =
    longest === null
      ? ''
      : longest >= 60
        ? `, paling lama ${Math.floor(longest / 60)} jam ${longest % 60} minit`
        : `, paling lama ${longest} minit`;

  const breachNote = breaching > 0 ? ` (${breaching} lepas had)` : '';

  return { waiting, breaching, longest, text: head + tail + breachNote };
}
