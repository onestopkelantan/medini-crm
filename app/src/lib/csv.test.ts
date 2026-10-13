import { describe, it, expect } from "vitest";

import { toCsv, csvCell, datedCsvName } from "./csv";

/**
 * The escaping rules are the reason this file exists.
 *
 * A treatment name is free text typed by staff, so it can contain a comma, a
 * quote, or a newline. Any one of those, unescaped, shifts every following cell
 * by one column — and the export still opens, so nobody notices until a figure
 * is being read off the wrong column. These tests pin the rule.
 */
describe("csvCell", () => {
  it("quotes every cell, so a comma inside the value cannot split the row", () => {
    expect(csvCell("Scaling, polishing")).toBe('"Scaling, polishing"');
  });

  it("doubles an internal quote instead of ending the cell early", () => {
    expect(csvCell('Crown 12" molar')).toBe('"Crown 12"" molar"');
  });

  it("keeps a newline inside its own cell", () => {
    expect(csvCell("Line one\nLine two")).toBe('"Line one\nLine two"');
  });

  it("renders null and undefined as text, not as a silently empty cell", () => {
    /* Preserved from the Appointments export. A blank cell and the word "null"
     * are different facts about the data; this export reports the latter. */
    expect(csvCell(null)).toBe('"null"');
    expect(csvCell(undefined)).toBe('"undefined"');
  });

  it("accepts numbers without a type error", () => {
    expect(csvCell(1250.5)).toBe('"1250.5"');
    expect(csvCell(0)).toBe('"0"');
  });
});

describe("toCsv", () => {
  it("joins cells with commas and rows with newlines", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe('"a","b"\n"c","d"');
  });

  it("emits no BOM, that belongs to the download, not the document", () => {
    /* The BOM is prepended in downloadCsv. Keeping it out of toCsv means a test
     * can compare the string directly, and a caller that wants plain CSV gets it. */
    expect(toCsv([["a"]])).not.toContain("\ufeff");
  });

  it("produces a single empty line for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("keeps a header-only document valid", () => {
    expect(toCsv([["Nama", "Jumlah"]])).toBe('"Nama","Jumlah"');
  });

  it("survives a row whose values contain the delimiter and the escape char", () => {
    const csv = toCsv([
      ["Nama rawatan", "Bilangan"],
      ['Scaling, "khas"', 3],
    ]);
    expect(csv).toBe('"Nama rawatan","Bilangan"\n"Scaling, ""khas""","3"');
    /* The real failure mode: the comma inside the treatment name must stay inside
     * its cell. Strip every quoted field — what is left is only the delimiters,
     * and a two-column row must leave exactly one. Two leaked commas here means
     * the row would arrive in Excel as four columns. */
    const dataRow = csv.split("\n")[1]!;
    const delimitersOnly = dataRow.replace(/"(?:[^"]|"")*"/g, "");
    expect(delimitersOnly).toBe(",");
  });
});

describe("datedCsvName", () => {
  it("appends the date and the .csv extension", () => {
    expect(datedCsvName("laporan-kewangan", new Date(2026, 9, 5))).toBe(
      "laporan-kewangan-2026-10-05.csv",
    );
  });

  it("uses local date parts, so an early-morning export is not dated yesterday", () => {
    /* 08:00 in Kuala Lumpur is 00:00 UTC, so toISOString() would say the 4th.
     * The person exporting on the 5th expects the 5th. */
    const earlyMorning = new Date(2026, 9, 5, 8, 0, 0);
    expect(datedCsvName("x", earlyMorning)).toBe("x-2026-10-05.csv");
  });

  it("zero-pads single-digit months and days", () => {
    expect(datedCsvName("x", new Date(2026, 0, 7))).toBe("x-2026-01-07.csv");
  });
});
