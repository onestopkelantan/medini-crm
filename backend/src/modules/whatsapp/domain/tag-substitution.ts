/**
 * FASA 5C-F — tag substitution for outbound patient messages.
 *
 * A template says "Salam {nama}!". Nothing until now replaced that tag, so every
 * recipient received the literal text — and the FASA 5C-E privacy screen blocks
 * unresolved tags precisely because a tag that survives to the patient is either
 * a visible defect or, for a clinical tag, a disclosure.
 *
 * WHY THIS FILE ALSO DECIDES ADDRESSING
 *
 * "Salam {nama}!" is right for an adult and wrong for a seven-year-old whose
 * number belongs to their mother. The reader is the guardian, and `{nama}` would
 * name the child. So which name `{nama}` resolves to is an addressing decision,
 * not a string decision — and it is made here, from the same patient record that
 * `addressForm()` reads, so the two cannot drift apart.
 *
 * NO SILENT OVERRIDE
 *
 * An earlier plan had the salutation rewritten at send time. That would make the
 * preview disagree with the sent message: the operator would approve one text and
 * a different one would go out. Instead the patient record decides what `{nama}`
 * means, `{anak}` is available when a template wants the child explicitly, and
 * preview and send call THIS function — so they cannot diverge.
 *
 * WHICH TAGS EXIST
 *
 *   {nama}      the reader — the patient, or the guardian for a minor
 *   {anak}      the child's name (minors only; falls back to {nama} for adults)
 *   {cawangan}  branch name
 *   {link}      the clinic's booking link, supplied by the caller
 *
 * Everything else is reported as unknown, never substituted. `{rawatan}` in
 * particular must NOT be filled: it is a per-patient clinical value, and filling
 * it would bypass the privacy screen by producing a message that no longer
 * contains a tag.
 */

import { addressForm } from '../../marketing/domain/clinical-guard';

export interface TagPatient {
  name: string;
  dob: string | null;
  guardianName: string | null;
  patientType?: string | null;
}

export interface SubstituteInput {
  patient: TagPatient;
  /** Branch name, e.g. "Setia Tropika". */
  branchName: string;
  /** The clinic's booking link. Supplied by the caller — never invented here. */
  bookingUrl: string;
  /** Reference instant, so age arithmetic is testable. */
  now: Date;
}

export interface SubstituteResult {
  body: string;
  /** Tags found that this function does not fill. The caller must decide: block
   *  the message, or accept it. Never silently dropped. */
  unknownTags: string[];
}

/** Used when a name is missing. A blank would read as a broken message; a literal
 *  tag would read as a defect. Neither is acceptable, so a neutral word is used. */
const NAME_FALLBACK = 'Pelanggan';

/** Every tag this function knows how to fill. */
const KNOWN_TAGS = ['nama', 'anak', 'cawangan', 'link'] as const;

/**
 * Fill the supported tags in a message body.
 *
 * Pure and total: never throws, never invents a value. Missing data yields a
 * neutral fallback rather than a blank or an unresolved tag.
 */
export function substituteTags(body: string, input: SubstituteInput): SubstituteResult {
  const { patient, branchName, bookingUrl, now } = input;

  const form = addressForm(
    {
      name: patient.name,
      dob: patient.dob,
      guardianName: patient.guardianName,
      patientType: patient.patientType,
    },
    now,
  );

  /* Who the reader is. For a minor this is the guardian; when the guardian is not
   * recorded the form gives a neutral salutation, and the same neutrality must
   * apply to {nama} — naming the child would address the wrong person. */
  const readerName = form.guardianMissing && form.isMinor
    ? 'Tuan/Puan'
    : form.isMinor
      ? (patient.guardianName?.trim() || NAME_FALLBACK)
      : (patient.name?.trim() || NAME_FALLBACK);

  const childName = patient.name?.trim() || readerName;

  const values: Record<string, string> = {
    nama: readerName,
    /* The child's own name. For an adult this collapses to their own name, so a
     * template that uses {anak} is never wrong, only odd. */
    anak: form.isMinor ? childName : readerName,
    cawangan: branchName?.trim() || '',
    link: bookingUrl?.trim() || '',
  };

  /* Found tags, in the casing the author wrote, so the report matches the text. */
  const found = new Set<string>();
  const unknown = new Set<string>();

  const replaced = body.replace(/\{([a-zA-Z_]+)\}/g, (match, rawTag: string) => {
    const tag = rawTag.toLowerCase();

    if ((KNOWN_TAGS as readonly string[]).includes(tag)) {
      found.add(match);
      return values[tag] ?? '';
    }

    /* Not ours to fill. Reported, and left exactly as written — a clinical tag
     * such as {rawatan} must survive so the privacy screen can still see it. */
    unknown.add(match);
    return match;
  });

  return { body: replaced, unknownTags: [...unknown] };
}

/**
 * Would this body be publishable for this patient?
 *
 * Convenience for callers that want the decision rather than the pieces: a body
 * is publishable only when no tag is left unresolved, because an unresolved tag
 * reaches the patient as visible garbage.
 */
export function isPublishable(body: string, input: SubstituteInput): boolean {
  return substituteTags(body, input).unknownTags.length === 0;
}
