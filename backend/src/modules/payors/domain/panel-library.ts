/**
 * Built-in Panel Library — static immutable reference data (Sprint 2A T3).
 *
 * NOT a database table — zero migration, zero RLS, zero seed rows. Cloning
 * copies fields into a normal panel_companies record (source='builtin').
 * Keys are stable identifiers used by POST /panels/clone.
 */

export interface BuiltinPanel {
  readonly key: string;
  readonly name: string;
  readonly address: string;
}

export const BUILTIN_PANEL_LIBRARY: readonly BuiltinPanel[] = [
  {
    key: 'healthmetrics',
    name: 'HealthMetrics',
    address: 'B-04, LEVEL 4, The Place @ ONE City, Jalan USJ 25/1, 47650 Subang Jaya, Selangor',
  },
  {
    key: 'medident',
    name: 'MediDent',
    address: 'Lot 5.07, 5th FLOOR, Wisma Cosway, Jalan Raja Chulan, 50200 Kuala Lumpur',
  },
  {
    key: 'medkad',
    name: 'MedKad',
    address: 'No.117 Block 3, No.7 Persiaran Sukan Laman Seri Business Park, Seksyen 13, 40100 Shah Alam',
  },
  {
    key: 'micare',
    name: 'MiCare',
    address: 'Block A, No. 22, Jalan Astaka U8/84, Seksyen U8, Bukit Jelutong, 40150 Shah Alam, Selangor',
  },
  {
    key: 'tuneprotect',
    name: 'TuneProtect',
    address: 'Level 8, Wisma Tune, 19 Lorong Dungun, Damansara Heights, 50490 Kuala Lumpur',
  },
] as const;

/** Lookup a library entry by its stable key. Returns undefined for unknown keys. */
export function findBuiltinPanel(key: string): BuiltinPanel | undefined {
  return BUILTIN_PANEL_LIBRARY.find((p) => p.key === key);
}
