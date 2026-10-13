import { parseAnalystBlocks, parseInline } from "@/lib/analyst-format";

/* Renders an analyst answer (Markdown from the model) as tidy blocks:
 * bold runs, real <table> grids and proper lists — instead of the raw `**`
 * and `|---|` the plain-text renderer used to show. The parsing lives in the
 * pure, unit-tested lib/analyst-format so it can be verified without a DOM. */

function Inline({ text }: { text: string }) {
  const runs = parseInline(text);
  return (
    <>
      {runs.map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-semibold">
            {r.text}
          </strong>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/** Right-align a column when its cells carry figures — keeps money tidy. */
function alignColumn(rows: string[][], ci: number): "left" | "right" {
  if (ci === 0) return "left";
  const cells = rows.map((r) => (r[ci] ?? "").trim()).filter(Boolean);
  if (!cells.length) return "left";
  return cells.every((c) => /\d/.test(c)) ? "right" : "left";
}

export default function AnalystAnswer({ text }: { text: string }) {
  const blocks = parseAnalystBlocks(text);

  return (
    <div className="space-y-2.5 text-sm text-foreground">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          return (
            <p key={i} className="text-[13px] font-semibold text-foreground">
              <Inline text={b.text} />
            </p>
          );
        }

        if (b.type === "paragraph") {
          return (
            <p key={i} className="leading-relaxed">
              <Inline text={b.text} />
            </p>
          );
        }

        if (b.type === "list") {
          return (
            <ul
              key={i}
              className={`space-y-1 pl-5 leading-relaxed ${b.ordered ? "list-decimal" : "list-disc"}`}
            >
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }

        // Table — a real grid, which is the whole point of this component.
        const aligns = b.header.map((_, ci) => alignColumn(b.rows, ci));
        return (
          <div key={i} className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {b.header.map((h, ci) => (
                    <th
                      key={ci}
                      className={`px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap ${
                        aligns[ci] === "right" ? "text-right" : "text-left"
                      }`}
                    >
                      <Inline text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-3 py-2 text-foreground tabular-nums ${
                          aligns[ci] === "right" ? "text-right" : "text-left"
                        }`}
                      >
                        <Inline text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
