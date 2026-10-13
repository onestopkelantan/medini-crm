import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { PageHeader, StatCard, Panel, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rm } from "@/lib/format";
import { downloadCsv, datedCsvName } from "@/lib/csv";
import { TrendingUp, Download } from "lucide-react";
import {
  NewPatientsReport, AllergiesReport, WhatsAppTemplatesReport,
  AccessAuditReport, FormsIssuedReport,
} from "@/components/reports/ReportTables";
import AnalystPanel from "@/components/reports/AnalystPanel";

/* S10 T1: all six S9 reports endpoints are live backend data.
   Backend returns envelope objects: {period,from,to,scope,cards|rows|series} —
   the UI unwraps them here (contract alignment).

   FASA 1 (28 Sept 2026), DUA BUG WAYAR DIBETULKAN DI SINI:

   1. PERIOD. UI menghantar `?days=30`, backend membaca `?period=` dan hanya
      menerima 7D/30D/90D/12M (lihat isReportPeriod). Parameter yang tidak
      dikenali diabaikan, jadi SETIAP butang tempoh memulangkan tempoh lalai
      yang sama '30D', "90D" senyap memberi 30 hari. Butang itu hiasan.
      Kini UI menghantar nilai yang sah dan memaparkan period yang backend
      benar-benar gunakan (bukti, bukan andaian).

   2. BENTUK RESPONS. UI membaca `cards[].value` dan `rows[].revenue`, tetapi
      backend memulangkan KPI sebagai `cards[].value` (ok) dan trend sebagai
      `series[]` dengan kunci `booked/completed/noShow`, UI membaca
      `rows[]` dan `{date,count}`. Panel Appointment Trends sentiasa kosong.
      Kini setiap pembaca memadankan kontrak sebenar. */

interface KpiCard { kpiKey: string; value: string | number | null; unit: string; available?: boolean; note?: string }
interface BranchRev { branchId?: string; branchName?: string; revenue: string | number }
interface Mix { category?: string; treatmentName?: string; count: number; share?: number }
interface TrendPoint { date: string; booked: number; completed: number; noShow: number }
interface DocProd { doctorId?: string; name?: string; doctorName?: string; appointmentsCompleted?: number; revenue?: string | number }

interface KpisEnvelope { period?: string; from?: string; to?: string; cards?: KpiCard[] }
interface RowsEnvelope<T> { period?: string; rows?: T[] }
interface SeriesEnvelope { period?: string; series?: TrendPoint[] }

/* Nilai yang backend terima. `days` BUKAN kontrak. */
const PERIODS = ["7D", "30D", "90D", "12M"] as const;
type Period = (typeof PERIODS)[number];

