/**
 * PatientBalancesTab — P4 (0028). The "Balances" tab of the Finance page.
 *
 * THE CHASE LIST
 *
 * This is the counter's morning screen: every instalment plan in the clinic,
 * who owes, how much, and what is late — sorted so the most-owed and most-
 * overdue surface first. It is deliberately NOT a per-patient drill-down
 * (that is Patient360's Payments tab); it answers the branch-level question:
 * "how much money are we waiting on, and from whom?"
 *
 * Read-only. Money actions live in Patient360 where the patient's full
 * picture is visible — chasing a payment and recording one are different
 * moments, and the second deserves the patient's file open.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ScanSearch, ClipboardList } from "lucide-react";
import { toast } from "sonner";

interface PlanRow {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  plan_title_snapshot: string;
  total_amount: string;
  balance: string;
  overdue_count: number;
  installments: number;
  frequency: "weekly" | "biweekly" | "monthly";
  status: "active" | "completed" | "defaulted" | "cancelled";
  next_due_date: string | null;
}

function fmtMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (Number.isNaN(n)) return String(amount);
  return `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PatientBalancesTab() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();

  const plansQuery = useQuery({
    queryKey: ["payment-plans", "all"],
    queryFn: () => api.get<{ plans: PlanRow[] }>("/finance/payment-plans"),
  });

  /* FINANCE AI — the escalation scan button (Fasa D). HQ-only because the
   * endpoint is; the drafts it creates sit in the AI Manager approval queue
   * for a human to review. Nothing sends automatically, so a misclick costs
   * only a queue row that can be rejected. */
  const scan = useMutation({
    mutationFn: () => api.post<{ scanned: number; drafted: number; skippedExisting: number; staffTasks: number }>(
      "/ai/finance/escalation/scan", {},
    ),
    onSuccess: (res) => {
      toast.success(t("fin.scan.done", {
        n: res?.drafted ?? 0,
        s: res?.staffTasks ?? 0,
        k: res?.skippedExisting ?? 0,
      }));
      qc.invalidateQueries({ queryKey: ["payment-plans", "all"] });
    },
    onError: (e) => toast.error(errorMessage(e, t("fin.scan.error"))),
  });
  const isHq = user?.role === "hq";

  if (plansQuery.isLoading) return <Skeleton className="h-64 w-full" />;
  if (plansQuery.isError) {
    return <p className="text-sm text-red-600">{errorMessage(plansQuery.error, t("payplan.loadError"))}</p>;
  }

  const plans = plansQuery.data?.plans ?? [];
  /* The API orders by next due date; the chase list wants the most owed
   * first, with overdue plans pinned above everything else. */
  const sorted = [...plans].sort((a, b) => {
    const od = (b.overdue_count ?? 0) - (a.overdue_count ?? 0);
    if (od !== 0) return od;
    return parseFloat(b.balance || "0") - parseFloat(a.balance || "0");
  });

  const activePlans = plans.filter((p) => p.status === "active" || p.status === "defaulted");
  const totalOwed = activePlans.reduce((sum, p) => sum + parseFloat(p.balance || "0"), 0);
  const overduePlans = activePlans.filter((p) => (p.overdue_count ?? 0) > 0);
  const overdueTotal = overduePlans.reduce((sum, p) => sum + parseFloat(p.balance || "0"), 0);

  return (
    <div className="space-y-4">
      {/* Branch-level answer first: how much are we waiting on. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("payplan.tab.totalOwed")}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{fmtMoney(totalOwed)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("payplan.tab.activePlans", { n: activePlans.length })}
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${overduePlans.length > 0 ? "border-red-200 bg-red-50" : "border-border bg-card"}`}>
          <p className="text-xs text-muted-foreground">{t("payplan.tab.overduePlans")}</p>
          <p className={`mt-1 text-2xl font-semibold ${overduePlans.length > 0 ? "text-red-600" : "text-foreground"}`}>
            {overduePlans.length}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{fmtMoney(overdueTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("payplan.tab.completedPlans")}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {plans.filter((p) => p.status === "completed").length}
          </p>
        </div>
      </div>

      {overduePlans.length > 0 && isHq && (
        /* The scan only matters when something IS overdue — the button hides
         * on a clean book, same honesty as the Insight panel. */
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="text-xs text-amber-900">{t("fin.scan.hint", { n: overduePlans.length })}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={scan.isPending}
              onClick={() => scan.mutate()}
              className="rounded-xl border-amber-400/60 bg-amber-400/10 text-amber-700 dark:text-amber-300 hover:bg-amber-400/20"
            >
              <ScanSearch className="h-3.5 w-3.5 mr-1.5" />
              {t("fin.scan.button")}
            </Button>
            <Link to="/ai" className="text-xs font-medium text-amber-700 dark:text-amber-300 underline-offset-2 hover:underline">
              <ClipboardList className="h-3.5 w-3.5 mr-1 inline" />
              {t("fin.scan.queue")}
            </Link>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("payplan.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {sorted.map((p) => {
            const overdue = (p.overdue_count ?? 0) > 0 && (p.status === "active" || p.status === "defaulted");
            return (
              <Link
                key={p.id}
                to={`/patients/${p.patient_id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.patient_name ?? t("payplan.tab.unknownPatient")}
                    {overdue && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {t("payplan.overdueCount", { n: p.overdue_count })}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.plan_title_snapshot} · {t("payplan.meta", {
                      total: fmtMoney(p.total_amount),
                      down: "",
                      n: p.installments,
                      freq: t(`payplan.freq.${p.frequency}`),
                    })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-semibold ${overdue ? "text-red-600" : "text-foreground"}`}>
                    {fmtMoney(p.balance)}
                  </p>
                  {p.next_due_date && (
                    <p className="text-xs text-muted-foreground">
                      {t("payplan.tab.nextDue")} {new Date(p.next_due_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
