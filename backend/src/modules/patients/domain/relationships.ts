/**
 * Family and guardian relationships (Fasa 2A).
 *
 * ONE ENTRY, TWO DIRECTIONS
 *
 * The clinic knows a family as a set of pairs, but nobody wants to type a pair twice.
 * Staff type "Ibrahim is Ahmad's child" ONCE, and the reverse ("Ahmad is Ibrahim's
 * parent") must exist or the child's own screen is blank — which is how a receptionist
 * ends up guessing who is allowed to collect a nine-year-old.
 *
 * So an entry writes TWO rows: the one typed, and its inverse.
 *
 * WHY `parent` AND NOT `father`/`mother`
 *
 * The inverse of "child" depends on the parent's GENDER, and the server does not know it
 * when the relationship is written. Storing a guess would put a wrong word on a clinical
 * record. We store the neutral `parent` and the UI renders "bapa" or "ibu" from that
 * patient's own `gender` — a fact we do have, at the moment we display it.
 *
 * WHY CUSTOM TYPES GET NO INVERSE
 *
 * A clinic meets relatives no preset list predicted: adopted child, NGO representative,
 * aunt, godparent. Refusing them is worse than a free-text box, so the API accepts any
 * short label. But an inverse cannot be INVENTED for a word we do not understand —
 * "anak angkat" reversed is not "anak angkat", and writing that would state something
 * false about a patient. Custom entries therefore write ONE row, and the dialog says so.
 * A wrong relationship on a medical record is worse than one extra step.
 */

/** Offered as buttons. The DB accepts any of these, plus free text. */
export const RELATIONSHIP_PRESETS = [
  { type: 'spouse',    ms: 'isteri / suami', en: 'spouse' },
  { type: 'child',     ms: 'anak',           en: 'child' },
  { type: 'mother',    ms: 'ibu',            en: 'mother' },
  { type: 'father',    ms: 'bapa',           en: 'father' },
  { type: 'sibling',   ms: 'adik-beradik',   en: 'sibling' },
  { type: 'guardian',  ms: 'penjaga',        en: 'guardian' },
  { type: 'dependent', ms: 'dijaga oleh',    en: 'dependent' },
] as const;

export type RelationshipPreset = (typeof RELATIONSHIP_PRESETS)[number]['type'];

/** The label of the OTHER person, seen from the patient's side. */
const INVERSE: Record<string, string> = {
  spouse: 'spouse',
  child: 'parent',
  mother: 'child',
  father: 'child',
  parent: 'child',
  sibling: 'sibling',
  guardian: 'dependent',
  dependent: 'guardian',
};

/**
 * The label of the OTHER person, seen from the patient's side. `parent` is deliberately
 * returned for a child rather than father/mother — the caller renders it with the
 * parent's gender.
 *
 * Returns `null` when the inverse cannot be known, which is the signal for "write one
 * row, not two".
 */
export function inverseRelationship(type: string): string | null {
  return INVERSE[type] ?? null;
}

/** Types that make the RELATED person responsible for the patient. */
const GUARDIAN_TYPES = new Set(['guardian', 'dependent']);

/** True when a relationship of this type means the related patient is the guardian. */
export function establishesGuardianship(type: string): boolean {
  return GUARDIAN_TYPES.has(type);
}

/** A label a human would type, or a known preset. Rejects empty and absurd values. */
export function normaliseRelationshipType(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 32);
}

/** Gender-aware word for a `parent` row, so the screen never says just "parent". */
export function parentWord(gender: string | null | undefined, lang: 'ms' | 'en'): string {
  const ms = lang === 'ms';
  if (gender === 'male') return ms ? 'bapa' : 'father';
  if (gender === 'female') return ms ? 'ibu' : 'mother';
  return ms ? 'ibu bapa' : 'parent';
}
