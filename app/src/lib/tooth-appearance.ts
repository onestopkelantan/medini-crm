/**
 * Tooth appearance rules — extracted from ToothChart.tsx.
 *
 * WHY THIS FILE EXISTS
 *
 * React Fast Refresh only works when a module exports components and nothing
 * else. `ToothChart.tsx` exported both the chart component AND this pure
 * function, so every edit to the chart forced a full reload. The rule is pure
 * and testable, so it lives here; the component imports it.
 *
 * MIRRORS `resolveToothAppearance` in the backend domain
 * (`tooth-conditions.ts`) — symbol beats condition, and an unknown symbol falls
 * back to the condition rather than throwing. Duplicated deliberately and
 * narrowly: the browser must draw the chart without a network round-trip per
 * tooth. The rule is two lines and is asserted in both places.
 */

export interface Appearance {
  colour: string;
  mark: string;
  symbolCode: string | null;
}

/** Minimal shape the rule needs from a chart symbol. */
export interface AppearanceSymbol {
  code: string;
  colour: string;
  mark: string;
}

export const CONDITION_APPEARANCE: Record<string, { colour: string; mark: string }> = {
  healthy: { colour: "#ffffff", mark: "none" },
  decayed: { colour: "#dc2626", mark: "none" },
  filled: { colour: "#2563eb", mark: "none" },
  missing: { colour: "#d1d5db", mark: "cross" },
  crowned: { colour: "#d97706", mark: "none" },
  root_canal: { colour: "#7c3aed", mark: "slash" },
  implant: { colour: "#0d9488", mark: "grid" },
};

/** Decide how one tooth is drawn. Symbol wins over condition. */
export function resolveToothAppearance(
  condition: string,
  symbolCode: string | null,
  symbols: AppearanceSymbol[],
): Appearance {
  const sym = symbolCode ? symbols.find((s) => s.code === symbolCode) : undefined;
  if (sym) return { colour: sym.colour, mark: sym.mark, symbolCode: sym.code };
  const cond = CONDITION_APPEARANCE[condition] ?? CONDITION_APPEARANCE.healthy!;
  return { colour: cond.colour, mark: cond.mark, symbolCode: null };
}
