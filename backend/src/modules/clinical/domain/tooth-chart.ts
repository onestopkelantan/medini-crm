/**
 * Continuous tooth chart (Fasa 1B).
 *
 * THE DECISION THIS FILE IMPLEMENTS
 *
 * `tooth_records` stores a chart PER ENCOUNTER: `encounter_id` is NOT NULL and
 * the unique key is `(encounter_id, fdi_no)`. That is correct for the record —
 * every change is a dated, attributed clinical event, and the history must
 * survive. But it is the wrong shape to READ from: a patient with 12 visits has
 * up to 384 rows, and "what does this mouth look like right now" is not among
 * them as a single answer.
 *
 * So the chart is stored per encounter and READ continuously: this file reduces
 * the event log to one entry per tooth — the MOST RECENT one — which is what a
 * dentist wants on screen.
 *
 * THE ORDERING RULE, AND WHY IT IS `updated_at` NOT `created_at`
 *
 * A tooth's condition can be CORRECTED inside the same open encounter: the
 * upsert path updates the existing row rather than inserting a second one. So
 * the newest fact about a tooth is `updated_at`, not `created_at` — reading by
 * `created_at` would show a corrected tooth at its original, wrong value
 * forever. `id` breaks ties so the result is deterministic rather than
 * dependent on the database's row order.
 *
 * Pure & deterministic — no database, no clock.
 */

import { TOOTH_CONDITIONS } from './tooth-conditions';

/** One stored chart event, as the read side sees it. */
export interface ToothEvent {
  readonly fdiNo: number;
  readonly condition: string;
  readonly symbolCode?: string | null;
  /**
   * The tooth surfaces this record is about, as canonical letters (M/O/D/B/L).
   * Nullable: a whole-tooth finding (missing, implant) has no surface, and every
   * row written before surface charting existed carries none. The chart UI fills
   * only these regions; absent means the whole tooth carries the condition.
   */
  readonly surfaces?: readonly string[] | null;
  readonly notes?: string | null;
  readonly encounterId: string;
  /** Who charted it. Nullable: historical rows may predate attribution. */
  readonly doctorId?: string | null;
  /** When it was first recorded. */
  readonly createdAt?: Date | string | null;
  /** When it was last corrected. The ORDERING KEY. */
  readonly updatedAt?: Date | string | null;
  readonly id: string;
  /**
   * How many events exist for this tooth, when the caller ALREADY KNOWS and the
   * events have been collapsed before reaching here (the SQL path returns one
   * row per tooth, so counting the array would always give 1).
   *
   * Omit it and the count is derived from the array — correct for the unit tests
   * and any caller that passes a genuine event log, wrong for a pre-reduced set.
   */
  readonly eventCount?: number;
}

/** One tooth on the chart as it stands today. */
export interface ChartTooth {
  readonly fdiNo: number;
  readonly condition: string;
  readonly symbolCode: string | null;
  /**
   * Canonical surface letters (M/O/D/B/L) carried by the LATEST event for this
   * tooth. Null when the finding is whole-tooth or was recorded before surfaces
   * existed. The UI fills only these regions of the odontogram.
   */
  readonly surfaces: readonly string[] | null;
  readonly notes: string | null;
  /** The encounter that produced this state — the audit handle. */
  readonly encounterId: string;
  readonly doctorId: string | null;
  readonly recordedAt: Date | string | null;
  /** How many events exist for this tooth, including this one. >1 means the
   * tooth has a history worth opening, which the UI shows as an indicator. */
  readonly eventCount: number;
}

export interface ContinuousChart {
  readonly patientId: string;
  /** Present teeth, ascending by FDI. */
  readonly teeth: readonly ChartTooth[];
  /** Teeth with no recorded event at all — absent from `teeth`, and the UI
   * renders them as un-charted rather than as `healthy`. The distinction
   * matters: "not examined" is not "no disease". */
  readonly chartedCount: number;
  readonly lastRecordedAt: Date | string | null;
}

/* ------------------------------------------------------------- comparison */

