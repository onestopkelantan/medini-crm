import type { ReactNode } from "react";
import { usePrefs } from "@/hooks/usePrefs";

/* FASA A + 1B — komponen kecil Dashboard.
   Dipisah dari halaman supaya setiap satu boleh dibaca sendiri.
   Semua teks melalui terjemahan (usePrefs), peraturan pengguna:
   jangan campur bahasa. */

export type HealthBand = "green" | "amber" | "red" | "not-started";

const BAND_STYLE: Record<HealthBand, { bg: string; fg: string; dot: string }> = {
  green: { bg: "#f0fdf4", fg: "#15803d", dot: "#22c55e" },
  amber: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
  red: { bg: "#fff1f2", fg: "#be123c", dot: "#f43f5e" },
  "not-started": { bg: "#f8fafc", fg: "#64748b", dot: "#cbd5e1" },
};

/** Kunci terjemahan bagi setiap gred. */
const BAND_KEY: Record<HealthBand, string> = {
  green: "dash.excellent",
  amber: "dash.moderate",
  red: "dash.alert",
  "not-started": "dash.notStarted",
};

/** Lencana gred kesihatan. */
export function HealthBadge({ band }: { band: HealthBand }) {
  const { t } = usePrefs();
  const s = BAND_STYLE[band];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      {t(BAND_KEY[band])}
    </span>
  );
}

/** Bar kemajuan nipis — untuk kadar hadir. */
export function MiniBar({ percent, band }: { percent: number | null; band: HealthBand }) {
  const s = BAND_STYLE[band];
  const w = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: s.dot }} />
      </div>
      <span className="text-[12px] font-bold tabular-nums w-11 text-right" style={{ color: percent === null ? "#cbd5e1" : s.fg }}>
        {percent === null ? "—" : `${percent}%`}
      </span>
    </div>
  );
}

/** Penapis tempoh — satu tingkap untuk semua nombor di skrin. */
const PERIOD_KEYS: Array<{ key: string; tkey: string }> = [
  { key: "today", tkey: "common.today" },
  { key: "7D", tkey: "common.days7" },
  { key: "30D", tkey: "common.days30" },
  { key: "MTD", tkey: "common.thisMonth" },
];

export function PeriodFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = usePrefs();
  return (
    <div className="inline-flex rounded-xl border border-border bg-card/80 p-0.5" style={{ backdropFilter: "blur(12px)" }}>
      {PERIOD_KEYS.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`px-3 py-1.5 text-[12px] font-semibold rounded-[10px] transition ${
            value === p.key ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          style={value === p.key ? { background: "#54b648" } : undefined}
        >
          {t(p.tkey)}
        </button>
      ))}
    </div>
  );
}

/** Kad ringkasan ringkas (HQ guna banyak). */
export function SummaryCard({
  label, value, sub, gradient, icon,
}: { label: string; value: ReactNode; sub?: string; gradient: string; icon: ReactNode }) {
  return (
    <div
      className="rounded-lg border border-border p-4 flex flex-col gap-2.5"
      style={{ background: "hsl(var(--card) / 0.85)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}
    >
      <div className="h-9 w-9 rounded-xl flex items-center justify-center text-primary-foreground" style={{ background: gradient }}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </div>
      <div>
        <p className="text-[12px] text-muted-foreground font-medium">{label}</p>
        <p className="text-[24px] font-bold text-foreground leading-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/** Baris amaran — dengan ikon, bukan sekadar teks merah. */
export function AlertRow({ tone, children }: { tone: "warn" | "info"; children: ReactNode }) {
  const c = tone === "warn" ? { bg: "#fffbeb", fg: "#92400e", icon: "#f59e0b" } : { bg: "#eff6ff", fg: "#1e40af", icon: "#3b82f6" };
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5" style={{ background: c.bg }}>
      <svg className="h-4 w-4 mt-0.5 shrink-0" style={{ color: c.icon }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {tone === "warn" ? <><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" /><path d="M12 9v4M12 17h.01" /></> : <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>}
      </svg>
      <p className="text-[12.5px] font-medium leading-snug" style={{ color: c.fg }}>{children}</p>
    </div>
  );
}
