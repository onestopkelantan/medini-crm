import { Skeleton } from "@/components/ui/skeleton";
import { usePrefs } from "@/hooks/usePrefs";
import { rm } from "@/lib/format";
import { fmtDateTime } from "@/lib/dateFormat";
import { TrendingUp, TrendingDown, Clock, AlertCircle, UserPlus } from "lucide-react";

/**
 * FASA 1G — lima kad nadi bisnes.
 *
 * Setiap kad membawa label kesegaran sendiri. Ini bukan hiasan: kad jualan
 * yang synced semalam mesti kelihatan berbeza daripada kad temujanji yang
 * dikira saat ini. Angka yang kelihatan segar tetapi sebenarnya semalam
 * lebih berbahaya daripada angka yang jujur mengaku tua.
 *
 * Kad 2 (temujanji) sengaja TIDAK memaparkan "no-show". Pukul 12:36 tengah
 * hari, 30 temujanji yang belum sampai bukan kegagalan — mungkin masanya
 * pukul 4 petang. Ia memaparkan "belum sampai" dan "lewat" secara
 * berasingan.
 */

interface Freshness { asOf: string | null; stale: boolean; hoursOld: number | null }

export interface PulseCards {
  totalSales: { amount: string; changePct: number | null; freshness: Freshness; source: "bukku" | "mixed" };
  appointments: { booked: number; completed: number; pending: number; late: number; freshness: Freshness };
  todaySales: { amount: string; branches: number; freshness: Freshness };
  patientMix: { newCount: number; returning: number; newSharePct: number | null; freshness: Freshness };
  receivables:
    | { state: "known"; total: string; invoiceCount: number; asOf: string | null; freshness: Freshness }
    | { state: "unknown"; freshness: Freshness };
  branchBehaviour: {
    rows: Array<{ branchId: string; name: string; booked: number; completed: number; noShow: number; noShowPct: number | null }>;
    total: { booked: number; completed: number; noShow: number; noShowPct: number | null };
  };
}

/** Label bila data ini terakhir benar. Kad wajib jujur tentang umurnya. */
function FreshnessTag({ f, kind }: { f: Freshness; kind: "live" | "synced" }) {
  const { t, lang } = usePrefs();

  if (kind === "live") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "#15803d" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t("pulse.live")}
      </span>
    );
  }

  if (!f.asOf) {
    return <span className="text-[10.5px] text-muted-foreground">{t("pulse.noSync")}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: f.stale ? "#b45309" : undefined }}>
      {f.stale ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3 opacity-60" />}
      <span className={f.stale ? "font-semibold" : "text-muted-foreground"}>
        {t("pulse.dataAsOf", { t: fmtDateTime(lang, f.asOf) })}
      </span>
    </span>
  );
}

/* Gaya kad: satu bentuk, dipakai lima kali. */
const CARD = "rounded-2xl border p-4 flex flex-col gap-2 h-full";
const CARD_STYLE = {
  background: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
};

/* KuasaOS module-tinted KPI cards: satu kad anchor solid gradient, baki white
 * dengan tint icon berwarna ikut domain (emerald/teal/indigo/pink). */
const TINTS = {
  emerald: { strip: "#059669", soft: "rgba(5,150,105,0.08)" },
  teal:    { strip: "#0d9488", soft: "rgba(13,148,136,0.08)" },
  indigo:  { strip: "#4f46e5", soft: "rgba(79,70,229,0.08)" },
  pink:    { strip: "#db2777", soft: "rgba(219,39,119,0.08)" },
  slate:   { strip: "#475569", soft: "rgba(71,85,105,0.08)" },
} as const;
type TintKey = keyof typeof TINTS;

function tintedStyle(tint: TintKey) {
  return {
    ...CARD_STYLE,
    borderTop: `3px solid ${TINTS[tint].strip}`,
  };
}

