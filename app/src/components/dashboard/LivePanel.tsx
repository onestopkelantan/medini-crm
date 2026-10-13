import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrefs } from "@/hooks/usePrefs";
import { translateStatus } from "@/lib/i18n";
import { Activity } from "lucide-react";

/**
 * FASA 1F — panel masa-nyata.
 *
 * Menjawab "apa jadi SEKARANG?" — bukan laporan, bukan angka.
 *
 * Dua keputusan:
 *
 * 1. Auto-refresh setiap 5 minit (keputusan pengguna). Klinik bukan bursa
 *    saham; 5 minit cukup segar dan tidak membebankan pangkalan data.
 *
 * 2. Susunan menaik: yang paling lama di ATAS. Masa mengalir ke bawah, jadi
 *    senarai yang mengalir cara sama boleh dibaca sebagai garis masa — dan
 *    pesakit yang menunggu paling lama adalah yang paling mudah terlupa.
 */

interface LiveItem {
  id: string;
  time: string;
  patientName: string;
  doctorName: string | null;
  branchName: string;
  status: string;
}

interface LiveFeed { now: string; limit: number; total: number; items: LiveItem[] }

/** Warna status — sama bahasa warna seperti tempat lain dalam sistem. */
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  "in-progress": { bg: "#f5f3ff", fg: "#6d28d9" },
  called: { bg: "#eff6ff", fg: "#1d4ed8" },
  "checked-in": { bg: "#eff6ff", fg: "#1d4ed8" },
  waiting: { bg: "#fffbeb", fg: "#b45309" },
  confirmed: { bg: "#f0fdfa", fg: "#0d9488" },
  booked: { bg: "#f8fafc", fg: "#64748b" },
};

export function LivePanel() {
  const { t, lang } = usePrefs();
  const q = useQuery<LiveFeed>({
    queryKey: ["dashboard", "live"],
    queryFn: () => api.get<LiveFeed>("/dashboard/live"),
    refetchInterval: 5 * 60_000, /* 5 minit */
    staleTime: 60_000,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="pt-1">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-1" style={{ background: "#f0fdf4", color: "#15803d" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {t("dash.live")}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          {t("dash.liveHint")}
        </span>
      </div>

      {q.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl" style={{ background: "hsl(var(--muted) / 0.5)" }}>
          <Activity className="h-5 w-5 text-muted-foreground" />
          <p className="text-[13px] font-medium text-muted-foreground">{t("dash.liveNone")}</p>
          <p className="text-[11.5px] text-muted-foreground">{t("dash.liveNoneHint")}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => {
            const tone = STATUS_TONE[it.status] ?? { bg: "#f8fafc", fg: "#64748b" };
            return (
              <div key={it.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: "hsl(var(--muted) / 0.45)" }}>
                <span className="text-[12.5px] font-bold tabular-nums text-foreground pt-0.5 w-11 shrink-0">{it.time}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{it.patientName}</p>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {it.doctorName ?? "—"} · {it.branchName}
                  </p>
                </div>
                <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>
                  {translateStatus(lang, it.status)}
                </span>
              </div>
            );
          })}
          {total > items.length && (
            <p className="text-[11.5px] text-muted-foreground text-center pt-1">
              {t("dash.liveMore", { n: total - items.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
