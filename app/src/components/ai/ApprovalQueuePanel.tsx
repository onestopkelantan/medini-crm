import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Clock, Ban } from "lucide-react";
import { toast } from "sonner";

/* ============================================================================
 * ApprovalQueuePanel — the INSTANCES behind an APPROVAL_REQUIRED verdict.
 *
 * The sibling ApprovalRulesPanel shows the RULES ("campaign send needs a
 * human"). This shows the actual ACTIONS that are waiting: the AI wanted to do
 * something, a human must decide, and until now there was nowhere to decide it
 * — the request was withheld and lost.
 *
 * Endpoints:
 *   GET  /ai/approval-requests?status=…          (list, newest first)
 *   POST /ai/approval-requests/:id/decide        { decision, note }
 *
 * FAIL-CLOSED ON ERROR: a model outage must not read as "nothing needs you".
 * The error branch says so explicitly rather than falling through to an empty
 * state, because an empty queue and a broken query look identical otherwise.
 * ========================================================================== */

interface ApprovalRequest {
  id: string;
  agentKey: string;
  domain: string;
  actionKey: string;
  risk: string;
  reason: string;
  status: string;
  decisionNote?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

const FILTERS = ["pending", "approved", "rejected", "all"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_STYLE: Record<string, { key: string; cls: string; icon: React.ReactNode }> = {
  pending: { key: "ai.req.status.pending", cls: "text-amber-600", icon: <Clock className="h-3.5 w-3.5" /> },
  approved: { key: "ai.req.status.approved", cls: "text-emerald-600", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  rejected: { key: "ai.req.status.rejected", cls: "text-red-600", icon: <XCircle className="h-3.5 w-3.5" /> },
  cancelled: { key: "ai.req.status.cancelled", cls: "text-muted-foreground", icon: <Ban className="h-3.5 w-3.5" /> },
};

/** A decision needs a reason for a REJECTION — "no" without a why teaches the
 *  operator nothing and makes the audit trail useless. Approval may be silent. */
function DecideDialog({
  request, decision, onClose,
}: { request: ApprovalRequest | null; decision: "approved" | "rejected"; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const mutate = useMutation({
    mutationFn: () =>
      api.post(`/ai/approval-requests/${request!.id}/decide`, { decision, note: note.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai", "approval-requests"] });
      toast.success(t(decision === "approved" ? "ai.req.approvedToast" : "ai.req.rejectedToast"));
      setNote("");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, t("ai.req.decideFailed"))),
  });

  const needsNote = decision === "rejected" && note.trim().length === 0;

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-lg">
        <DialogHeader>
          <DialogTitle>{t(decision === "approved" ? "ai.req.approve" : "ai.req.reject")}</DialogTitle>
          <DialogDescription>{request?.actionKey}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{request?.reason}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("ai.req.note")}</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(decision === "rejected" ? "ai.req.noteRequired" : "ai.req.noteOptional")}
              rows={3}
              className="rounded-xl resize-none"
            />
            {needsNote && <p className="text-xs text-amber-600">{t("ai.req.reasonNeeded")}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-xl" onClick={onClose}>{t("ai.cancel")}</Button>
            <Button
              className={`rounded-xl ${decision === "rejected" ? "bg-red-600 hover:bg-red-700" : "bg-primary"} text-white`}
              disabled={mutate.isPending || needsNote}
              onClick={() => mutate.mutate()}
            >
              {mutate.isPending ? t("ai.saving") : t(decision === "approved" ? "ai.req.confirmApprove" : "ai.req.confirmReject")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalQueuePanel() {
  const { t } = usePrefs();
  const [filter, setFilter] = useState<Filter>("pending");
  const [decide, setDecide] = useState<{ req: ApprovalRequest; decision: "approved" | "rejected" } | null>(null);

  const q = filter === "all" ? "" : `?status=${filter}`;
  const list = useQuery({
    queryKey: ["ai", "approval-requests", filter],
    queryFn: () => api.get<ApprovalRequest[]>(`/ai/approval-requests${q}`),
  });
  const rows = list.data ?? [];

  return (
    <>
      <Panel
        title={t("ai.req.title")}
        subtitle={t("ai.req.hint")}
        className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
        action={
          <div className="flex rounded-xl border border-border bg-card p-1 gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {t(`ai.req.filter.${f}`)}
              </button>
            ))}
          </div>
        }
      >
        {list.isLoading && <Skeleton className="h-40 w-full" />}
        {/* Distinct from the empty state on purpose, see the header comment. */}
        {list.isError && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(list.error, t("ai.req.loadFailed"))}
          </p>
        )}
        <div className="divide-y divide-border">
          {rows.map((r) => {
            const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
            const open = r.status === "pending";
            return (
              <div key={r.id} className="py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-medium text-foreground truncate">{r.actionKey}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.agentKey} · {r.domain} · {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge
                      status={r.risk === "HIGH" ? "high" : r.risk === "MEDIUM" ? "medium" : "low"}
                      statusText={t(`ai.risk.${r.risk}`)}
                      className="rounded-full px-3 py-1 text-xs"
                    />
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${style.cls}`}>
                      {style.icon}
                      {t(style.key)}
                    </span>
                  </div>
                </div>
                {/* WHY it was held, the whole point of the row. */}
                <p className="text-xs text-muted-foreground">{r.reason}</p>
                {open && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="rounded-xl bg-primary text-primary-foreground"
                      onClick={() => setDecide({ req: r, decision: "approved" })}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />{t("ai.req.approve")}
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setDecide({ req: r, decision: "rejected" })}>
                      <XCircle className="h-3.5 w-3.5 mr-1.5" />{t("ai.req.reject")}
                    </Button>
                  </div>
                )}
                {!open && r.decisionNote && (
                  <p className="text-xs text-muted-foreground italic">“{r.decisionNote}”</p>
                )}
              </div>
            );
          })}
          {list.isSuccess && !rows.length && (
            <EmptyState
              title={t(filter === "pending" ? "ai.req.emptyOpen" : "ai.req.empty")}
              description={t(filter === "pending" ? "ai.req.emptyOpenHint" : "ai.req.emptyHint")}
            />
          )}
        </div>
      </Panel>
      <DecideDialog
        request={decide?.req ?? null}
        decision={decide?.decision ?? "approved"}
        onClose={() => setDecide(null)}
      />
    </>
  );
}
