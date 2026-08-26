/**
 * Duplicate detection — pure decision logic (unit-testable without a DB).
 *
 * Contract (Sprint 2 / master prompt):
 *  - IC match        → always a duplicate candidate.
 *  - Phone match     → duplicate candidate ONLY when not explainable as a
 *                      shared family phone. Family members (e.g. a child whose
 *                      contactType = 'guardian') legitimately share a phone
 *                      with an existing patient — those are NOT duplicates.
 *
 * NEVER auto-reject — return candidates; the caller decides (warn vs block).
 */

export type DuplicateReason = 'ic' | 'phone';

export interface ExistingPatientLite {
  id: string;
  name: string;
  ic: string | null;
  phone: string | null;
}

export interface DuplicateCandidate {
  patientId: string;
  name: string;
  reason: DuplicateReason;
}

export interface FindDuplicatesInput {
  ic?: string | null;
  phone?: string | null;          /* raw — normalized inside */
  contactType?: string | null;    /* 'guardian' family-linked contacts share phones legitimately */
  existing: ExistingPatientLite[];
}

export function findDuplicates(input: FindDuplicatesInput): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const ic = input.ic?.trim();
  const phone = input.phone?.trim() ?? null; /* caller passes normalized via phone.ts */
  const familyLinked = (input.contactType ?? 'own') !== 'own';

  for (const p of input.existing) {
    if (ic && p.ic && p.ic.trim() === ic) {
      out.push({ patientId: p.id, name: p.name, reason: 'ic' });
      continue;
    }
    if (phone && p.phone && p.phone.trim() === phone && !familyLinked) {
      out.push({ patientId: p.id, name: p.name, reason: 'phone' });
    }
  }
  return out;
}
