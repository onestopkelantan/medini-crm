import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { Panel, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rm } from "@/lib/format";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { usePrefs } from "@/hooks/usePrefs";
import { fmtDateTime } from "@/lib/dateFormat";

/* FASA 1C — tab Bukku Sync.
 *
 * Di sinilah OPERATOR bekerja: sambungan, butang tarik, dan semakan beza.
 * Dashboard hanya menunjukkan isyarat; semua tindakan berlaku di sini.
 *
 * Prinsip yang dipegang:
 *
 *  1. Status sambungan mesti JUJUR. Kalau kunci API tiada, skrin kata
 *     "belum disambung" — ia tidak memaparkan sifar yang kelihatan seperti
 *     "tiada jualan".
 *
 *  2. Beza mesti menyebut ARAH. "Beza RM500" tidak cukup; operator perlu
 *     tahu sama ada CRM lebih atau Bukku lebih untuk tahu siapa perlu ditanya.
 *
 *  3. Nombor rasmi ialah Bukku. CRM dipaparkan di sebelah, bukan di tengah,
 *     supaya tiada siapa tersilap tentang yang mana dikira.
 */

interface BukkuStatus {
  configured: boolean;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  totalSyncedSales: number;
}

interface DailyMatch {
  branchId: string;
  branchName: string;
  date: string;
  bukku: string | null;
  crm: string | null;
  difference: string | null;
  status: "matched" | "mismatch" | "not-submitted" | "not-in-bukku";
  message: string | null;
}

interface ReconcileView {
  from: string;
  to: string;
  summary: {
    checked: number;
    matched: number;
    mismatch: number;
    notSubmitted: number;
    notInBukku: number;
    bukkuTotal: string;
    branchesWithIssues: number;
    absoluteDifference: string;
  };
  days: DailyMatch[];
}