/**
 * Timestamp as a number, with a defined answer for everything unusable.
 *
 * Missing/invalid sorts to the BOTTOM (0), not to "now". A row with no
 * timestamp is unorderable, and treating it as newest would let an
 * un-attributed legacy row overwrite a real clinical finding.
 */
function ts(v: Date | string | null | undefined): number {
  if (v == null) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Is `a` a strictly newer fact about the tooth than `b`?
 *
 * `updatedAt` first, then `createdAt` as a fallback for rows written before
 * `updated_at` existed, then `id` descending purely to make the outcome
 * deterministic when timestamps are identical (two corrections in the same
 * millisecond). Determinism here is not cosmetic — the SAME data must always
 * produce the SAME chart, or a screen can flicker between two conditions on
 * reload and neither is falsifiable.
 */
export function isNewerEvent(a: ToothEvent, b: ToothEvent): boolean {
  const au = ts(a.updatedAt), bu = ts(b.updatedAt);
  if (au !== bu) return au > bu;
  const ac = ts(a.createdAt), bc = ts(b.createdAt);
  if (ac !== bc) return ac > bc;
  return a.id > b.id;
}

/* ----------------------------------------------------------------- reduce */

/**
 * The canonical surface letters a tooth record may carry. Everything else a
 * legacy row might hold is dropped — a tooth has exactly these five addressable
 * surfaces (mesial, occlusal/incisal, distal, buccal, lingual/palatal), and a
 * chart that drew an unknown letter would be drawing a region that does not
 * exist. Order is the picker's display order, and it is stable: dedupe keeps
 * the FIRST occurrence so a writer that sent ["O","M","O"] stores ["O","M"].
 */
export const CANONICAL_SURFACES = ['M', 'O', 'D', 'B', 'L'] as const;
export type CanonicalSurface = (typeof CANONICAL_SURFACES)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_SURFACES);

/**
 * Coerce whatever the JSON column holds into canonical letters.
 *
 * Null/empty → null (whole tooth). Non-canonical entries are dropped silently
 * rather than rejected loudly because this runs on the READ path of a clinical
 * screen: a tooth with a weird stored value must still render, and rendering it
 * as a whole-tooth condition is the conservative reading.
 */
export function normalizeSurfaces(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  const kept: string[] = [];
  for (const v of raw) {
    const letter = typeof v === 'string' ? v.trim().toUpperCase() : null;
    if (letter && CANONICAL_SET.has(letter) && !kept.includes(letter)) kept.push(letter);
  }
  return kept.length ? kept : null;
}

/**
 * Reduce an event log to one entry per tooth — the latest.
 *
 * Deliberately tolerates ANY input order. The SQL path sorts for efficiency,
 * but the correctness of the chart must not depend on the query having done so
 * — a reducer that quietly requires pre-sorted input is a bug waiting for
 * someone to change the ORDER BY.
 */
