/**
 * Scrubbing panel — boss directive #4 (8 Oct):
 * "AI Scrubbing harus ada list of scrubbing ... UI/UX branch manager
 * bisa setting berapa lama patient harus scrubbing."
 *
 * Two sections, both fed by /marketing/scrubbing-rules* (already live):
 *  1. Rules table — one row per treatment: interval in months + on/off.
 *     Manager is branch-scoped by the backend; HQ picks a branch.
 *  2. Due list — patients whose last treatment has passed its interval
 *     ("sudah waktunya scrubbing"), the campaign targeting source.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";
import { usePrefs } from "@/hooks/usePrefs";
import { canWriteMarketing } from "@/lib/permissions";
import { errorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ScrubbingRule {
  treatmentCode: string;
  treatmentName: string;
  category: string | null;
  intervalMonths: number;
  enabled: boolean;
  notes: string | null;
}

interface ScrubbingDue {
  patientId: string;
  patientName: string;
  phone: string | null;
  treatmentCode: string;
  treatmentName: string;
  lastVisit: string | null;
  monthsSince: number;
  intervalMonths: number;
}

const INTERVALS = [1, 2, 3, 4, 6, 9, 12, 18, 24];

export default function ScrubbingPanel() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const canWrite = canWriteMarketing(user?.role);
  const [view, setView] = useState<"rules" | "due">("rules");

  const rules = useQuery({
    queryKey: ["marketing", "scrubbing-rules", branchId],
    queryFn: () => api.get<ScrubbingRule[]>(`/marketing/scrubbing-rules${branchId ? `?branchId=${branchId}` : ""}`),
    enabled: !!branchId || user?.role === "hq",
  });

  const due = useQuery({
    queryKey: ["marketing", "scrubbing-due", branchId],
    queryFn: () => api.get<ScrubbingDue[]>(`/marketing/scrubbing-rules/due${branchId ? `?branchId=${branchId}` : ""}`),
    enabled: view === "due" && (!!branchId || user?.role === "hq"),
  });

  const update = useMutation({
    mutationFn: (patch: { treatmentCode: string; intervalMonths?: number; enabled?: boolean }) =>
      api.put("/marketing/scrubbing-rules", {
        branchId,
        treatmentCode: patch.treatmentCode,
        ...(patch.intervalMonths !== undefined ? { intervalMonths: patch.intervalMonths } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      }),
    onSuccess: () => {
      toast.success(t("scrub.ruleSaved"));
      qc.invalidateQueries({ queryKey: ["marketing", "scrubbing-rules"] });
      qc.invalidateQueries({ queryKey: ["marketing", "scrubbing-due"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("scrub.ruleSaveFailed"))),
  });

  const ruleRows = rules.data ?? [];
  const dueRows = due.data ?? [];
  const activeCount = ruleRows.filter((r) => r.enabled).length;

  return (
    <div className="space-y-4">
      {/* View switch: rules vs due list */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex rounded-xl bg-muted p-1">
          <button
            type="button"
            onClick={() => setView("rules")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === "rules" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t("scrub.tabRules")} ({ruleRows.length})
          </button>
          <button
            type="button"
            onClick={() => setView("due")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === "due" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t("scrub.tabDue")} ({due.data ? dueRows.length : "…"})
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{view === "rules" ? t("scrub.rulesHint") : t("scrub.dueHint")}</p>
      </div>

      {view === "rules" ? (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("scrub.colTreatment")}</th>
                <th className="px-4 py-2.5 font-medium">{t("scrub.colInterval")}</th>
                <th className="px-4 py-2.5 font-medium">{t("scrub.colActive")}</th>
              </tr>
            </thead>
            <tbody>
              {rules.isLoading ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{t("scrub.loading")}</td></tr>
              ) : ruleRows.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{t("scrub.noRules")}</td></tr>
              ) : ruleRows.map((r) => (
                <tr key={r.treatmentCode} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{r.treatmentName}</p>
                    {r.category && <p className="text-xs text-muted-foreground">{r.category}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <Select
                        value={String(r.intervalMonths)}
                        onValueChange={(v) => update.mutate({ treatmentCode: r.treatmentCode, intervalMonths: Number(v) })}
                      >
                        <SelectTrigger className="w-28 rounded-lg border-border bg-card text-sm" disabled={update.isPending}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVALS.map((n) => (
                            <SelectItem key={n} value={String(n)}>{t("scrub.months", { n })}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-foreground">{t("scrub.months", { n: r.intervalMonths })}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(v) => update.mutate({ treatmentCode: r.treatmentCode, enabled: v })}
                        disabled={update.isPending}
                      />
                    ) : (
                      <Badge variant={r.enabled ? "default" : "secondary"} className={r.enabled ? "bg-primary/15 text-primary border-primary/30" : ""}>
                        {r.enabled ? t("scrub.active") : t("scrub.inactive")}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("scrub.colPatient")}</th>
                <th className="px-4 py-2.5 font-medium">{t("scrub.colTreatment")}</th>
                <th className="px-4 py-2.5 font-medium">{t("scrub.colLastVisit")}</th>
                <th className="px-4 py-2.5 font-medium">{t("scrub.colOverdue")}</th>
              </tr>
            </thead>
            <tbody>
              {due.isLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t("scrub.loading")}</td></tr>
              ) : dueRows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t("scrub.noDue")}</td></tr>
              ) : dueRows.map((d) => (
                <tr key={d.patientId} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link to={`/patients/${d.patientId}`} className="font-medium text-primary hover:underline">
                      {d.patientName}
                    </Link>
                    {d.phone && <p className="text-xs text-muted-foreground">{d.phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-foreground">{d.treatmentName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{d.lastVisit ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className="bg-destructive/10 text-destructive border-destructive/30">
                      {t("scrub.overdueBy", { n: Math.max(0, d.monthsSince - d.intervalMonths) })}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "rules" && ruleRows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("scrub.footerActive", { active: activeCount, total: ruleRows.length })}
        </p>
      )}
      {!canWrite && (
        <p className="text-xs text-muted-foreground">{t("scrub.readOnly")}</p>
      )}
    </div>
  );
}
