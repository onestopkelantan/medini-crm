/**
 * ToothChart — the odontogram (Fasa 1B).
 *
 * DESIGN NOTES THAT MATTER
 *
 * 1. BOTH DENTITIONS, ONE SWITCH. A 5-year-old's mouth contains no 11–48 yet,
 *    and an adult's contains no 51–85. The chart shows one arch set at a time
 *    and the switch is explicit, because drawing 52 teeth at once produces a
 *    picture no dentist can read at a glance.
 *
 * 2. THE GEOMETRY IS DERIVED FROM THE FDI NUMBER, NOT FROM A LAYOUT TABLE.
 *    `arrangeChart()` walks the FDI grid itself: quadrant picks arch and side,
 *    position picks the slot. A hand-written layout listing 52 tooth numbers is
 *    a second source of truth that drifts the moment a number is mistyped, and
 *    a mistyped tooth number is invisible on screen.
 *
 * 3. A TOOTH NEVER EXAMINED IS NOT A HEALTHY TOOTH. `notCharted` is drawn as a
 *    dashed outline. Filling it in white would assert "no disease found" about
 *    a tooth nobody has looked at — the same category of lie as reporting a
 *    missing reading as zero.
 *
 * 4. THE SYMBOL WINS OVER THE CONDITION. `resolveToothAppearance` decides, and
 *    the ordering is deliberate: a tooth that is `missing` BECAUSE it was
 *    extracted is stored as condition=missing + symbol=extracted, and the chart
 *    must show "extracted" or the distinction the symbol exists to record would
 *    be invisible.
 *
 * 5. ONE ROW PER TOOTH, NOT ONE PER VISIT. The screen reads the CONTINUOUS
 *    chart (latest state per tooth) and shows `eventCount` as a history badge.
 *    The per-encounter rows remain the record.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useScope } from "@/hooks/useScope";
import { fmtShortDate } from "@/lib/dateFormat";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { History } from "lucide-react";
import { resolveToothAppearance, CONDITION_APPEARANCE, type Appearance } from "@/lib/tooth-appearance";
import { regionSurfaces, normalizeSurfaces, surfaceDisplayLetter, SURFACE_WORDS, CANONICAL_SURFACES, type ToothRegion } from "@/lib/tooth-regions";

/* ------------------------------------------------------------------ types */

export interface ChartTooth {
  fdiNo: number;
  condition: string;
  symbolCode: string | null;
  /** Canonical surface letters (M/O/D/B/L) of the latest record; null = whole tooth. */
  surfaces: readonly string[] | null;
  notes: string | null;
  encounterId: string;
  doctorId: string | null;
  recordedAt: string | null;
  eventCount: number;
}

export interface ChartPayload {
  patientId: string;
  teeth: ChartTooth[];
  chartedCount: number;
  lastRecordedAt: string | null;
  needsAttention: number[];
  conditionCounts: Record<string, number>;
}

export interface ChartSymbol {
  id: string; code: string; label: string; colour: string;
  mark: string; sortOrder: number; isBuiltIn: boolean; isActive: boolean;
  is_built_in?: boolean; sort_order?: number;
}

/* ---------------------------------------------------------------- geometry */

const PERMANENT_QUADRANTS = { upperRight: 1, upperLeft: 2, lowerLeft: 3, lowerRight: 4 };
const DECIDUOUS_QUADRANTS = { upperRight: 5, upperLeft: 6, lowerLeft: 7, lowerRight: 8 };

/** Position of a tooth within its arch, 1 (central) .. 8 (third molar). */
function positionOf(fdi: number): number { return fdi % 10; }

/* ---------------------------------------------------------------------
 * TOOTH VISUAL — the DentaChart look.
 *
 * The user reviewed the surface-charting work and asked for the reference
 * file's look: a rounded square with a soft cross and five geometric
 * regions, instead of the anatomical silhouettes. That visual is PORTED
 * here (REGION_SHAPES verbatim, 64x64 viewBox like the original) because
 * it is what the clinic's owner chose. The region->surface logic and the
 * records behind them are unchanged; only the drawing changed.
 * ------------------------------------------------------------------- */

