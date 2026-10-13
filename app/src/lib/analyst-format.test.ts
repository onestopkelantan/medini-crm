import { describe, it, expect } from "vitest";
import { parseAnalystBlocks, parseInline, isSeparatorRow, splitTableRow } from "./analyst-format";

/* The sample below is the REAL answer that rendered untidily on screen
 * (5 Oct 2026): a Markdown pipe table that was being shown as plain text, with
 * a ragged final row (`| **Jumlah** |` — one cell where the header has two).
 * Tests are written against that exact shape, not an idealised one. */
const REAL_ANSWER = `Berdasarkan data sistem bagi **30 hari lepas**, kutipan mengikut cawangan adalah seperti berikut:

| Cawangan | Kutipan |
|---|---|
| Bukit Indah | RM2,100.00 |
| Setia Tropika | RM350.00 |
| Gelang Patah | RM100.00 |
| **Jumlah** | **RM2,550.00** |

Kutipan tertinggi di **Bukit Indah** (RM2,100.00).`;

describe("splitTableRow", () => {
  it("drops the outer pipes and trims cells", () => {
    expect(splitTableRow("| Cawangan | Kutipan |")).toEqual(["Cawangan", "Kutipan"]);
  });
  it("keeps inner pipes as separators", () => {
    expect(splitTableRow("a | b | c")).toEqual(["a", "b", "c"]);
  });
});

describe("isSeparatorRow", () => {
  it("accepts alignment markers", () => {
    expect(isSeparatorRow("|---|---|")).toBe(true);
    expect(isSeparatorRow("|:--|--:|:--:|")).toBe(true);
  });
  it("rejects data and prose", () => {
    expect(isSeparatorRow("| Bukit Indah | RM2,100.00 |")).toBe(false);
    expect(isSeparatorRow("Jumlah keseluruhan")).toBe(false);
  });
});

describe("parseInline", () => {
  it("extracts bold runs and leaves the rest plain", () => {
    expect(parseInline("data bagi **30 hari** lepas")).toEqual([
      { text: "data bagi ", bold: false },
      { text: "30 hari", bold: true },
      { text: " lepas", bold: false },
    ]);
  });
  it("degrades an unbalanced marker to plain text instead of throwing", () => {
    const runs = parseInline("nilai **tidak seimbang");
    expect(runs.map((r) => r.text).join("")).toBe("nilai tidak seimbang");
  });
});

describe("parseAnalystBlocks, the real untidy answer", () => {
  const blocks = parseAnalystBlocks(REAL_ANSWER);

  it("produces a paragraph, a table and a closing paragraph, not one blob", () => {
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
  });

  it("recovers the table header and every data row", () => {
    const t = blocks.find((b) => b.type === "table");
    if (t?.type !== "table") throw new Error("no table block");
    expect(t.header).toEqual(["Cawangan", "Kutipan"]);
    expect(t.rows).toEqual([
      ["Bukit Indah", "RM2,100.00"],
      ["Setia Tropika", "RM350.00"],
      ["Gelang Patah", "RM100.00"],
      ["**Jumlah**", "**RM2,550.00**"],
    ]);
  });

  it("never leaks the `|---|` separator into the rendered rows", () => {
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain("---");
  });

  it("keeps the leading prose as a paragraph", () => {
    const p = blocks[0];
    if (p.type !== "paragraph") throw new Error("first block is not a paragraph");
    expect(p.text).toContain("kutipan mengikut cawangan");
  });
});

describe("parseAnalystBlocks, ragged rows", () => {
  it("pads a short summary row to the header width so the total stays visible", () => {
    const md = ["| A | B | C |", "|---|---|---|", "| Jumlah |", "| 1 | 2 | 3 |"].join("\n");
    const t = parseAnalystBlocks(md).find((b) => b.type === "table");
    if (t?.type !== "table") throw new Error("no table block");
    expect(t.rows[0]).toEqual(["Jumlah", "", ""]);
    expect(t.rows[1]).toEqual(["1", "2", "3"]);
  });

  it("truncates an over-long row to the header width", () => {
    const md = ["| A | B |", "|---|---|", "| 1 | 2 | 3 | 4 |"].join("\n");
    const t = parseAnalystBlocks(md).find((b) => b.type === "table");
    if (t?.type !== "table") throw new Error("no table block");
    expect(t.rows[0]).toEqual(["1", "2"]);
  });
});

describe("parseAnalystBlocks, other shapes", () => {
  it("groups consecutive bullets into one list", () => {
    const blocks = parseAnalystBlocks("- satu\n- dua\n- tiga");
    expect(blocks).toEqual([{ type: "list", ordered: false, items: ["satu", "dua", "tiga"] }]);
  });

  it("groups consecutive numbered items into one ordered list", () => {
    const blocks = parseAnalystBlocks("1. satu\n2. dua");
    expect(blocks).toEqual([{ type: "list", ordered: true, items: ["satu", "dua"] }]);
  });

  it("treats a heading line as a heading, not a paragraph", () => {
    const blocks = parseAnalystBlocks("## Ringkasan\nKutipan naik.");
    expect(blocks[0]).toEqual({ type: "heading", text: "Ringkasan" });
  });

  it("joins wrapped prose lines into a single paragraph", () => {
    const blocks = parseAnalystBlocks("baris satu\nbaris dua");
    expect(blocks).toEqual([{ type: "paragraph", text: "baris satu baris dua" }]);
  });

  it("treats prose containing a pipe as prose, not a table", () => {
    const blocks = parseAnalystBlocks("Guna pembahagi | dalam ayat biasa.");
    expect(blocks).toEqual([{ type: "paragraph", text: "Guna pembahagi | dalam ayat biasa." }]);
  });

  it("handles empty and whitespace-only input without throwing", () => {
    expect(parseAnalystBlocks("")).toEqual([]);
    expect(parseAnalystBlocks("   \n\n  ")).toEqual([]);
    expect(parseAnalystBlocks(undefined as unknown as string)).toEqual([]);
  });
});
