/**
 * Encounter status state machine (Sprint 3 S3-B).
 *   open → completed | cancelled (both terminal).
 * Same-state = valid no-op. Pure & deterministic.
 */
export const ENCOUNTER_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export function isEncounterStatus(value: string): value is EncounterStatus {
  return (ENCOUNTER_STATUSES as readonly string[]).includes(value);
}

export function canTransitionEncounter(from: string, to: string): boolean {
  if (!isEncounterStatus(from) || !isEncounterStatus(to)) return false;
  if (from === to) return true;
  if (from === 'open') return to === 'completed' || to === 'cancelled';
  return false; /* completed/cancelled are terminal */
}
