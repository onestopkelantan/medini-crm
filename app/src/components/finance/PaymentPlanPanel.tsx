/**
 * PaymentPlanPanel — P4 (0028). The patient's instalment plans, inside Patient360.
 *
 * WHAT THIS SCREEN IS
 *
 * The promise, the ledger, and the two money actions. A payment plan is a
 * promise (total + down + N instalments); the schedule is that promise being
 * kept or not. The panel therefore leads with the BALANCE — the one number
 * the counter asks about — and shows each instalment with its status, paid
 * rows dimmed, overdue rows red.
 *
 * WHO CAN DO WHAT (mirrors the backend's permission domain 'finance')
 *
 *   view  — see plans and schedule (any finance-visible role)
 *   create/pay/waive — money movement, finance edit
 *
 * The buttons are hidden only when the role cannot use them at all; when an
 * action is blocked by STATE (already paid, waived), the row simply shows its
 * state — money facts are not buttons.
 *
 * NUMBERS ARE STRINGS end-to-end (scale-4 decimals from the API). Rendering
 * is display-only; there is no arithmetic on the client — the balance and
 * next-due come from the server, which owns the invariant.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { fmtShortDate } from "@/lib/dateFormat";
import { AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------- types */

export type InstallmentStatus = "pending" | "paid" | "overdue" | "waived";

export interface PaymentPlanRow {
  id: string;
  plan_title_snapshot: string;
  total_amount: string;
  down_payment: string;
  installments: number;
  frequency: "weekly" | "biweekly" | "monthly";
  status: "active" | "completed" | "defaulted" | "cancelled";
  start_date: string;
  next_due_date: string | null;
  patient_name?: string | null;
  balance: string;
  overdue_count: number;
}

export interface InstallmentRow {
  installmentNo: number;
  amount: string;
  dueDate: string;
  paidDate: string | null;
  paidAmount: string | null;
  status: InstallmentStatus;
}

interface PlanDetail {
  plan: Record<string, unknown> & {
    id: string; plan_title_snapshot: string; total_amount: string; down_payment: string;
    status: PaymentPlanRow["status"]; frequency: PaymentPlanRow["frequency"];
    installments: number; start_date: string; next_due_date: string | null;
  };
  schedule: InstallmentRow[];
  balance: string;
  complete: boolean;
}

/* ------------------------------------------------------------- permissions */

const MONEY_ROLES = new Set(["hq", "manager"]);
const canMoveMoney = (role: string | undefined) => MONEY_ROLES.has(role ?? "");

/* ------------------------------------------------------------------ helpers */