interface SyncResult {
  fetched: number;
  created: number;
  skipped: number;
  rejected: Array<{ reason: string; externalRef: string | null }>;
}

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_STYLE: Record<DailyMatch["status"], { bg: string; fg: string; labelKey: string; icon: React.ReactElement }> = {
  matched: { bg: "#f0fdf4", fg: "#15803d", labelKey: "fin.status.matched", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  mismatch: { bg: "#fff1f2", fg: "#be123c", labelKey: "fin.status.mismatch", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  "not-submitted": { bg: "#fff1f2", fg: "#be123c", labelKey: "fin.status.notSubmitted", icon: <XCircle className="h-3.5 w-3.5" /> },
  "not-in-bukku": { bg: "#fff7ed", fg: "#c2410c", labelKey: "fin.status.notInBukku", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
};

export function BukkuSyncTab() {
  const { t, lang } = usePrefs();
  const qc = useQueryClient();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());

  const status = useQuery({
    queryKey: ["bukku", "status"],
    queryFn: () => api.get<BukkuStatus>("/finance/integration/bukku/status"),
  });

  const recon = useQuery({
    queryKey: ["bukku", "reconcile", from, to],
    queryFn: () => api.get<ReconcileView>(`/finance/integration/bukku/reconcile?from=${from}&to=${to}`),
  });

  const sync = useMutation({
    mutationFn: () =>
      api.post<SyncResult>("/finance/integration/bukku/sync-sales", { from, to }),
    onSuccess: (r) => {
      toast.success(t("fin.syncToast", { c: r.created, s: r.skipped }));
      void qc.invalidateQueries({ queryKey: ["bukku"] });
    },
    onError: (e) => toast.error(errorMessage(e, t("fin.syncFailed"))) ,
  });

  const s = recon.data?.summary;
  const problems = recon.data?.days.filter((d) => d.status !== "matched") ?? [];

  return (
    <div className="space-y-5">
      {/* Status sambungan */}
      <Panel title={t("fin.bukkuConnection")} subtitle={t("fin.bukkuConnectionSub")}>
        {status.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="pt-1 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {status.data?.configured && status.data?.syncEnabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: "#f0fdf4", color: "#15803d" }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("fin.connected")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: "#f8fafc", color: "#64748b" }}>
                  <AlertTriangle className="h-3.5 w-3.5" /> {t("fin.notConnected")}
                </span>
              )}
              <span className="text-[12px] text-muted-foreground">
                {t("fin.invoicesSynced", { n: status.data?.totalSyncedSales ?? 0 })}
                {status.data?.lastSyncedAt ? ` · ${t("fin.lastSyncAt", { t: fmtDateTime(lang, status.data.lastSyncedAt) })}` : ""}
              </span>
            </div>

            {!status.data?.configured && (
              <p className="text-[12.5px] text-muted-foreground rounded-xl px-3 py-2.5" style={{ background: "#f8fafc" }}>
                {t("fin.toActivate")} <code className="font-mono text-[11.5px]">BUKKU_API_KEY</code>,{" "}
                <code className="font-mono text-[11.5px]">BUKKU_COMPANY_SUBDOMAIN</code>, dan{" "}
                <code className="font-mono text-[11.5px]">BUKKU_SYNC_ENABLED=true</code> 
                {t("fin.onServer")}
              </p>
            )}
          </div>
        )}
      </Panel>

      {/* Butang sync */}
      <Panel title={t("fin.pullSales")} subtitle={t("fin.pullSalesSub")}>
        <div className="pt-1 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-[12px] text-muted-foreground">{t("fin.from")}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border-border bg-card w-[160px]" />
          </div>
          <div>
            <Label className="text-[12px] text-muted-foreground">{t("fin.to")}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl border-border bg-card w-[160px]" />
          </div>
          <Button
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !status.data?.configured || !status.data?.syncEnabled}
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${sync.isPending ? "animate-spin" : ""}`} />
            {sync.isPending ? t("fin.syncing") : t("fin.syncNow")}
          </Button>
          {(!status.data?.configured || !status.data?.syncEnabled) && (
            <span className="text-[12px] text-muted-foreground">{t("fin.btnDisabled")}</span>
          )}
        </div>

        {sync.isSuccess && (
          <div className="mt-3 text-[12.5px] text-muted-foreground rounded-xl px-3 py-2.5" style={{ background: "#f0fdf4" }}>
            Ditarik <b>{sync.data.fetched}</b> · baharu <b>{sync.data.created}</b> · sudah ada{" "}
            <b>{sync.data.skipped}</b>
            {sync.data.rejected.length > 0 && <> · ditolak <b>{sync.data.rejected.length}</b></>}
          </div>
        )}
      </Panel>

      {/* Padanan */}
      <Panel
        title={t("fin.dailyRecon")}
        subtitle={t("fin.dailyReconSub")}
      >
        {recon.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="pt-1 space-y-4">
            {/* Ringkasan */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label={t("fin.officialTotal")} value={rm(Number(s?.bukkuTotal ?? 0), 0)} tone="neutral" />
              <Stat label={t("fin.totalDiff")} value={rm(Number(s?.absoluteDifference ?? 0), 0)} tone={Number(s?.absoluteDifference ?? 0) > 0 ? "bad" : "good"} />
              <Stat label={t("fin.matched")} value={`${s?.matched ?? 0}/${s?.checked ?? 0}`} tone="good" />
              <Stat label={t("fin.needsAttention")} value={String(s?.branchesWithIssues ?? 0)} tone={(s?.branchesWithIssues ?? 0) > 0 ? "bad" : "good"} />
            </div>

            {problems.length === 0 ? (
              <EmptyState title={t("fin.allMatched")} description={t("fin.allMatchedSub")} />
            ) : (
              <div className="divide-y divide-border">
                {problems.map((d) => {
                  const st = STATUS_STYLE[d.status];
                  return (
                    <div key={`${d.branchId}-${d.date}`} className="py-3 flex flex-wrap items-start gap-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold shrink-0"
                        style={{ background: st.bg, color: st.fg }}
                      >
                        {st.icon}{t(st.labelKey)}
                      </span>
                      <div className="flex-1 min-w-[240px]">
                        <p className="text-[13px] font-semibold text-foreground">{d.branchName}</p>
                        <p className="text-[12px] text-muted-foreground mt-0.5">{d.message}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] text-muted-foreground">Bukku</p>
                        <p className="text-[13px] font-bold tabular-nums text-foreground">
                          {d.bukku ? rm(Number(d.bukku), 2) : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "neutral" }) {
  const color = tone === "bad" ? "#be123c" : tone === "good" ? "#15803d" : "#0f172a";
  return (
    <div className="rounded-xl border border-border px-3 py-2.5" style={{ background: "rgba(255,255,255,0.7)" }}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-[17px] font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}
