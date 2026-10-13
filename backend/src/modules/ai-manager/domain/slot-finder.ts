/**
 * FASA 6A — finding appointment slots a patient can actually take.
 *
 * THE PROBLEM THIS SOLVES
 *
 * When a requested slot is full, the AI currently replies "sila pilih masa lain"
 * and stops. The patient is left to guess. They try 4pm, it is taken; they try
 * 5pm, taken; they give up, and the clinic never learns a patient was lost at
 * 1am with toothache.
 *
 * So the system hands the conversation a short list of slots that ARE free, and
 * the AI talks about those. Two rules make this safe:
 *
 *   1. THE AI NEVER INVENTS A SLOT. Every option it offers came from here, and
 *      every option here was checked against the doctor's shift and the existing
 *      appointments. A hallucinated "4pm" is a patient arriving to a full chair.
 *
 *   2. THE DECISION IS NOT THE MODEL'S. Which slots are free is arithmetic over
 *      the schedule, not a judgement call — so it lives in code, where it can be
 *      tested, and not in a prompt, where it cannot.
 *
 * WHY TWO OPTIONS
 *
 * One option is not a choice; five is a decision the patient did not ask to make.
 * Two, near what they wanted, is the shape of a real conversation.
 *
 * WHY TIME IS MINUTES FROM MIDNIGHT
 *
 * Times come from MySQL as "10:30:00" and from the patient as "10.30 pagi", "2
 * petang", "14:00". Turning all of it into one integer early means the arithmetic
 * below never has to think about formats, and an off-by-one is visible in a test
 * rather than hidden in a string comparison.
 */

/** Minutes from midnight. 600 = 10:00. */
export type Minutes = number;

export interface DoctorShift {
  readonly doctorId: string;
  readonly doctorName: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Shift start, minutes from midnight. */
  readonly startMin: Minutes;
  /** Shift end, minutes from midnight (exclusive of work at or after this). */
  readonly endMin: Minutes;
}

export interface BusyBlock {
  readonly doctorId: string;
  readonly date: string;
  readonly startMin: Minutes;
  readonly durationMin: number;
}

export interface SlotQuery {
  readonly shifts: readonly DoctorShift[];
  readonly busy: readonly BusyBlock[];
  /** Appointment length. Default 30 minutes. */
  readonly durationMin?: number;
  /** Slot granularity. Default 30 minutes. */
  readonly stepMin?: number;
  /**
   * The doctor the patient asked for, or was offered and accepted. When set, only
   * this doctor's shifts are considered — offering someone else would ignore what
   * the patient just said.
   */
  readonly preferredDoctorId?: string | null;
  /** The date/time the patient hoped for; options are ranked by closeness. */
  readonly preferredDate?: string | null;
  readonly preferredMin?: Minutes | null;
  /** How many options to return. Default 2. */
  readonly limit?: number;
  /**
   * Clinic lunch break, when the chair is not in use whatever the shift says.
   * Defaults to 13:00–14:00, which is the clinic's stated break. Pass null to
   * ignore breaks entirely.
   */
  readonly breakWindow?: { startMin: Minutes; endMin: Minutes } | null;
}

export interface FreeSlot {
  readonly date: string;
  readonly startMin: Minutes;
  /** "15:30" */
  readonly time: string;
  /** "3:30 petang" — the way a receptionist would say it to a patient. */
  readonly label: string;
  readonly doctorId: string;
  readonly doctorName: string;
  /** true when this slot is on the doctor the patient asked for. */
  readonly sameDoctor: boolean;
}

export const DEFAULT_DURATION_MIN = 30;
export const DEFAULT_STEP_MIN = 30;
export const DEFAULT_LIMIT = 2;

/** The clinic's lunch break, from the booking prompt. */
export const DEFAULT_BREAK = { startMin: 13 * 60, endMin: 14 * 60 };

/** "10:30" or "10:30:00" to minutes. Returns null for anything else. */
export function parseTime(value: string | null | undefined): Minutes | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 930 to "15:30". */
export function formatTime(min: Minutes): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 930 to "3:30 petang".
 *
 * A receptionist says "tiga setengah petang", not "15:30". The patient is reading
 * this on a phone at 1am; the familiar form is the one they can check at a glance.
 *
 * Boundaries follow the clinic's own booking prompt, which says "10:00 pagi",
 * "2 petang", "6 malam": pagi until noon, tengah hari to 3pm, petang to 7pm,
 * malam after. An earlier version put the petang boundary at 7pm, which made
 * 3:30pm read as "tengah hari" — wrong, and the kind of wrong a Malaysian reader
 * notices immediately.
 */
