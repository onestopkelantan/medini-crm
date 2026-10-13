import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodFilter, AlertRow } from "@/components/dashboard/DashboardBits";
import { RevenueTrendChart, type TrendPoint } from "@/components/dashboard/RevenueTrendChart";
import { LivePanel } from "@/components/dashboard/LivePanel";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { PulseRow } from "@/components/dashboard/PulseCards";
import { usePulse } from "@/hooks/usePulse";
import { usePrefs } from "@/hooks/usePrefs";
import { fmtShortDate } from "@/lib/dateFormat";
import { api } from "@/lib/api";

/* FASA 1G — WAJAH HQ, disusun semula mengikut draf yang diluluskan pengguna.
 *
 *   Baris 1 : 5 kad nadi bisnes (selebar skrin)
 *   Baris 2 : graf trend jualan, MELINTANG PENUH
 *   Baris 3 : perlakuan cawangan + sedang berlaku
 *
 * Lima kad lama (Belum Bermula / Cemerlang / Sederhana / Amaran) DIBUANG.
 * Ia memaksa sistem menilai cawangan yang datanya belum matang — Taman
 * Molek mempunyai temujanji hari ini tetapi dilabel "Belum Bermula" hanya
 * kerana temujanji itu belum berlaku. Kad baharu tidak menilai; ia melapor.
 */

interface Overview {
  period: string; from: string; to: string;
  summary: { branches: number; branchesStarted: number; green: number; amber: number; red: number; notStarted: number; totalRevenue: string };
  alerts: { lowAttendance: string[]; noData: string[]; outstandingLab: string; outstandingCommission: string; openAlerts: number };
}
interface Trend { period: string; from: string; to: string; points: TrendPoint[]; total: string; changePct: number | null }