export function PulseRow({ d, isLoading }: { d?: PulseCards; isLoading: boolean }) {
  const { t } = usePrefs();

  if (isLoading || !d) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[132px] w-full rounded-lg" />)}
      </div>
    );
  }

  /* ── Kad 1: Total sales ikut tempoh dipilih ─────────────────────── */
  const pct = d.totalSales.changePct;
  const salesCard = (
    <div className={CARD} style={tintedStyle("emerald")}>
      <p className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">{t("pulse.totalSales")}</p>
      <p className="text-[26px] font-bold text-foreground leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>
        {rm(Number(d.totalSales.amount), 0)}
      </p>
      <div className="flex items-center gap-1.5">
        {pct !== null && (
          <span className="inline-flex items-center gap-0.5 text-[11.5px] font-bold rounded-md px-1.5 py-0.5"
            style={pct >= 0 ? { background: "#f0fdf4", color: "#15803d" } : { background: "#fff1f2", color: "#be123c" }}>
            {pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(pct)}%
          </span>
        )}
        <span className="text-[10.5px] text-muted-foreground">{t("pulse.vsPrev")}</span>
      </div>
      <div className="mt-auto pt-1 border-t border-border flex items-center justify-between">
        <FreshnessTag f={d.totalSales.freshness} kind="synced" />
        <span className="text-[10px] text-muted-foreground">{d.totalSales.source === "bukku" ? "Bukku" : t("pulse.mixed")}</span>
      </div>
    </div>
  );

  /* ── Kad 2: Temujanji hari ini — REAL TIME ──────────────────────── */
  const a = d.appointments;
  const apptCard = (
    <div className={CARD} style={tintedStyle("teal")}>
      <p className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">{t("pulse.apptToday")}</p>
      <div className="flex items-baseline gap-1.5">
        <p className="text-[26px] font-bold text-foreground leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>{a.booked}</p>
        <span className="text-[12px] text-muted-foreground font-medium">{t("pulse.booked")}</span>
      </div>

      {/* Tiga tong yang berbeza makna, jangan sesekali dicampur. */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="text-muted-foreground">{t("pulse.completed")}</span>
          <span className="font-bold text-emerald-600 tabular-nums">{a.completed}</span>
        </div>
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="text-muted-foreground">{t("pulse.pending")}</span>
          <span className="font-semibold text-foreground tabular-nums">{a.pending}</span>
        </div>
        {a.late > 0 && (
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-semibold" style={{ color: "#b45309" }}>{t("pulse.late")}</span>
            <span className="font-bold tabular-nums" style={{ color: "#b45309" }}>{a.late}</span>
          </div>
        )}
      </div>

      <div className="mt-auto pt-1 border-t border-border">
        <FreshnessTag f={a.freshness} kind="live" />
      </div>
    </div>
  );

  /* ── Kad 3: Jualan hari ini (kunci pada hari ini) ───────────────── */
  const todayCard = (
    <div className={CARD} style={tintedStyle("indigo")}>
      <p className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">{t("pulse.todaySales")}</p>
      <p className="text-[26px] font-bold text-foreground leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>
        {rm(Number(d.todaySales.amount), 0)}
      </p>
      <p className="text-[10.5px] text-muted-foreground">{t("pulse.allBranches", { n: 14 })}</p>
      <div className="mt-auto pt-1 border-t border-border">
        <FreshnessTag f={d.todaySales.freshness} kind="synced" />
      </div>
    </div>
  );

  /* ── Kad 4: Pesakit baharu vs kembali ───────────────────────────── */
  const p = d.patientMix;
  const patCard = (
    <div className={CARD} style={tintedStyle("pink")}>
      <p className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">{t("pulse.patientMix")}</p>
      {p.newSharePct === null ? (
        <p className="text-[15px] font-semibold text-muted-foreground">{t("pulse.noPatients")}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5">
            <p className="text-[26px] font-bold text-foreground leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>
              {p.newCount}
            </p>
            <span className="text-[12px] text-muted-foreground font-medium">: {p.returning}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <UserPlus className="h-3 w-3 text-foreground" />
            <span className="text-[11.5px] font-semibold text-foreground">{p.newSharePct}% {t("pulse.newPct")}</span>
          </div>
        </>
      )}
      <div className="mt-auto pt-1 border-t border-border">
        <FreshnessTag f={p.freshness} kind="synced" />
      </div>
    </div>
  );

  /* ── Kad 5: Belum dikutip ──────────────────────────────────────── */
  /* 'unknown' MESTI berbeza daripada RM0. Kalau tidak, owner berhenti
     bimbang tentang hutang yang sebenarnya ada. */
  const r = d.receivables;
  const recvCard = (
    <div className={CARD} style={tintedStyle("slate")}>
      <p className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">{t("pulse.receivables")}</p>
      {r.state === "unknown" ? (
        <>
          <p className="text-[26px] font-bold text-muted-foreground leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>—</p>
          <p className="text-[10.5px] text-muted-foreground">{t("pulse.awaitingBukku")}</p>
        </>
      ) : (
        <>
          <p className="text-[26px] font-bold text-foreground leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>
            {rm(Number(r.total), 0)}
          </p>
          <p className="text-[10.5px] text-muted-foreground">{t("pulse.invoices", { n: r.invoiceCount })}</p>
        </>
      )}
      <div className="mt-auto pt-1 border-t border-border">
        <FreshnessTag f={r.freshness} kind="synced" />
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {salesCard}{apptCard}{todayCard}{patCard}{recvCard}
    </div>
  );
}

/** Guna untuk jadual perlakuan cawangan di bawah graf.
 *  (Hook moved to `@/hooks/usePulse` so this file exports only components.) */
