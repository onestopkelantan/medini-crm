/**
 * FASA 6B — the doctor a returning patient usually wants.
 *
 * THE SITUATION
 *
 * A patient who came three times to Dr. Siti, and once to whoever was free, is
 * still "Dr. Siti's patient" in their own mind. But the clinic's record is a list
 * of visits, and the newest visit is not the same thing as the usual doctor.
 *
 * Deciding which one to offer is therefore a real choice, not a lookup, and the
 * two obvious rules give different answers:
 *
 *   MOST RECENT — what the patient last experienced. Correct for one-offs: a
 *   patient who saw Dr. Ahmad once after an extraction still remembers Dr. Ahmad.
 *
 *   MOST FREQUENT — who actually treats them. Correct when the last visit was an
 *   exception: a check-up slotted in with whoever was free should not erase a
 *   year of continuity.
 *
 * WHY THIS IS NOT JUST "ORDER BY DATE DESC LIMIT 1"
 *
 * That rule looks right and is wrong often enough to matter. A single emergency
 * visit with a different dentist re-labels the patient, and the next recall
 * message offers a stranger — which is exactly the kind of small wrongness that
 * makes a clinic look like it does not know its own patients.
 *
 * THE RULE USED HERE
 *
 * Weight by both: count the visits, and let the most recent of the leading
 * candidates break a tie. Concretely — the doctor with the most visits wins, UNLESS
 * the most recent visit is with a doctor who is within one visit of the leader,
 * in which case recency wins. One visit behind is a plausible "their usual
 * dentist" rather than a fluke; further behind, and the recent visit is an
 * exception.
 *
 * The rule is a judgement, so it is stated once, tested, and kept out of the
 * prompt — a model asked to weigh these would answer differently each time.
 */

export interface Visit {
  readonly doctorId: string;
  readonly doctorName: string;
  /** YYYY-MM-DD. */
  readonly date: string;
}

export interface DoctorPreference {
  readonly doctorId: string;
  readonly doctorName: string;
  readonly visits: number;
  /** true when this is the most recent doctor as well as the leading one. */
  readonly alsoMostRecent: boolean;
  /** Why this doctor was chosen — shown to the AI so it can speak honestly. */
  readonly reason: 'most_visits' | 'most_recent_close';
}

/** A visit that was cancelled or not attended tells us nothing about preference. */
const NOT_A_VISIT = new Set(['cancelled', 'no-show']);

/**
 * Which doctor to offer a returning patient, or null when there is no history.
 *
 * @param visits every appointment for the patient, any order
 * @param minVisits how many visits before continuity is assumed at all
 */
export function preferredDoctor(
  visits: readonly Visit[],
  minVisits = 1,
): DoctorPreference | null {
  const real = visits
    .filter((v) => v.doctorId && v.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (real.length < Math.max(1, minVisits)) return null;

  /* Tally visits per doctor, keeping the newest date seen for each. */
  const tally = new Map<string, { name: string; count: number; lastDate: string }>();
  for (const v of real) {
    const row = tally.get(v.doctorId);
    if (row) {
      row.count += 1;
    } else {
      tally.set(v.doctorId, { name: v.doctorName, count: 1, lastDate: v.date });
    }
  }

  const ranked = [...tally.entries()]
    .map(([doctorId, r]) => ({ doctorId, doctorName: r.name, visits: r.count }))
    /* Most visits first; a tie in visits goes to the more recent, because with
     * equal counts the newest visit is the only thing left to go on. */
    .sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      const da = real.find((v) => v.doctorId === a.doctorId)!.date;
      const db = real.find((v) => v.doctorId === b.doctorId)!.date;
      return da < db ? 1 : da > db ? -1 : 0;
    });

  const leader = ranked[0]!;
  const newest = real[0]!;

  /* The recent visit belongs to a DIFFERENT doctor. If that doctor is close
   * behind — within one visit — the recent visit is treated as the real
   * preference, not an exception. */
  if (newest.doctorId !== leader.doctorId) {
    const recent = ranked.find((r) => r.doctorId === newest.doctorId)!;
    if (leader.visits - recent.visits <= 1) {
      return {
        doctorId: recent.doctorId,
        doctorName: recent.doctorName,
        visits: recent.visits,
        alsoMostRecent: true,
        reason: 'most_recent_close',
      };
    }
  }

  return {
    doctorId: leader.doctorId,
    doctorName: leader.doctorName,
    visits: leader.visits,
    alsoMostRecent: newest.doctorId === leader.doctorId,
    reason: 'most_visits',
  };
}

