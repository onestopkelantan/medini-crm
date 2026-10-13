import { describe, it, expect } from "vitest";

import {
  regionSurfaces, surfaceDisplayLetter, normalizeSurfaces, SURFACE_WORDS,
} from "./tooth-regions";

/**
 * The mirroring rules are the whole point of this module. A surface painted on
 * the wrong side of the tooth is invisible as a bug until a filling goes in
 * wrong, so every rule is pinned by the tooth that exercises it.
 *
 * FDI reminder (viewer-facing chart, patient's right on screen-left):
 *   16 = upper-right first molar (quadrant 1, drawn LEFT of the midline)
 *   26 = upper-left first molar  (quadrant 2, drawn RIGHT of the midline)
 *   36 = lower-left first molar  (quadrant 3)
 *   46 = lower-right first molar (quadrant 4)
 *   51 = upper-right primary central (quadrant 5)
 */
describe("regionSurfaces, which drawn edge is which surface", () => {
  it("upper arch: buccal is the TOP edge, lingual the BOTTOM", () => {
    expect(regionSurfaces(16).top).toBe("B");
    expect(regionSurfaces(16).bottom).toBe("L");
  });

  it("lower arch: buccal is the BOTTOM edge, lingual the TOP", () => {
    expect(regionSurfaces(36).top).toBe("L");
    expect(regionSurfaces(36).bottom).toBe("B");
  });

  it("right-hand quadrants: mesial is the drawn RIGHT edge (midline is screen-center)", () => {
    /* 16 sits left of the midline, so its mesial edge faces screen-RIGHT. */
    expect(regionSurfaces(16).right).toBe("M");
    expect(regionSurfaces(16).left).toBe("D");
    expect(regionSurfaces(46).right).toBe("M");
  });

  it("left-hand quadrants: mesial is the drawn LEFT edge", () => {
    expect(regionSurfaces(26).left).toBe("M");
    expect(regionSurfaces(26).right).toBe("D");
    expect(regionSurfaces(36).left).toBe("M");
  });

  it("primary quadrants mirror the same way (5 upper-right, 6 upper-left)", () => {
    expect(regionSurfaces(51).right).toBe("M");
    expect(regionSurfaces(51).top).toBe("B");
    expect(regionSurfaces(61).left).toBe("M");
  });

  it("the center region is always occlusal", () => {
    for (const fdi of [16, 26, 36, 46, 51]) {
      expect(regionSurfaces(fdi).center).toBe("O");
    }
  });

  it("every region maps to a distinct surface, no two edges share a letter", () => {
    for (const fdi of [11, 16, 26, 33, 36, 46, 51, 65, 75, 84]) {
      const values = Object.values(regionSurfaces(fdi));
      expect(new Set(values).size).toBe(5);
    }
  });
});

describe("surfaceDisplayLetter, speak the way the clinic speaks", () => {
  it("L on an upper tooth displays as P (palatal)", () => {
    expect(surfaceDisplayLetter("L", 16)).toBe("P");
    expect(surfaceDisplayLetter("L", 21)).toBe("P");
  });

  it("L on a lower tooth stays L (lingual)", () => {
    expect(surfaceDisplayLetter("L", 36)).toBe("L");
    expect(surfaceDisplayLetter("L", 41)).toBe("L");
  });

  it("O on an anterior tooth (position 1–3) displays as I (incisal)", () => {
    expect(surfaceDisplayLetter("O", 11)).toBe("I");
    expect(surfaceDisplayLetter("O", 13)).toBe("I");
    expect(surfaceDisplayLetter("O", 32)).toBe("I");
  });

  it("O on a posterior tooth (position 4–8) stays O (occlusal)", () => {
    expect(surfaceDisplayLetter("O", 16)).toBe("O");
    expect(surfaceDisplayLetter("O", 47)).toBe("O");
    expect(surfaceDisplayLetter("O", 54)).toBe("O");
  });

  it("M, D, B never change", () => {
    for (const fdi of [16, 26, 36, 46]) {
      expect(surfaceDisplayLetter("M", fdi)).toBe("M");
      expect(surfaceDisplayLetter("D", fdi)).toBe("D");
      expect(surfaceDisplayLetter("B", fdi)).toBe("B");
    }
  });
});

describe("normalizeSurfaces, same vocabulary rule as the backend", () => {
  it("keeps canonical letters, drops the rest", () => {
    expect(normalizeSurfaces(["O", "M"])).toEqual(["O", "M"]);
    expect(normalizeSurfaces(["O", "P", "I", "X"])).toEqual(["O"]);
  });

  it("forgives case, collapses duplicates", () => {
    expect(normalizeSurfaces(["o", " m ", "o"])).toEqual(["O", "M"]);
  });

  it("null for non-array, empty, or nothing canonical", () => {
    expect(normalizeSurfaces(null)).toBeNull();
    expect(normalizeSurfaces("O")).toBeNull();
    expect(normalizeSurfaces([])).toBeNull();
    expect(normalizeSurfaces(["x"])).toBeNull();
  });

  it("every surface has a clinical word", () => {
    for (const s of ["M", "O", "D", "B", "L"] as const) {
      expect(SURFACE_WORDS[s].length).toBeGreaterThan(2);
    }
  });
});
