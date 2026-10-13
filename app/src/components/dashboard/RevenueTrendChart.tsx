import { useMemo } from "react";
import { usePrefs } from "@/hooks/usePrefs";
import { rm } from "@/lib/format";
import { fmtDateTime } from "@/lib/dateFormat";

/**
 * FASA 1F — graf trend jualan.
 *
 * Dilukis dengan SVG biasa, bukan pustaka carta. Sebabnya: satu garis dengan
 * 7–30 titik tidak memerlukan 200KB JavaScript, dan SVG boleh mewarisi warna
 * tema (garis mesti boleh dibaca dalam mod cerah DAN gelap).
 *
 * Tiga keputusan yang membentuk bentuknya:
 *
 * 1. Hari sifar KEKAL dalam siri. Kalau hari tanpa jualan dilangkau, graf
 *    jadi garis menaik yang lancar walaupun klinik tutup tiga hari.
 *
 * 2. Skala bermula dari sifar. Graf yang bermula dari nilai terendah
 *    membesar-besarkan perubahan kecil — dan HQ membuat keputusan atasnya.
 *
 * 3. Garis rata (semua sifar) tidak dilukis sebagai garis di tengah kotak.
 *    Ia ditandakan "belum ada data" supaya tiada sesiapa salah baca.
 */

export interface TrendPoint { date: string; revenue: string }

const W = 640;
const H = 180;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 26;

export function RevenueTrendChart({ points, total, changePct, height = 150, showAsOf }: {
  points: TrendPoint[];
  total: string;
  changePct: number | null;
  /** Tinggi lukisan. Graf papan penuh lebih tinggi daripada graf separuh. */
  height?: number;
  /** Bila data ini terakhir sync — graf mesti jujur tentang umurnya. */
  showAsOf?: string | null;
}) {
  const { t, lang } = usePrefs();
  const locale = lang === "ms" ? "ms-MY" : "en-GB";

  const values = useMemo(() => points.map((p) => Number(p.revenue)), [points]);
  const max = Math.max(...values, 0);
  const hasData = max > 0;

  const x = (i: number) =>
    PAD_L + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD_L - PAD_R));
  const y = (v: number) => H - PAD_B - (max === 0 ? 0 : (v / max) * (H - PAD_T - PAD_B));

  const line = points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]!).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD_B} L${x(0).toFixed(1)},${H - PAD_B} Z`;

  const short = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });

  /* Label paksi-X: 4 label sahaja, supaya tidak bertindan pada 30 hari. */
  const labelIdx = points.length <= 4
    ? points.map((_, i) => i)
    : [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];

  return (
    <div className="pt-2">
      <div className="flex items-baseline gap-2.5 mb-1">
        <p className="text-[22px] font-bold text-foreground" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {rm(Number(total), 0)}
        </p>
        {changePct !== null && (
          <span
            className="text-[12px] font-bold rounded-lg px-2 py-0.5"
            style={changePct >= 0
              ? { background: "#f0fdf4", color: "#15803d" }
              : { background: "#fff1f2", color: "#be123c" }}
          >
            {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct)}%
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">{t("dash.vsPrev")}</span>
        {showAsOf && (
          <span className="ml-auto text-[10.5px] text-muted-foreground">
            {t("dash.dataAsOf", { t: fmtDateTime(lang, showAsOf) })}
          </span>
        )}
      </div>

      {!hasData ? (
        <div style={{ height, background: "hsl(var(--muted) / 0.5)" }} className="flex flex-col items-center justify-center gap-1.5 rounded-xl">
          <p className="text-[13px] font-medium text-muted-foreground">{t("dash.noTrendData")}</p>
          <p className="text-[11.5px] text-muted-foreground">{t("dash.noTrendDataHint")}</p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={t("dash.revenueTrend")}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#54b648" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#54b648" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* garis dasar */}
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />

          <path d={area} fill="url(#trendFill)" />
          <path d={line} fill="none" stroke="#54b648" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* titik pada hujung, supaya mata tahu di mana "sekarang" */}
          {points.length > 0 && (
            <circle cx={x(points.length - 1)} cy={y(values[values.length - 1]!)} r="4" fill="#54b648" stroke="hsl(var(--card))" strokeWidth="2" />
          )}

          {labelIdx.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-current text-muted-foreground"
              style={{ fontSize: 11, opacity: 0.7 }}
            >
              {short(points[i]!.date)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
