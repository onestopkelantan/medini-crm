/**
 * FASA 5C-E — clinical safety guards for outbound WhatsApp.
 *
 * Two independent duties, both about what a message may say to whom.
 *
 *   1. ADDRESSING — a paediatric patient does not read their own WhatsApp.
 *
 *   2. PRIVACY — WhatsApp is not a clinical channel. The guard blocks what the
 *      PATIENT HAS (their conditions, their own treatment history) and allows
 *      what the CLINIC OFFERS (services, appointments, promotions).
 *
 * WHY THIS IS A CODE GUARD AND NOT AN OPERATOR WARNING
 *
 * The recipient picker shows a warning telling staff not to name a diagnosis.
 * A warning depends on a busy receptionist reading it at 6pm on a Friday. This
 * guard runs on the message that is actually about to be sent, and a sentence
 * that leaks a diagnosis is refused rather than discouraged.
 *
 * WHY IT IS DELIBERATELY NARROW
 *
 * A guard that blocks ordinary clinical marketing gets switched off, and then
 * protects nobody. So it matches a curated list of condition names and history
 * phrases — not the word "gigi", not the word "rawatan". "Promosi pembersihan
 * gigi" is advertising and passes; "anda ada karies" is a disclosure and fails.
 */

/* ==========================================================================
   ADDRESSING
   ========================================================================== */

/** Age at which a patient speaks for themselves. Malaysia's age of majority. */
export const MINOR_AGE_YEARS = 18;

export interface AddressInput {
  name: string;
  /** ISO date (YYYY-MM-DD). Null when the clinic has not recorded it. */
  dob: string | null;
  /** Guardian on file, when linked. */
  guardianName: string | null;
  /** The clinic's own classification: adult | child | infant | senior. */
  patientType?: string | null;
}

export interface AddressForm {
  isMinor: boolean;
  /** How the message refers to the patient: "anda" or "anak anda". */
  pronoun: 'anda' | 'anak anda';
  /** Who the message greets. */
  salutation: string;
  /** Relationship framing, e.g. "ibubapa kepada Nur Aisyah". */
  context: string | null;
  guardianMissing: boolean;
  dobMissing: boolean;
}

/** Whole years between a birth date and a reference instant. */
function ageInYears(dob: string, now: Date): number | null {
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  /* Not yet had this year's birthday → one year younger. */
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) {
    age--;
  }
  return age;
}

/**
 * Respectful Malay address for a named person.
 *
 * The honourific cannot be inferred reliably — "Siti" could be Puan or Cik,
 * "Ahmad" could be Encik or Puan. So this uses the neutral Tuan/Puan unless the
 * name itself makes the choice obvious. Guessing wrong is worse than neutral:
 * a message addressed to the wrong gender reads as a scam to the recipient.
 */
function honourific(name: string): string {
  return `Encik/Puan ${name}`;
}

/**
 * Decide how a message should address this patient.
 *
 * A minor is ALWAYS addressed through their guardian. Where no guardian is
 * recorded, the message is neutral ("Tuan/Puan", "anak anda") rather than
 * guessing — the clinic is told the link is missing so it can be fixed.
 */
export function addressForm(input: AddressInput, now: Date): AddressForm {
  const age = input.dob ? ageInYears(input.dob, now) : null;
  const dobMissing = age === null;

  /* patient_type is the clinic's explicit classification and is trusted when
   * the DOB is absent. A recorded DOB always wins, because it is a date and
   * patient_type is a label someone chose. */
  const typedMinor =
    !dobMissing
      ? false
      : /child|infant|baby|kanak/i.test(input.patientType ?? '');

  const isMinor = dobMissing ? typedMinor : (age as number) < MINOR_AGE_YEARS;

  if (!isMinor) {
    return {
      isMinor: false,
      pronoun: 'anda',
      salutation: honourific(input.name),
      context: null,
      guardianMissing: false,
      dobMissing,
    };
  }

  const guardian = input.guardianName?.trim();

  return {
    isMinor: true,
    /* Even with no guardian recorded, "anda" would be wrong: the child is not
     * the reader. "anak anda" stays correct whoever receives it. */
    pronoun: 'anak anda',
    salutation: guardian ? honourific(guardian) : 'Tuan/Puan',
    context: `ibubapa kepada ${input.name}`,
    guardianMissing: !guardian,
    dobMissing,
  };
}

/* ==========================================================================
   PRIVACY
   ========================================================================== */

export type FindingCategory = 'diagnosis' | 'treatment_history' | 'clinical_tag';