export function formatMalayTime(min: Minutes): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const suffix =
    h24 < 12 ? 'pagi'
      : h24 < 15 ? 'tengah hari'
        : h24 < 19 ? 'petang'
          : 'malam';
  /* 12-hour clock: 13:00 is 1:00, not 13:00. Midnight/noon stay 12. */
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12}:00 ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Overlap test, half-open [start, start+duration). */
function overlaps(aStart: Minutes, aDur: number, bStart: Minutes, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

/**
 * Free slots, best match first.
 *
 * Ranking, in order:
 *   1. ON THE REQUESTED DATE, near the requested time — the patient asked for
 *      Tuesday 3pm, so Tuesday 4pm beats Wednesday 10am by a wide margin.
 *   2. Then by date, then by time. Later days only appear once the wanted day is
 *      exhausted, which is what "kalau penuh, cadang hari seterusnya" means.
 *
 * One option per (date, time): two doctors free at 4pm is ONE choice for a patient
 * who does not care who they see, so the better-ranked doctor represents it.
 */
export function findFreeSlots(query: SlotQuery): FreeSlot[] {
  const duration = query.durationMin ?? DEFAULT_DURATION_MIN;
  const step = query.stepMin ?? DEFAULT_STEP_MIN;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const brk = query.breakWindow === undefined ? DEFAULT_BREAK : query.breakWindow;

  const wantedDoctor = query.preferredDoctorId ?? null;
  const wantedDate = query.preferredDate ?? null;
  const wantedMin = query.preferredMin ?? null;

  const candidates: FreeSlot[] = [];

  for (const shift of query.shifts) {
    /* A patient who asked for Dr. Siti is not helped by an opening with Dr. Ahmad. */
    if (wantedDoctor && shift.doctorId !== wantedDoctor) continue;

    /* The last appointment must END by the shift end. A 30-minute appointment
     * starting at 16:45 in a shift ending 17:00 would run past the doctor's
     * hours, and the chair would be occupied after closing. */
    const lastStart = shift.endMin - duration;
    if (lastStart < shift.startMin) continue;

    for (let start = shift.startMin; start <= lastStart; start += step) {
      /* Lunch: the chair is not in use even though the shift spans it. */
      if (brk && overlaps(start, duration, brk.startMin, brk.endMin - brk.startMin)) continue;

      /* Busy: this doctor already has something overlapping. Two doctors can be
       * free at the same instant — that is a different doctor, not a conflict. */
      const taken = query.busy.some(
        (b) =>
          b.doctorId === shift.doctorId &&
          b.date === shift.date &&
          overlaps(start, duration, b.startMin, b.durationMin),
      );
      if (taken) continue;

      candidates.push({
        date: shift.date,
        startMin: start,
        time: formatTime(start),
        label: formatMalayTime(start),
        doctorId: shift.doctorId,
        doctorName: shift.doctorName,
        sameDoctor: Boolean(wantedDoctor && shift.doctorId === wantedDoctor),
      });
    }
  }

  /* One entry per (date, time): the first shift wins, and shifts arrive in the
   * order the caller supplied (by doctor name, say), so the choice is stable
   * rather than depending on object order. */
  const seen = new Set<string>();
  const unique: FreeSlot[] = [];
  for (const c of candidates) {
    const key = `${c.date} ${c.startMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const sameDay = (s: FreeSlot) => (wantedDate ? s.date === wantedDate : false);

  unique.sort((a, b) => {
    /* 1. The day the patient asked for. */
    const ad = sameDay(a) ? 0 : 1;
    const bd = sameDay(b) ? 0 : 1;
    if (ad !== bd) return ad - bd;

    /* 2. Distance from the time they asked for, within that grouping. */
    if (wantedMin !== null) {
      const da = Math.abs(a.startMin - wantedMin);
      const db = Math.abs(b.startMin - wantedMin);
      /* Earlier wins a tie: a patient told "3pm is full" would rather hear 2:30
       * than 3:30, and waiting longer than asked is the worse surprise. */
      if (da !== db) return da - db;
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    }

    /* 3. Then chronological: earlier days first. */
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return a.doctorName.localeCompare(b.doctorName);
  });

  return unique.slice(0, limit);
}