/** Display a scale-4 API money string as RM with 2 decimals. */
function fmtMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (Number.isNaN(n)) return String(amount);
  return `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<InstallmentStatus, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-muted text-muted-foreground",
  overdue: "bg-red-100 text-red-700",
  waived: "bg-violet-100 text-violet-700",
};

/* ------------------------------------------------------------------- panel */

/* Baris sejarah pembayaran (P4-A): angsuran yang sudah selesai wangnya. */
interface HistoryRow {
  planId: string;
  planTitle: string;
  installmentNo: number;
  amount: string;
  paidAmount: string | null;
  dueDate: string;
  paidDate: string | null;
  status: "paid" | "waived";
}

export function PaymentPlanPanel({ patientId }: { patientId: string }) {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<{ planId: string; installment: InstallmentRow } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [waiveTarget, setWaiveTarget] = useState<{ planId: string; installment: InstallmentRow } | null>(null);
  const [waiveReason, setWaiveReason] = useState("");

  const money = canMoveMoney(user?.role);

  const plansQuery = useQuery({
    queryKey: ["payment-plans", "patient", patientId],
    queryFn: () => api.get<{ plans: PaymentPlanRow[] }>(`/finance/payment-plans?patientId=${patientId}`),
  });

  const detailQuery = useQuery({
    queryKey: ["payment-plan", openPlanId],
    queryFn: () => api.get<PlanDetail>(`/finance/payment-plans/${openPlanId}`),
    enabled: !!openPlanId,
  });

  /* P4-A — payment history (receipts): baris yang sudah dibayar/dikecualikan
   * merentas semua pelan pesakit ini. Sumber: endpoint history baharu. */
  const historyQuery = useQuery({
    queryKey: ["payment-history", patientId],
    queryFn: () => api.get<{ payments: HistoryRow[]; totalPaid: string }>(`/finance/payment-plans/patients/${patientId}/history`),
  });

  const payMutation = useMutation({
    mutationFn: (v: { planId: string; installmentNo: number; amount: string; paidDate: string }) =>
      api.post(`/finance/payment-plans/${v.planId}/pay`, {
        installmentNo: v.installmentNo, amount: v.amount, paidDate: v.paidDate,
      }),
    onSuccess: (_d, v) => {
      toast.success(t("payplan.paidToast", { no: v.installmentNo }));
      qc.invalidateQueries({ queryKey: ["payment-plan", openPlanId] });
      qc.invalidateQueries({ queryKey: ["payment-plans", "patient", patientId] });
      setPayTarget(null);
    },
    onError: (e) => toast.error(errorMessage(e, t("payplan.loadError"))),
  });

  const waiveMutation = useMutation({
    mutationFn: (v: { planId: string; installmentNo: number; reason: string }) =>
      api.post(`/finance/payment-plans/${v.planId}/waive`, {
        installmentNo: v.installmentNo, reason: v.reason,
      }),
    onSuccess: (_d, v) => {
      toast.success(t("payplan.waivedToast", { no: v.installmentNo }));
      qc.invalidateQueries({ queryKey: ["payment-plan", openPlanId] });
      qc.invalidateQueries({ queryKey: ["payment-plans", "patient", patientId] });
      setWaiveTarget(null);
    },
    onError: (e) => toast.error(errorMessage(e, t("payplan.loadError"))),
  });

  if (plansQuery.isLoading) {
    return <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }
  if (plansQuery.isError) {
    return <p className="text-sm text-red-600">{errorMessage(plansQuery.error, t("payplan.loadError"))}</p>;
  }

  const plans = plansQuery.data?.plans ?? [];
  const totalBalance = plans
    .filter((p) => p.status === "active" || p.status === "defaulted")
    .reduce((sum, p) => sum + parseFloat(p.balance || "0"), 0);
  const overdueCount = plans.reduce((sum, p) => sum + (p.overdue_count ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* The one number the counter asks about. */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <p className="text-xs text-muted-foreground">{t("payplan.balanceLabel")}</p>
          <p className={`text-2xl font-semibold ${overdueCount > 0 ? "text-red-600" : "text-foreground"}`}>
            {fmtMoney(totalBalance)}
          </p>
        </div>
        {overdueCount > 0 && (
          <p className="flex items-center gap-1 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            {t("payplan.overdueCount", { n: overdueCount })}
          </p>
        )}
      </div>

      {plans.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("payplan.empty")}
        </p>
      )}

      {plans.map((p) => {
        const open = openPlanId === p.id;
        return (
          <div key={p.id} className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50"
              onClick={() => setOpenPlanId(open ? null : p.id)}
              aria-expanded={open}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{p.plan_title_snapshot}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("payplan.meta", {
                    total: fmtMoney(p.total_amount),
                    down: fmtMoney(p.down_payment),
                    n: p.installments,
                    freq: t(`payplan.freq.${p.frequency}`),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status === "completed" ? "paid" : p.status === "active" ? "pending" : "waived"]}`}>
                  {t(`payplan.planStatus.${p.status}`)}
                </span>
                <span className="text-sm font-semibold text-foreground">{fmtMoney(p.balance)}</span>
              </div>
            </button>

            {open && (
              <div className="border-t border-border p-3">
                {detailQuery.isLoading && <Skeleton className="h-24 w-full" />}
                {detailQuery.isError && <p className="text-sm text-red-600">{errorMessage(detailQuery.error, t("payplan.loadError"))}</p>}
                {detailQuery.data && (
                  <div className="space-y-1.5">
                    {detailQuery.data.schedule.map((s) => (
                      <div
                        key={s.installmentNo}
                        className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                          s.status === "paid" ? "bg-emerald-50/60" : s.status === "overdue" ? "bg-red-50" : "bg-muted/50"
                        }`}
                      >
                        <span className={s.status === "paid" ? "text-muted-foreground" : "text-foreground"}>
                          #{s.installmentNo} · {fmtMoney(s.amount)} · {t("payplan.due")} {fmtShortDate(lang, s.dueDate)}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status]}`}>
                            {s.status === "paid" && s.paidDate ? (
                              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{fmtShortDate(lang, s.paidDate)}</span>
                            ) : s.status === "waived" ? (
                              <span className="flex items-center gap-1"><Ban className="h-3 w-3" />{t("payplan.status.waived")}</span>
                            ) : (
                              t(`payplan.status.${s.status}`)
                            )}
                          </span>
                          {money && s.status !== "paid" && s.status !== "waived" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => { setPayTarget({ planId: p.id, installment: s }); setPayAmount(s.amount); }}>
                                {t("payplan.payBtn")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setWaiveTarget({ planId: p.id, installment: s }); setWaiveReason(""); }}>
                                {t("payplan.waiveBtn")}
                              </Button>
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                    {detailQuery.data.schedule.length === 0 && (
                      <p className="px-2 text-sm text-muted-foreground">{t("payplan.paidUpFront")}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Pay dialog, amount pre-filled with the instalment, editable (part payments happen). */}
      {/* ============ SEJARAH PEMBAYARAN (P4-A, resit) ============ */}
      {(historyQuery.data?.payments ?? []).length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h4 className="text-sm font-semibold text-foreground">{t("payplan.historyTitle")}</h4>
            <p className="text-sm font-bold text-emerald-600">
              {t("payplan.historyTotal", { amt: String(historyQuery.data?.totalPaid ?? "0") })}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold text-foreground">{t("payplan.historyDate")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("payplan.historyPlan")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("payplan.historyNo")}</th>
                  <th className="px-3 py-2 text-right font-semibold text-foreground">{t("payplan.historyAmount")}</th>
                  <th className="px-3 py-2 font-semibold text-foreground">{t("payplan.historyStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data?.payments ?? []).map((h, i) => (
                  <tr key={`${h.planId}-${h.installmentNo}-${i}`} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{h.paidDate ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-foreground max-w-48 truncate">{h.planTitle}</td>
                    <td className="px-3 py-2 text-muted-foreground">#{h.installmentNo}</td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">RM{Number(h.paidAmount ?? h.amount).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${h.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>
                        {h.status === "paid" ? t("payplan.stPaid") : t("payplan.stWaived")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("payplan.payTitle", { no: payTarget?.installment.installmentNo ?? 0 })}</DialogTitle>
            <DialogDescription>{t("payplan.payDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{t("payplan.amountLabel")}</Label>
              <Input id="pay-amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">{t("payplan.dateLabel")}</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>{t("payplan.cancel")}</Button>
            <Button
              disabled={payMutation.isPending || parseFloat(payAmount || "0") <= 0}
              onClick={() => payTarget && payMutation.mutate({
                planId: payTarget.planId,
                installmentNo: payTarget.installment.installmentNo,
                amount: payAmount,
                paidDate: payDate,
              })}
            >
              {payMutation.isPending ? t("payplan.saving") : t("payplan.confirmPay")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waive dialog, a reason is required by the backend and by honesty. */}
      <Dialog open={!!waiveTarget} onOpenChange={(o) => !o && setWaiveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("payplan.waiveTitle", { no: waiveTarget?.installment.installmentNo ?? 0 })}</DialogTitle>
            <DialogDescription>{t("payplan.waiveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="waive-reason">{t("payplan.reasonLabel")}</Label>
            <Input id="waive-reason" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiveTarget(null)}>{t("payplan.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={waiveMutation.isPending || waiveReason.trim().length < 3}
              onClick={() => waiveTarget && waiveMutation.mutate({
                planId: waiveTarget.planId,
                installmentNo: waiveTarget.installment.installmentNo,
                reason: waiveReason.trim(),
              })}
            >
              {waiveMutation.isPending ? t("payplan.saving") : t("payplan.confirmWaive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