export function continuousChart(
  patientId: string,
  events: readonly ToothEvent[],
): ContinuousChart {
  const latest = new Map<number, ToothEvent>();
  /** How many events we were handed per tooth. */
  const seen = new Map<number, number>();
  /** The largest count a pre-reduced caller told us about per tooth. */
  const carried = new Map<number, number>();

  for (const e of events) {
    seen.set(e.fdiNo, (seen.get(e.fdiNo) ?? 0) + 1);
    if (e.eventCount != null) {
      carried.set(e.fdiNo, Math.max(carried.get(e.fdiNo) ?? 0, e.eventCount));
    }
    const cur = latest.get(e.fdiNo);
    if (!cur || isNewerEvent(e, cur)) latest.set(e.fdiNo, e);
  }

  /*
   * THE COUNT COMES FROM WHICHEVER SOURCE KNOWS MORE, and both cases are real:
   *
   *  - A genuine event log (the unit tests, any caller passing raw rows): we were
   *    handed every event, so counting them is the answer.
   *  - The SQL read path: `listLatestToothRecords` returns ONE row per tooth
   *    precisely so the caller does not have to reduce 12 visits x 32 teeth. It
   *    carries the real count in `eventCount`, because counting the array here
   *    would report 1 for a tooth charted in three visits — a wrong number that
   *    reads as "no history", which is worse than no number at all.
   *
   * `max` satisfies both and cannot under-report. It also picks the FIRST cut of
   * this function's bug in testing: a plain `+ 1` accumulator silently returned 1
   * for the pre-reduced path.
   */
  const counts = new Map<number, number>();
  for (const fdi of new Set([...seen.keys(), ...carried.keys()])) {
    counts.set(fdi, Math.max(seen.get(fdi) ?? 0, carried.get(fdi) ?? 0));
  }

  const teeth: ChartTooth[] = [...latest.values()]
    .map((e) => ({
      fdiNo: e.fdiNo,
      condition: e.condition,
      symbolCode: e.symbolCode ?? null,
      /* Normalize once at the boundary: the SQL column is JSON, so a legacy or
       * foreign writer could have stored anything. Non-array or empty → null
       * (whole tooth); strings are kept as-is only when canonical, so a bad
       * value renders as "whole tooth" rather than crashing the chart. */
      surfaces: normalizeSurfaces(e.surfaces),
      notes: e.notes ?? null,
      encounterId: e.encounterId,
      doctorId: e.doctorId ?? null,
      recordedAt: e.updatedAt ?? e.createdAt ?? null,
      eventCount: counts.get(e.fdiNo) ?? 1,
    }))
    .sort((a, b) => a.fdiNo - b.fdiNo);

  let lastRecordedAt: Date | string | null = null;
  let lastTs = -1;
  for (const e of events) {
    const t = Math.max(ts(e.updatedAt), ts(e.createdAt));
    if (t > lastTs) {
      lastTs = t;
      lastRecordedAt = e.updatedAt ?? e.createdAt ?? null;
    }
  }

  return {
    patientId,
    teeth,
    chartedCount: teeth.length,
    lastRecordedAt,
  };
}

/* -------------------------------------------------------------- summary */

/** Counts by condition, for the chart's summary strip. Only present teeth. */
export function conditionCounts(chart: ContinuousChart): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of chart.teeth) out[t.condition] = (out[t.condition] ?? 0) + 1;
  return out;
}

/**
 * Teeth with no event that require the dentist's attention on a summary line.
 *
 * Returns the FDI numbers, not a count, because "4 teeth need attention" makes
 * a dentist hunt; naming them is the whole value of a summary.
 *
 * Ordering is WORST FIRST by an explicit severity ladder rather than by
 * condition name, so the most urgent tooth is the one read first.
 */
const ATTENTION_RANK: Readonly<Record<string, number>> = {
  decayed: 5,
  periapical: 4,
  mobility: 3,
  impacted: 2,
  crowned: 1,
  root_canal: 1,
  implant: 1,
  filled: 0,
  healthy: 0,
  missing: 0,
  extracted: 0,
};

export function teethNeedingAttention(chart: ContinuousChart): number[] {
  return chart.teeth
    .filter((t) => (ATTENTION_RANK[t.symbolCode ?? ''] ?? 0) > 0 || (ATTENTION_RANK[t.condition] ?? 0) > 0)
    .slice()
    .sort((a, b) => {
      const ra = Math.max(ATTENTION_RANK[a.symbolCode ?? ''] ?? 0, ATTENTION_RANK[a.condition] ?? 0);
      const rb = Math.max(ATTENTION_RANK[b.symbolCode ?? ''] ?? 0, ATTENTION_RANK[b.condition] ?? 0);
      return rb - ra || a.fdiNo - b.fdiNo;
    })
    .map((t) => t.fdiNo);
}

/** The 7 conditions a caller may write — derived from the enum, never a second
 * hand-maintained list that can silently drift from it.
 *
 * Deliberately NOT annotated `readonly ToothCondition[]`: the annotation would
 * WIDEN the `as const` tuple into a plain array, and `z.enum()` in zod v3
 * requires a literal tuple. Deriving keeps the two in lockstep at the type
 * level — add an enum value and the schema follows, or the build fails. */
export const WRITABLE_CONDITIONS = TOOTH_CONDITIONS;
