/**
 * Tooth-region geometry — which drawn region of a tooth is which surface.
 *
 * WHERE THIS COMES FROM
 *
 * The reference prototype (DentaChart) solved this with a `regionSurfaces()`
 * map: for one FDI number, decide whether the top edge of the drawn tooth is
 * the buccal or the lingual side, and whether the left edge is mesial or
 * distal. That logic is clinical fact, not styling — so it is ported here,
 * adapted to Medini's anatomical tooth shapes instead of the prototype's
 * uniform squares.
 *
 * WHY THE MIRRORING RULES ARE NOT COSMETIC
 *
 * A dental chart is drawn from the VIEWER'S side facing the patient, so the
 * patient's right appears on the left of the screen. Quadrant 1 (upper right)
 * sits on the LEFT of the upper arch, and its teeth lean the other way from
 * quadrant 2's: for 16, the mesial edge (toward the midline, screen-right) is
 * the RIGHT edge of the drawn tooth, while for 26 the mesial edge is the LEFT
 * edge. Drawing surfaces without this mirroring would paint a caries on the
 * wrong side of the mouth — an error nobody sees until a filling goes in
 * wrong, which is the most expensive category of UI bug this screen has.
 *
 * Pure & deterministic — no I/O, no clock.
 */

/** The five addressable surfaces of a tooth, in picker/display order. */
export const CANONICAL_SURFACES = ["M", "O", "D", "B", "L"] as const;
export type CanonicalSurface = (typeof CANONICAL_SURFACES)[number];

/** The five drawn regions of a tooth shape. */
export type ToothRegion = "top" | "bottom" | "left" | "right" | "center";

/** FDI quadrant → the drawn region that is BUCCAL (outer, toward cheek/lip). */
function isUpperArch(fdi: number): boolean {
  const q = Math.floor(fdi / 10);
  return q === 1 || q === 2 || q === 5 || q === 6;
}

/**
 * Mesial points toward the midline. On the viewer-facing chart the midline is
 * the CENTER of the arch, so for right-hand quadrants (1, 4, 5, 8 — drawn on
 * the left half) mesial is the drawn RIGHT edge; for left-hand quadrants
 * (2, 3, 6, 7) it is the drawn LEFT edge.
 */
function mesialIsDrawnRight(fdi: number): boolean {
  const q = Math.floor(fdi / 10);
  return q === 1 || q === 4 || q === 5 || q === 8;
}

/**
 * Region → canonical surface letter for one tooth.
 *
 * `top`/`bottom` are B/L by arch (buccal is toward the cheek: UP on an upper
 * arch, DOWN on a lower one; lingual is the opposite). `center` is O for every
 * tooth — the occlusal table. Mesial/distal follow the mirroring above.
 */
export function regionSurfaces(fdi: number): Record<ToothRegion, CanonicalSurface> {
  const upper = isUpperArch(fdi);
  const mesialRight = mesialIsDrawnRight(fdi);
  return {
    top: upper ? "B" : "L",
    bottom: upper ? "L" : "B",
    left: mesialRight ? "D" : "M",
    right: mesialRight ? "M" : "D",
    center: "O",
  };
}

/**
 * The DISPLAY letter for a stored canonical surface on a given tooth.
 *
 * Storage is always canonical (M/O/D/B/L). What the dentist SAYS differs by
 * tooth, and the picker should speak the way the clinic speaks:
 *   - L on an UPPER tooth is palatal (P) — the lingual surface of an upper
 *     tooth faces the palate, and Malaysian clinics say "palatal".
 *   - O on an ANTERIOR tooth (position 1–3) is incisal (I) — incisors and
 *     canines have a cutting edge, not an occlusal table.
 *
 * Display-only: the stored letter never changes, so the same mouth renders
 * identically everywhere while the label adapts to the tooth in hand.
 */
export function surfaceDisplayLetter(surface: CanonicalSurface, fdi: number): string {
  if (surface === "L" && isUpperArch(fdi)) return "P";
  if (surface === "O" && fdi % 10 <= 3) return "I";
  return surface;
}

/** The clinical word for a surface, for tooltips and history lines. */
export const SURFACE_WORDS: Record<CanonicalSurface, string> = {
  M: "mesial",
  O: "occlusal",
  D: "distal",
  B: "buccal",
  L: "lingual",
};

/** Narrow unknown stored data to canonical letters (mirrors the backend rule). */
export function normalizeSurfaces(raw: unknown): readonly CanonicalSurface[] | null {
  if (!Array.isArray(raw)) return null;
  const kept: CanonicalSurface[] = [];
  for (const v of raw) {
    const letter = typeof v === "string" ? (v.trim().toUpperCase() as CanonicalSurface) : null;
    if (letter && (CANONICAL_SURFACES as readonly string[]).includes(letter) && !kept.includes(letter)) {
      kept.push(letter);
    }
  }
  return kept.length ? kept : null;
}