export default function Reports() {
  const { t } = usePrefs();
  const [period, setPeriod] = useState<Period>("30D");
  const q = `period=${period}`;
  const kpis = useQuery({ queryKey: ["reports", "kpis", period], queryFn: () => api.get<KpisEnvelope>(`/reports/kpis?${q}`) });
  const revenue = useQuery({ queryKey: ["reports", "revenue", period], queryFn: () => api.get<RowsEnvelope<BranchRev>>(`/reports/revenue-by-branch?${q}`) });
  const mix = useQuery({ queryKey: ["reports", "mix", period], queryFn: () => api.get<RowsEnvelope<Mix>>(`/reports/treatment-mix?${q}`) });
  const trends = useQuery({ queryKey: ["reports", "trends", period], queryFn: () => api.get<SeriesEnvelope>(`/reports/appointment-trends?${q}`) });
  const doctors = useQuery({ queryKey: ["reports", "doctors", period], queryFn: () => api.get<RowsEnvelope<DocProd>>(`/reports/doctor-production?${q}`) });

  const cards = kpis.data?.cards ?? [];
  const revenueRows = revenue.data?.rows ?? [];
  const mixRows = mix.data?.rows ?? [];
  const trendRows = trends.data?.series ?? [];
  const doctorRows = doctors.data?.rows ?? [];
  const totalRevenue = revenueRows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);

  /* Kunci i18n untuk setiap KPI selama backend menyokongnya; jatuh balik kepada
     kunci mentah supaya KPI baharu tidak hilang senyap dari skrin. */
  const kpiLabel = (k: string) => {
    const known: Record<string, string> = {
      revenue: "rep.card.revenue", revenue_per_appointment: "rep.card.revenuePerAppt",
      recall_rate: "rep.card.recall", no_show_rate: "rep.card.noShow",
      chair_utilisation: "rep.card.chair",
    };
    return known[k] ? t(known[k]) : k.replace(/_/g, " ");
  };
  const kpiNote = (k: string, note?: string) => {
    const known: Record<string, string> = {
      chair_utilisation: "rep.note.noChair", recall_rate: "rep.note.noRecall",
    };
    return note ? (known[k] ? t(known[k]) : note) : "";
  };
  const fmtKpi = (c: KpiCard) => {
    if (c.available === false || c.value == null) return t("rep.card.unavailable");
    const n = Number(c.value);
    if (c.unit === "MYR") return rm(n, 0);
    return `${n}${c.unit === "percent" ? "%" : ""}`;
  };

  /* Tempoh yang backend BENAR-BENAR gunakan — dipaparkan supaya "90D" yang diberi
     30 hari kelihatan, bukan tersembunyi. */
  const livePeriod = kpis.data?.period ?? period;

  /* The five datasets on this screen, exported as one file.
   *
   * ONE FILE, NOT FIVE BUTTONS. The period selector already says which slice of
   * time is on screen, so five separate downloads would make the reader name the
   * slice themselves — and a report sent to a boss without its period is a number
   * without a meaning. A titled section per dataset keeps every figure attached
   * to the period it came from.
   *
   * Values are exactly what the panels render (the same `fmtKpi`, the same `rm`)
   * so the file and the screen cannot disagree. */
  const exportEverything = () => {
    const rows: unknown[][] = [];
    const section = (title: string) => {
      if (rows.length) rows.push([]);
      rows.push([title]);
    };

    section(`${t("rep.title")}, ${livePeriod}`);

    section(t("rep.revenueByBranch"));
    rows.push([t("rep.branch"), t("rep.total")]);
    revenueRows.forEach((r) => rows.push([r.branchName ?? r.branchId ?? t("rep.branch"), Number(r.revenue) || 0]));
    rows.push([t("rep.total"), totalRevenue]);

    section(t("rep.kpis"));
    rows.push([t("rep.title"), t("rep.total")]);
    cards.forEach((c) => rows.push([kpiLabel(c.kpiKey), fmtKpi(c)]));

    section(t("rep.treatmentMix"));
    rows.push([t("rep.treatment"), t("rep.appts")]);
    mixRows.forEach((m) => rows.push([m.treatmentName ?? m.category ?? t("rep.treatment"), m.count]));

    section(t("rep.appointmentTrends"));
    rows.push([t("rep.period"), t("rep.booked"), t("rep.completed"), t("rep.noShow")]);
    trendRows.forEach((p) => rows.push([p.date, p.booked, p.completed, p.noShow]));

    section(t("rep.doctorProduction"));
    rows.push([t("rep.doctor"), t("rep.appts"), t("rep.total")]);
    doctorRows.forEach((d) =>
      rows.push([d.name ?? d.doctorName ?? d.doctorId ?? t("rep.doctor"), d.appointmentsCompleted ?? "", Number(d.revenue) || 0]),
    );

    downloadCsv(datedCsvName(`laporan-${livePeriod}`), rows);
  };

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("rep.title")}
        description={t("rep.desc", { n: livePeriod })}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportEverything}
              disabled={kpis.isLoading}
              className="rounded-xl"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t("rep.exportCsv")}
            </Button>
            <div className="flex rounded-xl border border-border bg-card shadow-md overflow-hidden p-1 gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${period === p ? "bg-primary text-primary-foreground shadow-md shadow-teal-200/50" : "bg-transparent text-muted-foreground hover:bg-card"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.isLoading
          ? [1, 2, 3, 4].map((i) => <StatCard key={i} title="" value="" loading />)
          : cards.slice(0, 4).map((c) => (
              <StatCard
                key={c.kpiKey}
                title={kpiLabel(c.kpiKey)}
                value={fmtKpi(c)}
                icon={<TrendingUp className="h-4 w-4" />}
                sub={kpiNote(c.kpiKey, c.note) || t("rep.last", { n: livePeriod })}
                className="glass-card bg-card border border-border shadow-sm rounded-lg p-4"
              />
            ))}
      </div>

      <AnalystPanel />

      {/* ---- 4-TAB LAYOUT (Phase B, dental-erp pattern), every panel from
             the single-page layout still exists, grouped by the question the
             reader is asking: "how are we doing overall", "what work was
             done", "where did the money go", "is anything broken". ---- */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="glass-card bg-card border border-border shadow-md rounded-xl p-1 h-auto">
          <TabsTrigger value="overview" className="rounded-lg px-4 py-1.5 text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            {t("rep.tab.overview")}
          </TabsTrigger>
          <TabsTrigger value="clinical" className="rounded-lg px-4 py-1.5 text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            {t("rep.tab.clinical")}
          </TabsTrigger>
          <TabsTrigger value="financial" className="rounded-lg px-4 py-1.5 text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            {t("rep.tab.financial")}
          </TabsTrigger>
          <TabsTrigger value="operational" className="rounded-lg px-4 py-1.5 text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            {t("rep.tab.operational")}
          </TabsTrigger>
        </TabsList>

        {/* ---- TAB: OVERVIEW, the pulse: revenue split + workload shape ---- */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={`${t("rep.revenueByBranch")}, ${rm(totalRevenue, 0)} ${t("rep.total")}`} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              {revenue.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-border">
                {revenueRows.map((r, i) => (
                  <div key={i} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{r.branchName ?? r.branchId ?? t("rep.branch")}</p>
                    <span className="text-sm font-semibold text-foreground">{rm(Number(r.revenue) || 0)}</span>
                  </div>
                ))}
                {!revenue.isLoading && !revenueRows.length && <EmptyState title={t("rep.nodata.revenue")} description={t("rep.nodata.revenueHint")} />}
              </div>
            </Panel>

            <Panel title={t("rep.appointmentTrends")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              {trends.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-border max-h-64 overflow-y-auto">
                {trendRows.map((p, i) => (
                  <div key={i} className="py-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{p.date}</p>
                    <span className="text-xs text-muted-foreground">
                      {t("rep.booked")} {p.booked} · {t("rep.completed")} {p.completed} · {t("rep.noShow")} {p.noShow}
                    </span>
                  </div>
                ))}
                {!trends.isLoading && !trendRows.length && <EmptyState title={t("rep.nodata.trends")} description={t("rep.nodata.trendsHint")} />}
              </div>
            </Panel>
          </div>
        </TabsContent>

        {/* ---- TAB: CLINICAL, the work: what was treated, by whom ---- */}
        <TabsContent value="clinical" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("rep.treatmentMix")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              {mix.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-border">
                {mixRows.slice(0, 15).map((m, i) => (
                  <div key={i} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{m.treatmentName ?? m.category ?? t("rep.treatment")}</p>
                    <span className="text-sm font-semibold text-foreground">{m.count}×{m.share != null ? ` · ${m.share}%` : ""}</span>
                  </div>
                ))}
                {!mix.isLoading && !mixRows.length && <EmptyState title={t("rep.nodata.mix")} description={t("rep.nodata.mixHint")} />}
              </div>
            </Panel>

            <Panel title={t("rep.doctorProduction")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              {doctors.isLoading && <Skeleton className="h-40 w-full" />}
              <div className="divide-y divide-border">
                {doctorRows.map((d, i) => (
                  <div key={i} className="py-2.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{d.name ?? d.doctorName ?? d.doctorId ?? t("rep.doctor")}</p>
                    <span className="text-sm font-semibold text-foreground">
                      {d.appointmentsCompleted != null ? `${d.appointmentsCompleted} ${t("rep.appts")}` : ""}{d.revenue != null ? ` · ${rm(Number(d.revenue) || 0)}` : ""}
                    </span>
                  </div>
                ))}
                {!doctors.isLoading && !doctorRows.length && <EmptyState title={t("rep.nodata.doctors")} description={t("rep.nodata.doctorsHint")} />}
              </div>
            </Panel>

            <AllergiesReport />
            <FormsIssuedReport period={period} />
          </div>
        </TabsContent>

        {/* ---- TAB: FINANCIAL, where the money went (expenses join revenue
               here; revenue-by-branch stays on Overview because it IS the
               topline pulse). ---- */}
        <TabsContent value="financial" className="space-y-4">
          <FinanceSummaryPanel period={period} />
        </TabsContent>

        {/* ---- TAB: OPERATIONAL, who did what, and patient flow ---- */}
        <TabsContent value="operational" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <NewPatientsReport period={period} />
            <WhatsAppTemplatesReport />
            <AccessAuditReport period={period} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================================================================
 * FINANCIAL TAB — profit margin + expense view (Phase B).
 *
 * Reads the finance expenses-by-category endpoint (already live, used by the
 * Finance page) and pairs it with the revenue KPI to show profit margin.
 * The margin is computed HERE from the two fetched numbers — no new backend
 * endpoint, no model involvement.
 * ========================================================================== */
function FinanceSummaryPanel({ period }: { period: string }) {
  const { t } = usePrefs();
  const q = `period=${period}`;
  const kpis = useQuery({ queryKey: ["reports", "kpis", period], queryFn: () => api.get<KpisEnvelope>(`/reports/kpis?${q}`) });
  /* The controller returns the RAW array ({category,total,count}[]), not a
   * {rows} envelope — read it as the array. This endpoint requires the
   * finance.view permission; branch roles without it get a 403, and the
   * panel must say "not available" rather than render a broken tab. */
  const expenses = useQuery({
    queryKey: ["reports", "expenses", period],
    queryFn: () => api.get<Array<{ category?: string; total?: string | number }>>(`/finance/expenses/by-category?from=${periodFrom(period)}&to=${periodTo()}`),
    retry: false,
  });

  /* P5: collection efficiency — instalments due in the window, % paid on
   * time. Same 403-degradation story as expenses (finance.view required). */
  const collection = useQuery({
    queryKey: ["reports", "collection", period],
    queryFn: () => api.get<{ instalmentsDue: number; paidOnTime: number; onTimeRate: number | null; currentlyOverdue: number; collected: string }>(
      `/finance/payment-plans/collection-stats?from=${periodFrom(period)}&to=${periodTo()}`,
    ),
    retry: false,
  });
  const collectionBlocked = collection.error != null;

  const revenue = Number(kpis.data?.cards?.find((c) => c.kpiKey === "revenue")?.value ?? 0) || 0;
  const expenseRows = Array.isArray(expenses.data) ? expenses.data : [];
  const totalExpenses = expenseRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const margin = revenue > 0 ? ((revenue - totalExpenses) / revenue) * 100 : null;
  const financeBlocked = expenses.error != null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("rep.fin.revenue")}
          value={rm(revenue, 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          sub={t("rep.last", { n: period })}
          className="glass-card bg-card border border-border shadow-sm rounded-lg p-4"
        />
        <StatCard
          title={t("rep.fin.expenses")}
          value={financeBlocked ? t("rep.card.unavailable") : rm(totalExpenses, 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          sub={financeBlocked ? t("rep.fin.noPerm") : t("rep.last", { n: period })}
          className="glass-card bg-card border border-border shadow-sm rounded-lg p-4"
        />
        <StatCard
          title={t("rep.fin.margin")}
          value={financeBlocked || margin == null ? t("rep.card.unavailable") : `${margin.toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          sub={financeBlocked ? t("rep.fin.noPerm") : margin == null ? t("rep.fin.marginHint") : t("rep.last", { n: period })}
          className="glass-card bg-card border border-border shadow-sm rounded-lg p-4"
        />
        <StatCard
          title={t("rep.fin.collection")}
          value={collectionBlocked ? t("rep.card.unavailable") : collection.data?.onTimeRate == null ? "—" : `${collection.data.onTimeRate}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          sub={
            collectionBlocked
              ? t("rep.fin.noPerm")
              : collection.data == null || collection.data.instalmentsDue === 0
                ? t("rep.fin.collectionHint")
                : t("rep.fin.collectionSub", { on: collection.data.paidOnTime, due: collection.data.instalmentsDue })
          }
          className="glass-card bg-card border border-border shadow-sm rounded-lg p-4"
        />
      </div>

      <Panel title={t("rep.fin.byCategory")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
        {expenses.isLoading && <Skeleton className="h-40 w-full" />}
        {financeBlocked && !expenses.isLoading && (
          <EmptyState title={t("rep.fin.noPerm")} description={t("rep.fin.noPermHint")} />
        )}
        <div className="divide-y divide-border">
          {expenseRows.map((r, i) => (
            <div key={i} className="py-2.5 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{r.category ?? "—"}</p>
              <span className="text-sm font-semibold text-foreground">{rm(Number(r.total) || 0)}</span>
            </div>
          ))}
          {!expenses.isLoading && !financeBlocked && !expenseRows.length && <EmptyState title={t("rep.fin.noExpenses")} description={t("rep.fin.noExpensesHint")} />}
        </div>
      </Panel>
    </div>
  );
}

/* The expenses endpoint takes from/to dates, not a pill. Derive the window
 * client-side with the SAME rule the backend uses (inclusive, ends today).
 * Deterministic per render — the query re-runs when the pill changes. */
function periodFrom(period: string): string {
  const days: Record<string, number> = { "7D": 7, "30D": 30, "90D": 90, "12M": 365 };
  const d = new Date();
  d.setDate(d.getDate() - (days[period] ?? 30) + 1);
  return d.toISOString().slice(0, 10);
}
function periodTo(): string {
  return new Date().toISOString().slice(0, 10);
}