/** Convenience: visits worth counting, from rows that may carry a status. */
export function realVisits(
  rows: readonly (Visit & { status?: string | null })[],
): Visit[] {
  return rows
    .filter((r) => !NOT_A_VISIT.has(String(r.status ?? '')))
    .map((r) => ({ doctorId: r.doctorId, doctorName: r.doctorName, date: r.date }));
}

/**
 * Strip titles and punctuation so "Dr. Siti", "dr siti" and "Doktor Siti" all
 * reach the same place. Deliberately lossy: the part that must be exact is the
 * MATCH, not the formatting.
 */
export function cleanDoctorName(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\b(dr|doktor|doctor)\.?\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a doctor the PATIENT NAMED to exactly one candidate — or nobody.
 *
 * WHY "OR NOBODY" IS THE WHOLE POINT
 *
 * A patient writes "nak Dr Siti". Two doctors in the branch are named "Siti":
 * we do not know which was meant, and the two failure modes are not symmetric.
 * Asking again costs one message. Booking the patient with the wrong Dr. Siti
 * costs a wasted visit and the trust the whole feature exists to earn. So an
 * ambiguous name returns null and the caller falls back to asking — never a
 * "closest" guess.
 *
 * TWO STAGES, MOST SPECIFIC FIRST
 *
 *   1. The patient wrote a full name. "siti nurhaliza" identifies one doctor even
 *      when two colleagues share the first name — this is the escape hatch from
 *      ambiguity, so it is tried first.
 *   2. Otherwise the FIRST NAME must appear as a whole word. Whole words only:
 *      "halim" (a surname) must not match "Siti Halim", because a patient typing
 *      a surname has not told us who they mean.
 *
 * Matching is on words, never substrings, so "siti" cannot match "Sitiana".
 */
export function matchDoctorName<T extends { doctorName: string }>(
  candidates: readonly T[],
  raw: string,
): T | null {
  const cleaned = cleanDoctorName(raw);
  if (cleaned.length < 2) return null;

  const named = candidates
    .map((c) => ({ candidate: c, name: cleanDoctorName(c.doctorName) }))
    .filter((x) => x.name.length > 0);

  /* Stage 1 — the whole thing is the doctor's name. */
  const exact = named.filter((x) => x.name === cleaned);
  if (exact.length === 1) return exact[0]!.candidate;
  if (exact.length > 1) return null; // same name twice: cannot choose

  /* Stage 2 — the patient's text CONTAINS the doctor's first name as a word.
   * The text may carry other words ("nak Dr Siti"), so we look for the name
   * rather than expecting the name alone. */
  const words = new Set(cleaned.split(' '));
  const byFirstName = named.filter((x) => {
    const first = x.name.split(' ')[0] ?? '';
    return first.length > 0 && words.has(first);
  });

  return byFirstName.length === 1 ? byFirstName[0]!.candidate : null;
}

/**
 * How the AI should open when a preferred doctor exists.
 *
 * Kept here rather than in the prompt so the wording can be tested, and so the
 * AI is told what it KNOWS rather than being invited to infer it. A number and a
 * name are facts; "we think you prefer Dr. Siti" is not.
 */
export function preferenceLine(pref: DoctorPreference | null): string {
  if (!pref) return '';
  const times = pref.visits === 1 ? '1 kali' : `${pref.visits} kali`;
  return `Doktor biasa pesakit ini: ${pref.doctorName} (${times} rawatan).`;
}