export interface ScreenFinding {
  category: FindingCategory;
  term: string;
  /** 1-based line number, for highlighting in the operator's editor. */
  line: number;
  /** The matching text, trimmed, so the operator sees the context. */
  snippet: string;
}

export interface ScreenVerdict {
  safe: boolean;
  findings: ScreenFinding[];
  reason: string | null;
}

/**
 * Condition names that must never appear in an outbound patient message.
 *
 * Curated for Malaysian dental practice, both languages, because patients and
 * staff mix them. Kept to words that name a CONDITION — not anatomy, not
 * services — so ordinary marketing does not trip it.
 */
const DIAGNOSIS_TERMS: readonly string[] = [
  /* Malay */
  'karies', 'kaviti', 'abses', 'jangkitan', 'periodontitis', 'gingivitis',
  'gusi berdarah', 'gusi bengkak', 'gigi reput', 'gigi berlubang', 'gigi patah',
  'kista', 'tumor', 'ulser', 'kanser', 'penyakit gusi', 'radang',
  /* English */
  'caries', 'cavity', 'abscess', 'infection', 'periodontitis', 'gingivitis',
  'gum disease', 'bleeding gums', 'swollen gums', 'decay', 'cyst', 'tumour',
  'tumor', 'ulcer', 'cancer', 'inflammation',
  /* Pregnancy affects treatment planning and is highly sensitive. */
  'hamil', 'mengandung', 'pregnant', 'pregnancy',
];

/**
 * Phrases that reveal what was done to this patient.
 *
 * Separate from diagnoses: "rawatan saluran akar anda belum siap" names no
 * disease but discloses a procedure, which is the same privacy leak.
 */
const HISTORY_TERMS: readonly string[] = [
  'rawatan saluran akar anda',
  'rawatan akar anda',
  'root canal anda',
  'cabutan gigi anda',
  'gigi palsu anda',
  'implannya anda',
  'implannya belum',
  'pemutihan gigi anda',
  'tampalan anda',
  'rawatan anda yang',
  'rawatan anda belum',
  'belum siap rawatan anda',
  'your root canal',
  'your extraction',
  'your filling',
  'your implant',
  'your treatment',
];

/**
 * Tags whose value differs per patient and is clinical.
 *
 * `{nama}`, `{cawangan}` and `{link}` are fine. `{rawatan}` would substitute the
 * patient's own treatment name at send time — safe-looking at review, a leak in
 * the sent message, once per recipient.
 */
const CLINICAL_TAGS: readonly string[] = [
  '{rawatan}', '{diagnosis}', '{treatment}', '{condition}', '{ubat}',
  '{medication}', '{prosedur}', '{procedure}',
];

/** Whole-word match so "kelas" does not trip on a term inside another word. */
function findTerm(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* \b behaves badly around non-ASCII in JS regex without the u flag, so the
   * boundary is expressed as "not a letter/digit on either side". */
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
  const m = re.exec(haystack);
  return m ? m.index : -1;
}

/**
 * Screen a composed message before it can be queued for sending.
 *
 * Returns every finding rather than the first, so the operator can fix all of
 * them in one pass instead of resubmitting repeatedly.
 */
export function screenMessage(body: string): ScreenVerdict {
  const findings: ScreenFinding[] = [];
  const lines = body.split('\n');

  const groups: Array<{ category: FindingCategory; terms: readonly string[] }> = [
    { category: 'diagnosis', terms: DIAGNOSIS_TERMS },
    { category: 'treatment_history', terms: HISTORY_TERMS },
    { category: 'clinical_tag', terms: CLINICAL_TAGS },
  ];

  for (const { category, terms } of groups) {
    for (const term of terms) {
      lines.forEach((line, index) => {
        if (findTerm(line, term) >= 0) {
          findings.push({
            category,
            term,
            line: index + 1,
            snippet: line.trim().slice(0, 120),
          });
        }
      });
    }
  }

  if (findings.length === 0) {
    return { safe: true, findings: [], reason: null };
  }

  /* One plain sentence the operator can act on, no code names. */
  const hasClinical = findings.some(
    (f) => f.category === 'diagnosis' || f.category === 'treatment_history',
  );
  const reason = hasClinical
    ? 'Mesej ini menyebut keadaan kesihatan atau rawatan pesakit. WhatsApp bukan ' +
      'saluran selamat — buang butiran klinikal, dan sebut perkhidmatan sahaja.'
    : 'Mesej ini menggunakan tag yang akan menjadi butiran klinikal pesakit. ' +
      'Gunakan tag {nama}, {cawangan} atau {link} sahaja.';

  return { safe: false, findings, reason };
}
