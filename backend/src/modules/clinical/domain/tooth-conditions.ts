/**
 * Tooth chart conditions and CONFIGURABLE chart symbols (Fasa 1A).
 *
 * TWO DIFFERENT THINGS, AND CONFLATING THEM IS THE TRAP
 *
 * 1. `TOOTH_CONDITIONS` — the 7 values of the `tooth_records.condition` ENUM.
 *    These are the CLINICAL condition of a tooth and they are IMMUTABLE:
 *    adding one means altering a database enum, which is a migration with a
 *    fan-out (snapshot regeneration, schema spec assertions) for a purely
 *    cosmetic gain. They stay as they are.
 *
 * 2. `DEFAULT_CHART_SYMBOLS` — what the chart DRAWS on a tooth: bridge,
 *    denture, veneer, impacted, extracted, periapical, mobility. Dr Partner
 *    calls this "dental chart symbol" (`chartname`) and lets the clinic define
 *    its own. This is where the missing clinical distinctions actually belong.
 *
 * The first cut of Fasa 1A proposed widening the enum 7 → 14. That was wrong:
 * it would have bought the same result at the cost of a schema change per new
 * symbol, and the clinic would still not be able to define its own. Symbols are
 * a TABLE (`chart_symbols`, seeded per org, editable) so adding one later is a
 * row, not a migration.
 *
 * WHY THE SYMBOLS EXIST AT ALL — two of them fix real diagnostic gaps:
 *   `extracted`  — `missing` cannot distinguish "never erupted" from "taken
 *                  out". For orthodontics that difference is the diagnosis.
 *   `impacted`   — an unerupted tooth in the arch is not `missing`; it is the
 *                  reason for the referral.
 *
 * Pure & deterministic — no database, no clock. The table is read by the
 * repository; this file only defines what a symbol IS.
 */

/* ----------------------------------------------- (1) immutable conditions */

export const TOOTH_CONDITIONS = [
  'healthy', 'decayed', 'filled', 'missing', 'crowned', 'root_canal', 'implant',
] as const;

export type ToothCondition = (typeof TOOTH_CONDITIONS)[number];

/* ------------------------------------------------ (2) configurable symbols */

export interface ChartSymbol {
  /** Stable key stored on `tooth_records.symbol_code`. Never shown to a user. */
  readonly code: string;
  /** Fallback text; the UI renders its own translated label for built-ins. */
  readonly label: string;
  /** Hex colour used by the chart. */
  readonly colour: string;
  /** Which mark to draw inside the tooth outline. */
  readonly mark: SymbolMark;
  /** Display order in the chart legend. */
  readonly sortOrder: number;
  /** True for the 7 shipped defaults; false for anything a clinic adds. */
  readonly isBuiltIn: boolean;
}

/** The marks the chart renderer knows how to draw. A symbol with an unknown
 * mark still renders (flat fill) — the legend must never come up empty because
 * a clinic typed something unexpected. */
export const SYMBOL_MARKS = [
  'none', 'cross', 'slash', 'stroke', 'dot', 'circle', 'wave', 'bar', 'grid',
] as const;
export type SymbolMark = (typeof SYMBOL_MARKS)[number];

/**
 * The 7 shipped symbols. Colours are chosen to stay distinguishable from the
 * 7 condition colours AND from each other at chart size.
 */
export const DEFAULT_CHART_SYMBOLS: readonly ChartSymbol[] = [
  { code: 'impacted',   label: 'Impacted',              colour: '#78350f', mark: 'cross',  sortOrder: 10, isBuiltIn: true },
  { code: 'extracted',  label: 'Extracted',             colour: '#111827', mark: 'cross',  sortOrder: 20, isBuiltIn: true },
  { code: 'bridge',     label: 'Bridge',                colour: '#16a34a', mark: 'bar',    sortOrder: 30, isBuiltIn: true },
  { code: 'denture',    label: 'Denture',               colour: '#ec4899', mark: 'circle', sortOrder: 40, isBuiltIn: true },
  { code: 'veneer',     label: 'Veneer',                colour: '#38bdf8', mark: 'stroke', sortOrder: 50, isBuiltIn: true },
  { code: 'periapical', label: 'Periapical lesion',     colour: '#b91c1c', mark: 'dot',    sortOrder: 60, isBuiltIn: true },
  { code: 'mobility',   label: 'Mobile tooth',          colour: '#ea580c', mark: 'wave',   sortOrder: 70, isBuiltIn: true },
];