export default function DashboardHQ({ onOpenBranch }: { onOpenBranch?: (id: string) => void }) {
  const [period, setPeriod] = useState("7D");
  const { t, lang } = usePrefs();

  const ov = useQuery({
    queryKey: ["dashboard", "overview", period],
    queryFn: () => api.get<Overview>(`/dashboard/overview?period=${period}`),
  });
  const pulse = usePulse(period);
  const trend = useQuery({
    queryKey: ["dashboard", "trend", period],
    queryFn: () => api.get<Trend>(`/dashboard/revenue-trend?period=${period}`),
  });

  const d = ov.data;
  const fmtDate = (iso: string) => fmtShortDate(lang, iso + "T00:00:00");

  return (
    <div className="space-y-6" style={{ animation: "fadeIn .25s ease" }}>
      <PageHeader
        title={t("dash.hqTitle")}
        description={d ? `${t("dash.panorama", { n: d.summary.branches })} · ${fmtDate(d.from)} – ${fmtDate(d.to)}` : t("common.loading")}
        actions={<PeriodFilter value={period} onChange={setPeriod} />}
      />

      {ov.isError && <EmptyState title={t("dash.loadFailed")} />}

      {/* ── Baris 1: 5 kad nadi bisnes ──────────────────────────────── */}
      <PulseRow d={pulse.data} isLoading={pulse.isLoading} />

      {/* ── Baris 2: graf trend, melintang penuh ───────────────────── */}
      <Panel title={t("dash.revenueTrend")} subtitle={t("dash.revenueTrendSub")}>
        {trend.isLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : (
          <RevenueTrendChart
            points={trend.data?.points ?? []}
            total={trend.data?.total ?? "0"}
            changePct={trend.data?.changePct ?? null}
            height={240}
            showAsOf={pulse.data?.totalSales.freshness.asOf ?? null}
          />
        )}
      </Panel>

      {/* ── Baris 3: perlakuan cawangan + sedang berlaku ────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title={t("dash.branchBehaviour")} subtitle={t("dash.branchBehaviourSub")}>
          {pulse.isLoading ? (
            <div className="space-y-2 pt-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
          ) : (
            <div className="pt-2 overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">{t("dash.colBranch")}</th>
                    <th className="py-2 px-3 font-semibold text-right">{t("dash.colBooked")}</th>
                    <th className="py-2 px-3 font-semibold text-right">{t("dash.colCame")}</th>
                    <th className="py-2 px-3 font-semibold text-right">{t("dash.colNoShow")}</th>
                    <th className="py-2 pl-3 font-semibold text-right">{t("dash.colNsPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(pulse.data?.branchBehaviour.rows ?? []).map((b) => (
                    <tr key={b.branchId} onClick={() => onOpenBranch?.(b.branchId)} className="border-t border-border hover:bg-muted/60 cursor-pointer transition">
                      <td className="py-2.5 pr-3 text-[13px] font-semibold text-foreground">{b.name}</td>
                      <td className="py-2.5 px-3 text-right text-[13px] tabular-nums text-foreground">{b.booked}</td>
                      <td className="py-2.5 px-3 text-right text-[13px] tabular-nums text-emerald-600 font-semibold">{b.completed}</td>
                      <td className="py-2.5 px-3 text-right text-[13px] tabular-nums" style={{ color: b.noShow > 0 ? "#be123c" : undefined, fontWeight: b.noShow > 0 ? 700 : 400 }}>{b.noShow}</td>
                      <td className="py-2.5 pl-3 text-right text-[12px] font-bold tabular-nums" style={{ color: (b.noShowPct ?? 0) > 20 ? "#be123c" : "#64748b" }}>
                        {b.noShowPct === null ? "—" : `${b.noShowPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {pulse.data && pulse.data.branchBehaviour.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td className="py-2.5 pr-3 text-[12px] font-bold uppercase text-muted-foreground">{t("dash.total")}</td>
                      <td className="py-2.5 px-3 text-right text-[13px] font-bold tabular-nums">{pulse.data.branchBehaviour.total.booked}</td>
                      <td className="py-2.5 px-3 text-right text-[13px] font-bold tabular-nums text-emerald-600">{pulse.data.branchBehaviour.total.completed}</td>
                      <td className="py-2.5 px-3 text-right text-[13px] font-bold tabular-nums">{pulse.data.branchBehaviour.total.noShow}</td>
                      <td className="py-2.5 pl-3 text-right text-[12px] font-bold tabular-nums">{pulse.data.branchBehaviour.total.noShowPct ?? "—"}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {pulse.data && pulse.data.branchBehaviour.rows.length === 0 && (
                <EmptyState title={t("dash.noClosedDays")} description={t("dash.noClosedDaysHint")} />
              )}
            </div>
          )}
        </Panel>

        <Panel title={t("dash.happeningNow")} subtitle={t("dash.happeningNowSub")}>
          <div style={{ maxHeight: 420, overflowY: "auto" }}><LivePanel /></div>
        </Panel>
      </div>

      {/* ── Baris 4: Insight AI, kad proaktif, sembunyi bila tiada ──── */}
      <InsightsPanel period={period} />

      {/* ── Baris 5: amaran, kekal, tetapi ringkas ─────────────────── */}
      {d && (d.alerts.lowAttendance.length > 0 || d.alerts.noData.length > 0
        || Number(d.alerts.outstandingLab) > 0 || Number(d.alerts.outstandingCommission) > 0) && (
        <Panel title={t("dash.needsAttentionTitle")} subtitle={t("dash.needsAttentionSub")}>
          <div className="space-y-2.5 pt-2">
            {Number(d.alerts.outstandingLab) > 0 && <AlertRow tone="warn">{t("dash.alertLab")}</AlertRow>}
            {Number(d.alerts.outstandingCommission) > 0 && <AlertRow tone="warn">{t("dash.alertCommission")}</AlertRow>}
            {d.alerts.openAlerts > 0 && <AlertRow tone="warn">{t("dash.alertOpen", { n: d.alerts.openAlerts })}</AlertRow>}
          </div>
        </Panel>
      )}
    </div>
  );
}