/** The five region polygons, exactly as the reference file drew them. */
const REGION_SHAPES: Record<ToothRegion, string> = {
  top: "M2,2 L62,2 L43,21 L21,21 Z",
  bottom: "M2,62 L62,62 L43,43 L21,43 Z",
  left: "M2,2 L21,21 L21,43 L2,62 Z",
  right: "M62,2 L62,62 L43,43 L43,21 Z",
  center: "M21,21 h22 v22 h-22 Z",
};

/** One tooth drawn the DentaChart way: rounded square, cross lines, regions. */
function toothDrawing(
  fdi: number,
  appearance: Appearance | null,
  recorded: readonly string[] | null,
): React.ReactNode {
  const w = 44, h = 44;
  const line = "#c3c9d6";
  const notCharted = appearance === null;
  /* Primary teeth carry a slightly heavier outline in the reference; here the
   * distinction stays visible with the same weights used there. */
  const primary = positionOf(fdi) >= 1 && Math.floor(fdi / 10) >= 5;
  const colour = appearance?.colour ?? "#ffffff";
  const mark = appearance?.mark ?? "none";

  const regions = Object.entries(REGION_SHAPES).map(([region, path]) => {
    const surf = regionSurfaces(fdi)[region as ToothRegion];
    const filled = recorded ? recorded.includes(surf) : true;
    if (!filled) return null;
    return <path key={region} d={path} fill={colour} fillOpacity={0.92} />;
  });

  const dim = notCharted;

  return (
    <svg width={w} height={h} viewBox="0 0 64 64" style={dim ? { opacity: 0.35 } : undefined}>
      <defs>
        <clipPath id={`clip-${fdi}`}>
          <rect x="2" y="2" width="60" height="60" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${fdi})`}>{regions}</g>
      {/* The soft cross that makes the square read as a charting tooth. */}
      <g fill="none" stroke={line} strokeWidth={1.6}>
        <line x1="7" y1="7" x2="21" y2="21" />
        <line x1="57" y1="7" x2="43" y2="21" />
        <line x1="7" y1="57" x2="21" y2="43" />
        <line x1="57" y1="57" x2="43" y2="43" />
        <rect x="21" y="21" width="22" height="22" rx="3" />
      </g>
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        fill="none"
        stroke={notCharted ? line : (colour === "#ffffff" ? "#94a3b8" : colour)}
        strokeWidth={primary ? 2.2 : 1.6}
        strokeDasharray={notCharted ? "4 4" : undefined}
      />
      {!notCharted && <Mark mark={mark} w={64} h={64} />}
    </svg>
  );
}

/**
 * Lay the teeth out for one arch.
 *
 * Returns the four groups in READING order (upper-right first, as every dental
 * chart is drawn — the patient's own right is on the left of the screen).
 * Only positions 1..5 are produced for a deciduous arch, because `positionOf`
 * on 5x/6x/7x/8x quadrants never exceeds 5 for a real primary tooth.
 */
function arrangeChart(dentition: "permanent" | "deciduous"): number[][] {
  const q = dentition === "permanent" ? PERMANENT_QUADRANTS : DECIDUOUS_QUADRANTS;
  const maxPos = dentition === "permanent" ? 8 : 5;
  const build = (quadrant: number, reverse: boolean): number[] => {
    const teeth: number[] = [];
    for (let p = 1; p <= maxPos; p++) teeth.push(quadrant * 10 + p);
    return reverse ? teeth.reverse() : teeth;
  };
  return [
    build(q.upperRight, true),  // 18..11, outermost on the left
    build(q.upperLeft, false),  // 21..28
    build(q.lowerLeft, true),   // 38..31
    build(q.lowerRight, false), // 41..48
  ];
}

/* ------------------------------------------------------------- appearance */

/** The mark drawn on top of the tooth body. Each is a distinct SHAPE, not a
 * shade — the chart has to survive a colour-blind reader and a bad monitor. */
function Mark({ mark, w, h }: { mark: string; w: number; h: number }) {
  const s = "rgba(255,255,255,0.85)";
  switch (mark) {
    case "cross":
      return <g stroke={s} strokeWidth="2.4" strokeLinecap="round">
        <line x1={w * 0.28} y1={h * 0.28} x2={w * 0.72} y2={h * 0.72} />
        <line x1={w * 0.72} y1={h * 0.28} x2={w * 0.28} y2={h * 0.72} />
      </g>;
    case "slash":
      return <line x1={w * 0.5} y1={h * 0.2} x2={w * 0.5} y2={h * 0.8} stroke={s} strokeWidth="2.6" />;
    case "stroke":
      return <line x1={w * 0.25} y1={h * 0.5} x2={w * 0.75} y2={h * 0.5} stroke={s} strokeWidth="2.6" />;
    case "bar":
      return <rect x={w * 0.25} y={h * 0.42} width={w * 0.5} height={h * 0.16} fill={s} rx="1" />;
    case "dot":
      return <circle cx={w * 0.5} cy={h * 0.62} r={w * 0.16} fill={s} />;
    case "circle":
      return <circle cx={w * 0.5} cy={h * 0.5} r={w * 0.22} fill="none" stroke={s} strokeWidth="2.4" />;
    case "wave":
      return <path d={`M${w * 0.22},${h * 0.5} q${w * 0.14},${-h * 0.13} ${w * 0.28},0 t${w * 0.28},0`}
        fill="none" stroke={s} strokeWidth="2.2" />;
    case "grid":
      return <g stroke={s} strokeWidth="1.6">
        <line x1={w * 0.3} y1={h * 0.3} x2={w * 0.7} y2={h * 0.3} />
        <line x1={w * 0.3} y1={h * 0.5} x2={w * 0.7} y2={h * 0.5} />
        <line x1={w * 0.3} y1={h * 0.7} x2={w * 0.7} y2={h * 0.7} />
      </g>;
    default:
      return null;
  }
}

interface ToothProps {
  fdi: number;
  appearance: Appearance | null;
  /** Canonical surfaces of the latest record; null/absent = whole-tooth record. */
  surfaces?: readonly string[] | null;
  selected: boolean;
  attention: boolean;
  hasHistory: boolean;
  onSelect: (fdi: number) => void;
}

function Tooth({ fdi, appearance, surfaces, selected, attention, hasHistory, onSelect }: ToothProps) {
  /* Surface charting: ONLY the recorded regions take the condition colour —
   * "caries on O and M of 16" reads as two painted regions inside a white
   * tooth, not an entirely red tooth. Null surfaces = whole-tooth record,
   * every region fills. The region map mirrors by quadrant (see
   * lib/tooth-regions.ts); painting without that mirroring would put a mesial
   * caries on the wrong side of the mouth. */
  const recorded = normalizeSurfaces(surfaces);

  return (
    <button
      type="button"
      onClick={() => onSelect(fdi)}
      title={String(fdi)}
      aria-label={`tooth ${fdi}`}
      aria-pressed={selected}
      className={`group relative shrink-0 rounded-md px-0.5 pt-0.5 pb-0 transition-colors ${
        selected ? "bg-accent ring-2 ring-primary" : "hover:bg-accent"
      }`}
    >
      <span className="block text-[10px] font-bold leading-none text-muted-foreground group-hover:text-muted-foreground">
        {fdi}
      </span>
      {toothDrawing(fdi, appearance, recorded)}
      {hasHistory && (
        <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
      )}
      {attention && (
        <span className="absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
      )}
    </button>
  );
}

/* --------------------------------------------------------------- the panel */

interface Props {
  patientId: string;
  encounterId?: string | null;
  canEdit?: boolean;
}

export default function ToothChart({ patientId, encounterId, canEdit }: Props) {
  const { t, lang } = usePrefs();
  const qc = useQueryClient();
  /* Scope for clinical WRITES. The backend guard is fail-closed for the
   * doctor's `own` scope on create/edit: without branchId+doctorId in the
   * body it denies with a message that blames the ROLE, not the missing
   * fields — the same trap that hit four other clinical screens before
   * useScope() existed (see its header). The chart's save was never fixed
   * because HQ/staff hit it first and doctors rarely chart from this tab;
   * a doctor charting their own patient got 403. */
  const scope = useScope();
  /* "mixed" is the 6–12-year-old mouth: permanent and primary teeth at the
   * same time. It is a VIEW over both dentitions, not a third dentition — the
   * FDI numbers and the records behind them are unchanged, only the layout
   * draws both arch sets. */
  const [dentition, setDentition] = useState<"permanent" | "deciduous" | "mixed">("permanent");
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  const chart = useQuery({
    queryKey: ["chart", patientId],
    queryFn: () => api.get<ChartPayload>(`/clinical/patients/${patientId}/chart`),
    enabled: !!patientId,
  });

  const symbols = useQuery({
    queryKey: ["chart-symbols"],
    queryFn: () => api.get<ChartSymbol[]>("/clinical/chart-symbols"),
    staleTime: 5 * 60 * 1000,
  });

  const history = useQuery({
    queryKey: ["chart-history", patientId, selected],
    queryFn: () => api.get<ChartTooth[]>(`/clinical/patients/${patientId}/chart/${selected}/history`),
    enabled: selected != null,
  });

  const byTooth = useMemo(() => {
    const m = new Map<number, ChartTooth>();
    for (const x of chart.data?.teeth ?? []) m.set(x.fdiNo, x);
    return m;
  }, [chart.data]);

  const attention = useMemo(() => new Set(chart.data?.needsAttention ?? []), [chart.data]);
  const symbolList = symbols.data ?? [];

  const [groups] = useState(() => ({
    permanent: arrangeChart("permanent"),
    deciduous: arrangeChart("deciduous"),
    /* Mixed draws BOTH arch sets; the primary set keeps its own labels so a
     * retained primary molar next to an erupting premolar is readable. */
    mixed: {
      perm: arrangeChart("permanent"),
      prim: arrangeChart("deciduous"),
    },
  }));

  const isMixed = dentition === "mixed";
  const permGroups = groups.permanent;
  const primGroups = groups.deciduous;
  const [pUpperR, pUpperL, pLowerL, pLowerR] = permGroups;
  const [dUpperR, dUpperL, dLowerL, dLowerR] = primGroups;
  const permUpper = [...pUpperR!, ...pUpperL!];
  const permLower = [...pLowerR!, ...pLowerL!];
  const primUpper = [...dUpperR!, ...dUpperL!];
  const primLower = [...dLowerR!, ...dLowerL!];
  /* Non-mixed views keep the single-pair variables the render already uses. */
  const upper = isMixed ? permUpper : permUpper;
  const lower = isMixed ? permLower : permLower;

  const save = useMutation({
    mutationFn: (body: { fdi: number; condition: string; symbolCode: string | null; surfaces: string[] | null }) =>
      api.post("/clinical/tooth-records", {
        ...scope,
        encounterId, fdi: body.fdi, condition: body.condition,
        symbolCode: body.symbolCode,
        /* Empty array is the WHOLE TOOTH, and the API refuses it — the
         * contract is: no surface chosen → omit the field. */
        ...(body.surfaces?.length ? { surfaces: body.surfaces } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chart", patientId] });
      qc.invalidateQueries({ queryKey: ["chart-history", patientId] });
      setEditing(false);
    },
  });

  if (chart.isLoading) return <Skeleton className="h-64 w-full" />;

  const tooth = selected != null ? byTooth.get(selected) ?? null : null;
  const appearance = tooth ? resolveToothAppearance(tooth.condition, tooth.symbolCode, symbolList) : null;
  const data = chart.data;

  const row = (teeth: number[]) => (
    <div className="flex items-end justify-center gap-0.5">
      {teeth.map((f) => {
        const t = byTooth.get(f);
        return (
          <Tooth
            key={f}
            fdi={f}
            appearance={t ? resolveToothAppearance(t.condition, t.symbolCode, symbolList) : null}
            surfaces={t?.surfaces ?? null}
            selected={selected === f}
            attention={attention.has(f)}
            hasHistory={(t?.eventCount ?? 0) > 1}
            onSelect={setSelected}
          />
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ---- summary + dentition switch ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-semibold text-foreground">
            {data?.chartedCount ?? 0} <span className="font-normal text-muted-foreground">{t("chart.charted")}</span>
          </span>
          {attention.size > 0 && (
            <span className="inline-flex items-center gap-1.5 text-red-600 font-medium">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {attention.size} {t("chart.needsAttention")}
            </span>
          )}
          {data?.lastRecordedAt && (
            <span className="text-muted-foreground text-xs">
              {t("chart.lastActivity")}: {fmtShortDate(lang, data.lastRecordedAt)}
            </span>
          )}
        </div>

        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {(["permanent", "deciduous", "mixed"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDentition(d)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                dentition === d ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              {d === "permanent" ? t("chart.permanent") : d === "deciduous" ? t("chart.deciduous") : t("chart.mixed")}
            </button>
          ))}
        </div>
      </div>

      {/* ---- the chart ---- */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
          {dentition === "deciduous" ? "" : "▲"} {t("chart.title")}
        </p>
        {isMixed ? (
          /* The 6–12-year-old mouth: permanent arch set, then the primary set
           * under it, each labelled — a mixed dentition is TWO readable arch
           * sets, not one squashed grid. */
          <>
            <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("chart.permanentArch")}</p>
            {row(permUpper)}
            <div className="my-3 border-t border-dashed border-border" />
            {row(permLower)}
            <p className="mt-4 mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("chart.primaryArch")}</p>
            {row(primUpper)}
            <div className="my-3 border-t border-dashed border-border" />
            {row(primLower)}
          </>
        ) : (
          <>
            {row(upper)}
            <div className="my-3 border-t border-dashed border-border" />
            {row(lower)}
          </>
        )}
        <p className="mt-3 text-center text-[10px] text-muted-foreground">▼</p>
      </div>

      {/* ---- legend ---- */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("chart.conditionKey")}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {Object.keys(CONDITION_APPEARANCE).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-3.5 w-3.5 rounded-sm border border-border"
                style={{ background: CONDITION_APPEARANCE[c]!.colour }}
              />
              {t(`cond.${c}`)}
            </span>
          ))}
        </div>

        {symbolList.length > 0 && (
          <>
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("chart.symbolKey")}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {symbolList.map((s) => (
                <span key={s.code} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-3.5 w-3.5 rounded-sm border border-border" style={{ background: s.colour }} />
                  {t(`sym.${s.code}`)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- selected tooth ---- */}
      {selected != null && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-foreground">
                {selected}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {tooth ? t(`cond.${tooth.condition}`) : t("chart.notCharted")}
                  {appearance?.symbolCode ? ` · ${t(`sym.${appearance.symbolCode}`)}` : ""}
                </span>
              </p>
              {tooth?.surfaces?.length ? (
                /* The surfaces of the latest record, as display letters for THIS
                 * tooth — a doctor reading the panel sees "P" on an upper tooth,
                 * the same word they would say out loud. */
                <p className="mt-0.5 font-mono text-xs tracking-wide text-muted-foreground">
                  {tooth.surfaces.map((s) => surfaceDisplayLetter(s as "M", selected)).join(" · ")}
                </p>
              ) : null}
              {tooth && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tooth.eventCount} {t("chart.events")}
                  {tooth.recordedAt ? ` · ${fmtShortDate(lang, tooth.recordedAt)}` : ""}
                </p>
              )}
            </div>
            {canEdit && encounterId && (
              <Button size="sm" className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setEditing(true)}>
                {t("chart.record")}
              </Button>
            )}
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <History className="h-3 w-3" /> {t("chart.history")}
            </p>
            {history.isLoading && <Skeleton className="h-12 w-full" />}
            {history.data && history.data.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("chart.notCharted")}</p>
            )}
            <div className="divide-y divide-border">
              {(history.data ?? []).map((h, i) => {
                const hs = normalizeSurfaces(h.surfaces);
                return (
                  <div key={i} className="flex items-center justify-between py-1.5 text-xs">
                    <span className="text-muted-foreground">
                      {t(`cond.${h.condition}`)}
                      {h.symbolCode ? ` · ${t(`sym.${h.symbolCode}`)}` : ""}
                      {hs ? ` · ${hs.map((s) => surfaceDisplayLetter(s, selected)).join("")}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {h.recordedAt ? fmtShortDate(lang, h.recordedAt) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {data && data.chartedCount === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t("chart.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("chart.emptyHint")}</p>
        </div>
      )}

      {/* ---- edit dialog ---- */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("chart.record")}, {selected}
            </DialogTitle>
            <DialogDescription>{t("chart.conditionKey")}</DialogDescription>
          </DialogHeader>

          <ConditionPicker
            current={tooth?.condition ?? "healthy"}
            currentSymbol={tooth?.symbolCode ?? null}
            currentSurfaces={tooth?.surfaces ?? null}
            /* The dialog only renders when a tooth IS selected (edit opens from
             * the selected-tooth card), so the narrowing is safe — but the
             * picker still needs a number, and 0 would render wrong letters. */
            fdi={selected ?? 0}
            symbols={symbolList}
            onSave={(condition, symbolCode, surfaces) => {
              if (selected == null) return;
              save.mutate({ fdi: selected, condition, symbolCode, surfaces });
            }}
            saving={save.isPending}
            t={t}
          />

          {save.isError && <p className="text-xs text-red-600">{t("chart.saveFailed")}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------- condition picker */

interface PickerProps {
  current: string;
  currentSymbol: string | null;
  /** The tooth being edited — decides which display letters the chips show. */
  fdi: number;
  /** Surfaces of the LATEST record, pre-checked. Null = whole-tooth record. */
  currentSurfaces: readonly string[] | null;
  symbols: ChartSymbol[];
  saving: boolean;
  t: (k: string) => string;
  onSave: (condition: string, symbolCode: string | null, surfaces: string[] | null) => void;
}

/**
 * Two independent choices, side by side, because they answer different
 * questions: what the tooth IS (condition, required) and what else is known
 * about it (symbol, optional). Collapsing them into one list would force a
 * choice between "decayed" and "periapical" when a tooth is genuinely both.
 *
 * Surfaces are a THIRD choice, not a second: they localize the finding on the
 * tooth (which of the five crown regions), and leaving them empty is a valid
 * answer — it means the whole tooth carries the condition (missing, implant).
 */
function ConditionPicker({ current, currentSymbol, fdi, currentSurfaces, symbols, saving, t, onSave }: PickerProps) {
  const [condition, setCondition] = useState(current);
  const [symbol, setSymbol] = useState<string | null>(currentSymbol);
  /* Surfaces start from the latest record so a correction opens pre-filled. */
  const [surfaces, setSurfaces] = useState<string[]>(currentSurfaces ? [...currentSurfaces] : []);

  const toggleSurface = (s: string) => {
    setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("chart.conditionKey")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.keys(CONDITION_APPEARANCE).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  condition === c
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-sm border border-border"
                  style={{ background: CONDITION_APPEARANCE[c]!.colour }}
                />
                {t(`cond.${c}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("chart.surfaces")}</p>
          <div className="flex flex-wrap gap-2">
            {CANONICAL_SURFACES.map((s) => {
              const on = surfaces.includes(s);
              /* Display letter is contextual (P on uppers, I on anteriors) while
               * the stored value stays canonical — the chip SAYS palatal but
               * WRITES lingual, so every screen renders the same mouth. */
              const display = surfaceDisplayLetter(s, fdi);
              return (
                <button
                  key={s}
                  type="button"
                  title={`${display}, ${SURFACE_WORDS[s]}`}
                  onClick={() => toggleSurface(s)}
                  className={`h-8 w-10 rounded-lg border font-mono text-xs font-semibold transition-colors ${
                    on ? "border-border bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {display}
                </button>
              );
            })}
            <span
              className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors ${
                surfaces.length === 0
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground"
              }`}
              title={t("chart.surfacesHint")}
            >
              {t("chart.wholeTooth")}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{t("chart.surfacesHint")}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("chart.symbolKey")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSymbol(null)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                symbol == null ? "border-border bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {t("chart.noSymbol")}
            </button>
            {symbols.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => setSymbol(s.code)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  symbol === s.code ? "border-border bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm border border-border" style={{ background: s.colour }} />
                {t(`sym.${s.code}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button size="sm" disabled={saving} onClick={() => onSave(condition, symbol, surfaces.length ? surfaces : null)} className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? "…" : t("chart.record")}
        </Button>
      </DialogFooter>
    </>
  );
}
