import { Fragment, type ReactNode } from "react";

/* ============================================================================
 * MiniMarkdown — pemapar markdown selamat untuk mesej AI.
 *
 * Kenapa wujud: jawapan AI (Assistant, draf WhatsApp) ditulis dalam
 * markdown ringkas (tebal, senarai) tapi UI memaparnya mentah — pemilik
 * nampak '**teks**' sebagai bintang literal (tangkapan layar 9 Okt).
 *
 * Kenapa bukan react-markdown: pustaka = permukaan serangan + berat;
 * keperluan AI chat ini kecil — tebal/miring/kod/senyarai/pautan.
 *
 * Keselamatan: TIADA dangerouslySetInnerHTML. Semua nod dibina sebagai
 * React elements, jadi injection HTML dari kandungan mesej adalah mustahil
 * secara reka bentuk. Pautan hanya http/https (bukan javascript: dsb.)
 * dan dibuka dalam tab baharu (rel noopener).
 *
 * Disokong (syntax yang AI betul-betul keluarkan):
 *   **tebal**, *miring*, `kod`,
 *   - butir senarai (baris bermula "- " atau "• "),
 *   1. senarai bernombor,
 *   pautan biasa https://...
 * Semua yang lain dipapar sebagai teks biasa — tidak rosak, hanya tidak
 * diformatkan (gagal-perlahan, bukan gagal-tersembunyi).
 * ========================================================================== */

/** Pecahkan satu baris kepada segmen tebal/miring/kod/pautan. */
function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  /* Regex menangkap: `kod`, **tebal**, *miring*, https://pautan */
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else {
      /* pautan: hanya http/https selamat, tab baharu */
      const safe = /^https?:\/\//.test(tok) ? tok : null;
      out.push(
        safe ? (
          <a key={k} href={safe} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {safe}
          </a>
        ) : (
          tok
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Kumpulkan baris berturut-turut kepada <ul>/<ol> (atau <p> persekitaran). */
function renderMarkdownNodes(text: string): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isBullet = (l: string) => /^\s*[-•*]\s+/.test(l);
  const isNumbered = (l: string) => /^\s*\d+[.)]\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    /* Tajuk markdown: '# ', '## ', '### ' ... dipapar sbg teks tebal
       bersaiz menurun (bukan <h1-6> — dalam bubble chat, saiz besar
       akan pecahkan susun atur). */
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const lv = heading[1].length;
      const cls = lv <= 1 ? "text-base font-bold" : lv === 2 ? "text-sm font-bold" : "text-[13px] font-semibold uppercase tracking-wide";
      out.push(
        <p key={`h-${key++}`} className={`mt-2 mb-1 first:mt-0 ${cls}`}>
          {renderInline(heading[2], `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }
    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(<li key={`li-${key++}`} className="ml-4 list-disc">{renderInline(lines[i].replace(/^\s*[-•*]\s+/, ""), `b${key}`)}</li>);
        i++;
      }
      out.push(
        <ul key={`ul-${key++}`} className="my-1 space-y-0.5">
          {items}
        </ul>,
      );
    } else if (isNumbered(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(<li key={`li-${key++}`} className="ml-4 list-decimal">{renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ""), `n${key}`)}</li>);
        i++;
      }
      out.push(
        <ol key={`ol-${key++}`} className="my-1 space-y-0.5">
          {items}
        </ol>,
      );
    } else if (line.trim() === "") {
      /* baris kosong: pemisah perenggan */
      i++;
    } else {
      /* perenggan: baris berturut tanpa format senarai disatukan */
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !isBullet(lines[i]) && !isNumbered(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push(
        <p key={`p-${key++}`} className="my-1 first:mt-0 last:mb-0">
          {para.map((pl, pi) => (
            <Fragment key={pi}>
              {pi > 0 && <br />}
              {renderInline(pl, `p${key}-${pi}`)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return <>{out}</>;
}

/** Kompunen mudah: <MiniMarkdown text={...} /> */
export default function MiniMarkdown({ text, className }: { text: string; className?: string }) {
  return <div className={className ?? ""}>{renderMarkdownNodes(text)}</div>;
}