/** Default appearance for the 7 enum conditions (the chart's baseline). */
export const CONDITION_APPEARANCE: Readonly<Record<ToothCondition, { colour: string; mark: SymbolMark }>> = {
  healthy:    { colour: '#ffffff', mark: 'none' },
  decayed:    { colour: '#dc2626', mark: 'none' },
  filled:     { colour: '#2563eb', mark: 'none' },
  missing:    { colour: '#d1d5db', mark: 'cross' },
  crowned:    { colour: '#d97706', mark: 'none' },
  root_canal: { colour: '#7c3aed', mark: 'slash' },
  implant:    { colour: '#0d9488', mark: 'grid' },
};

/* ------------------------------------------------------- what a tooth looks like */

/** The stored shape the chart reads. `symbolCode` is NEW in Fasa 1A. */
export interface ToothAppearanceInput {
  condition: string;
  symbolCode?: string | null;
}

export interface ToothAppearance {
  /** Hex fill for the tooth body. */
  readonly colour: string;
  /** Mark drawn on top. */
  readonly mark: SymbolMark;
  /** The symbol that decided this, if any — null when `condition` did. */
  readonly symbolCode: string | null;
}

/**
 * Resolve how one tooth is drawn.
 *
 * PRECEDENCE: a set `symbolCode` WINS over `condition`.
 *
 * That order is deliberate. `condition` is the tooth's clinical state and is
 * always present; a symbol is an ADDITIONAL finding laid over it. A tooth that
 * is `missing` because it was extracted reads `condition='missing'` +
 * `symbolCode='extracted'`, and the chart must show "extracted" — the more
 * specific of the two facts — or the distinction the symbol exists to record
 * would be invisible on screen.
 *
 * An UNKNOWN symbolCode falls back to the condition rather than throwing: a
 * clinic that removes a symbol must not turn every chart that used it into an
 * error. An unknown CONDITION falls back to healthy, matching the old
 * behaviour.
 */
export function resolveToothAppearance(
  input: ToothAppearanceInput,
  symbols: readonly ChartSymbol[] = DEFAULT_CHART_SYMBOLS,
): ToothAppearance {
  const symbol =
    input.symbolCode != null && input.symbolCode !== ''
      ? symbols.find((s) => s.code === input.symbolCode) ?? null
      : null;

  if (symbol) {
    return { colour: symbol.colour, mark: symbol.mark, symbolCode: symbol.code };
  }

  const cond = (CONDITION_APPEARANCE as Record<string, { colour: string; mark: SymbolMark }>)[
    input.condition
  ];
  if (cond) return { colour: cond.colour, mark: cond.mark, symbolCode: null };

  const healthy = CONDITION_APPEARANCE.healthy;
  return { colour: healthy.colour, mark: healthy.mark, symbolCode: null };
}

/* ---------------------------------------------------------------- curation */

/** Longest a clinic-defined symbol code may be (matches the DB column width
 * headroom: `symbol_code` is varchar(64), and a code is prefixed by nothing). */
export const MAX_SYMBOL_CODE_LENGTH = 64;

/**
 * Normalise a clinic-supplied code into something storable and matchable.
 *
 * Lower-cases, trims, and reduces any run of non-alphanumerics to a single `_`.
 * A code is compared by exact string, so normalising at BOTH write and read is
 * what stops "Bridge" and "bridge" from becoming two different symbols that
 * draw the same way — a duplicate the clinic can see but not explain.
 *
 * Returns null for input that normalises to nothing (e.g. "  ---  "), so the
 * caller rejects it instead of storing an empty code.
 */
export function normaliseSymbolCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (slug.length === 0) return null;
  return slug.slice(0, MAX_SYMBOL_CODE_LENGTH);
}

/**
 * Does this symbol collide with an existing one?
 *
 * Compares on the NORMALISED code so `"Bridge"` against a stored `bridge` is
 * reported as a duplicate rather than silently creating a second symbol.
 * `excludeId` lets a symbol be re-saved without colliding with itself.
 */
export function findSymbolCollision(
  candidate: { code: unknown; id?: string },
  existing: readonly (ChartSymbol & { id?: string })[],
): ChartSymbol | null {
  const code = normaliseSymbolCode(candidate.code);
  if (code == null) return null;
  return (
    existing.find(
      (s) =>
        normaliseSymbolCode(s.code) === code &&
        !(candidate.id != null && s.id != null && s.id === candidate.id),
    ) ?? null
  );
}

/**
 * Is a built-in symbol still offered?
 *
 * Built-ins may be RE-COLOURED and RE-ORDERED (a clinic's chart is its own),
 * but not deleted — a chart that already stored `extracted` must keep drawing
 * it, and a deleted built-in would make historical charts silently wrong.
 * A clinic can deactivate one instead, which hides it from NEW entries without
 * invalidating old ones.
 */
export function isDeletableSymbol(symbol: ChartSymbol): boolean {
  return !symbol.isBuiltIn;
}
