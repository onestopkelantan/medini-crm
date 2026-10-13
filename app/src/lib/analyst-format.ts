/* ============================================================================
 * analyst-format — turn an LLM's Markdown answer into structured blocks.
 *
 * WHY THIS EXISTS
 * The analyst model narrates the report FACTS in Markdown: **bold** for
 * emphasis, and a pipe table for per-branch figures. The panel used to render
 * the reply as plain text (`whitespace-pre-wrap`), so the user saw the raw
 * syntax — literal `**` around every number and a `|---|---|` separator row
 * sitting in the middle of the answer. It looked broken because it *was*
 * being shown unparsed.
 *
 * This module is PURE and dependency-free, like lib/csv.ts — the app has no
 * Markdown library and the logger/environment is `node`, so it is unit-tested
 * directly without a DOM.
 *
 * DESIGN RULE: the model's table is often ragged. It writes a 2-column header
 * and then a summary row with a single cell (`| **Jumlah** |`). A strict
 * parser would either drop that row or throw; this one PADS short rows to the
 * header width, so the totals row stays visible and aligned.
 *
 * A line is only treated as a table when the NEXT line is a `---|---` rule.
 * That is deliberate: prose that merely contains a `|` character stays prose,
 * and a stray `| --- |` cannot be mistaken for a header. ========================================================================== */

export interface Inline {
  text: string;
  bold?: boolean;
}

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

/** Split one `| a | b |` row into trimmed cells, dropping the outer pipes. */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** True for a Markdown table rule such as `|---|:---:|---:|`. */
export function isSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Split a line into plain/bold runs on `**`. Unbalanced markers degrade to
 * literal text rather than throwing — the model is not always well-behaved.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  text.split("**").forEach((part, i) => {
    if (part === "") return;
    out.push({ text: part, bold: i % 2 === 1 });
  });
  return out.length ? out : [{ text, bold: false }];
}

/** Parse a full answer into ordered blocks (paragraphs, lists, tables). */
export function parseAnalystBlocks(markdown: string): Block[] {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flush();
      continue;
    }

    // Table: this line has pipes AND the next line is a separator rule.
    if (trimmed.includes("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flush();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next || !next.includes("|")) break;
        const cells = splitTableRow(next);
        while (cells.length < header.length) cells.push("");
        rows.push(cells.slice(0, header.length));
      }
      blocks.push({ type: "table", header, rows });
      i = j - 1;
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ type: "heading", text: heading[1].trim() });
      continue;
    }

    const orderedMatch = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    const bulletMatch = /^[-*•–]\s+(.*)$/.exec(trimmed);
    if (orderedMatch || bulletMatch) {
      flush();
      const ordered = Boolean(orderedMatch);
      const items: string[] = [(orderedMatch ?? bulletMatch)![1].trim()];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j].trim();
        const o = /^\d+[.)]\s+(.*)$/.exec(next);
        const b = /^[-*•–]\s+(.*)$/.exec(next);
        if (ordered && o) items.push(o[1].trim());
        else if (!ordered && b) items.push(b[1].trim());
        else break;
      }
      blocks.push({ type: "list", ordered, items });
      i = j - 1;
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
