/**
 * TreatmentPlanPanel — the treatment plan screen (Fasa 1D).
 *
 * THE LIFECYCLE IS THE SCREEN
 *
 * `draft → proposed → accepted → active → completed`, with cancel reachable from
 * the first three. The UI is built around those five states rather than around a
 * form, because that is what a plan IS: an agreement that progresses. A screen that
 * only let you edit a plan's fields would be a CRUD form for something whose whole
 * meaning is where it sits in the sequence.
 *
 * TWO GATES THE UI MUST NOT PRETEND PAST
 *
 *   1. `accepted` needs a consent record when `consentRequired` is set
 *      (`evaluateConsentGate`). The backend returns **409**; the screen shows the
 *      reason and a route to fix it rather than a button that quietly fails.
 *   2. `completed` needs EVERY item done (`countPendingItems`). The screen shows how
 *      many are outstanding, so a doctor can see why the button is not going to work.
 *
 * The buttons are NOT hidden when a gate applies — they are shown with the blocking
 * reason. Hiding an action makes a person believe it does not exist; showing it with
 * an explanation teaches the rule once.
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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { fmtShortDate } from "@/lib/dateFormat";
import { ClipboardList, Plus, Check, ChevronRight, XCircle, Ban, AlertTriangle, ShieldCheck, Receipt } from "lucide-react";
import { ChargeFromPlanDialog } from "./ChargeFromPlanDialog";
import { toast } from "sonner";

/* ------------------------------------------------------------------- types */

export type PlanStatus = "draft" | "proposed" | "accepted" | "active" | "completed" | "cancelled";

export interface PlanItem {
  id: string; description: string; status: "pending" | "done";
  toothFdi: number | null; treatmentId: string | null; quantity: number;
}
export interface TreatmentPlan {
  id: string; planCode: string; title: string; status: PlanStatus;
  consentRequired: boolean;
  /* `branchId` is present on the record and is REQUIRED to charge against: HQ has no
   * branch of its own, so a charge that takes its branch from the operator sends null
   * and is refused with 422. The plan's own branch is the correct target. */
  branchId?: string | null;
  patientId: string; doctorId: string;
  proposedAt: string | null; acceptedAt: string | null;
  activatedAt: string | null; completedAt: string | null; cancelledAt: string | null;
  cancelReason: string | null; createdAt: string;
  items?: PlanItem[];
}
export interface CatalogEntry { id: string; code: string; name: string; category: string }

/* ---------------------------------------------------------------- lifecycle */

/** The forward move from each state, or null when there is none. */
const NEXT: Record<PlanStatus, { to: PlanStatus; labelKey: string } | null> = {
  draft:     { to: "proposed",  labelKey: "plan.toProposed" },
  proposed:  { to: "accepted",  labelKey: "plan.toAccepted" },
  accepted:  { to: "active",    labelKey: "plan.toActive" },
  active:    { to: "completed", labelKey: "plan.toCompleted" },
  completed: null,
  cancelled: null,
};

/** Cancel is reachable from the first three states only — `active` and `completed`
 * are past the point where "never mind" is a clinical statement. */
const CANCELLABLE: PlanStatus[] = ["draft", "proposed", "accepted"];

const STATUS_STYLE: Record<PlanStatus, string> = {
  draft:     "bg-muted text-foreground border-border",
  proposed:  "bg-blue-50 text-blue-700 border-blue-200",
  accepted:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  active:    "bg-accent text-foreground border-border",
  completed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

/* ------------------------------------------------------------------- panel */

export default function TreatmentPlanPanel({
  patientId, canEdit,
}: { patientId: string; canEdit?: boolean }) {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();

  /* THE WRITE SCOPE.
   *
   * `clinical:create` / `clinical:edit` for the doctor carry scope `own`, and the scope
   * guard is FAIL-CLOSED on writes: it fills the doctor in for reads but a WRITE must
   * name `branchId` + `doctorId` itself. Omitting them returns 403 "You do not have
   * permission" — which blames the ROLE while the real cause is a missing field.
   *
   * `verify-fasa1d-plan.sh` sends these fields, so it passed while the screen failed.
   * That gap is the lesson: an endpoint test proves the SERVER, never the client. */
  const scope = { branchId: user?.branchId ?? null, doctorId: user?.doctorId ?? null };
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<TreatmentPlan | null>(null);
  /* The plan whose bill is being written (Fasa 1C). Money is a separate act from
   * clinical entry, so it gets its own dialog rather than a field on the plan. */
  const [charging, setCharging] = useState<TreatmentPlan | null>(null);

  /* The patient's NAME, for the charge dialog's header. The panel only receives an
   * id, and a billing screen that shows a raw UUID is how the wrong patient gets
   * charged. Best-effort: a failure here must not block charging. */
  const patient = useQuery({
    queryKey: ["patient", patientId],
    queryFn: () => api.get<{ name?: string; fullName?: string }>(`/patients/${patientId}`),
    enabled: !!patientId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const name = patient.data?.fullName ?? patient.data?.name;

  const plans = useQuery({
    queryKey: ["plans", patientId],
    queryFn: () => api.get<TreatmentPlan[]>(`/clinical/plans?patientId=${patientId}`),
    enabled: !!patientId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["plans", patientId] });

  const create = useMutation({
    mutationFn: (body: { title: string; consentRequired: boolean; itemDescriptions: string[] }) =>
      api.post("/clinical/plans", {
        patientId, title: body.title, consentRequired: body.consentRequired,
        items: body.itemDescriptions.filter((d) => d.trim()).map((d) => ({ description: d.trim() })),
        ...scope,
      }),
    onSuccess: () => { invalidate(); setCreating(false); toast.success(t("plan.created")); },
    onError: (e) => toast.error(errorMessage(e, t("plan.createFailed"))),
  });

  const advance = useMutation({
    mutationFn: (b: { id: string; status: PlanStatus }) =>
      api.patch(`/clinical/plans/${b.id}/status`, { status: b.status, ...scope }),
    onSuccess: () => { invalidate(); toast.success(t("plan.updated")); },
    /* The gate messages come from the SERVER and are shown verbatim: they name the
     * blocking reason ("Consent gate blocked acceptance: CONSENT_REQUIRED"), which is
     * the one piece of information the person needs. */
    onError: (e) => toast.error(errorMessage(e, t("plan.updateFailed"))),
  });

  const cancel = useMutation({
    mutationFn: (b: { id: string; reason: string }) =>
      api.patch(`/clinical/plans/${b.id}/status`, { status: "cancelled", cancelReason: b.reason, ...scope }),
    onSuccess: () => { invalidate(); setCancelling(null); toast.success(t("plan.cancelled")); },
    onError: (e) => toast.error(errorMessage(e, t("plan.updateFailed"))),
  });

  if (plans.isLoading) return <Skeleton className="h-40 w-full" />;

  const rows = plans.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-foreground">{rows.length}</span>
          <span className="text-muted-foreground">{t("plan.count")}</span>
        </div>
        {canEdit && (
          <Button size="sm" className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />{t("plan.new")}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
          <ClipboardList className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t("plan.none")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("plan.noneHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              canEdit={canEdit}
              onAdvance={(status) => advance.mutate({ id: p.id, status })}
              onCancel={() => setCancelling(p)}
              onCharge={() => setCharging(p)}
              advancing={advance.isPending}
              lang={lang}
              t={t}
            />
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("plan.new")}</DialogTitle>
            <DialogDescription>{t("plan.newHint")}</DialogDescription>
          </DialogHeader>
          <NewPlanForm saving={create.isPending} onSubmit={(b) => create.mutate(b)} t={t} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("plan.cancelTitle")}</DialogTitle>
            <DialogDescription>{t("plan.cancelHint")}</DialogDescription>
          </DialogHeader>
          <CancelForm
            title={cancelling?.title ?? ""}
            saving={cancel.isPending}
            onSubmit={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason })}
            t={t}
          />
        </DialogContent>
      </Dialog>

      {/* FASA 1C, what was done becomes what was charged. */}
      <ChargeFromPlanDialog
        open={!!charging}
        onClose={() => setCharging(null)}
        patientId={patientId}
        patientName={name}
        planId={charging?.id ?? ""}
        planTitle={charging?.title}
        encounterId={(charging as TreatmentPlan & { encounterId?: string | null })?.encounterId ?? null}
        items={charging?.items ?? []}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- card */

function PlanCard({
  plan, open, onToggle, canEdit, onAdvance, onCancel, onCharge, advancing, lang, t,
}: {
  plan: TreatmentPlan; open: boolean; onToggle: () => void; canEdit?: boolean;
  onAdvance: (s: PlanStatus) => void; onCancel: () => void; onCharge: () => void;
  advancing: boolean; lang: "en" | "ms"; t: (k: string) => string;
}) {
  const next = NEXT[plan.status];

  /* ITEMS COME FROM THE DETAIL ENDPOINT, NOT THE LIST — and this was a live bug.
   *
   * `GET /clinical/plans` (the list) returns bare plans: no `items` key at all.
   * `GET /clinical/plans/:id` returns `{ plan, items, sessions }` with items as a
   * SIBLING of the plan. Reading `plan.items` off a list row therefore always
   * produced `[]`, so every plan rendered with no item list, no tick-to-done control,
   * and no "completed needs all items done" warning — while the database held the
   * items and the server returned them correctly to anyone who asked directly.
   *
   * `verify-fasa1d-plan.sh` passed 29/29 the whole time because it calls the API
   * directly, where items ARE present. The server was never wrong; the join was.
   * Fetched on expand, because that is when items are used — the actions block and
   * the item list both live inside `{open && …}`. */
  const detail = useQuery({
    queryKey: ["plan", plan.id],
    queryFn: () => api.get<{ plan: TreatmentPlan; items: PlanItem[] }>(`/clinical/plans/${plan.id}`),
    enabled: open,
    staleTime: 30_000,
  });
  const items = detail.data?.items ?? plan.items ?? [];
  const pending = items.filter((i) => i.status === "pending").length;
  const done = items.filter((i) => i.status === "done").length;

  /* BOTH GATES, EVALUATED FOR DISPLAY. The server is still the authority — this only
   * decides whether to explain why the button will refuse, instead of letting the
   * person discover it by failing. */
  const needsConsentFirst = next?.to === "accepted" && plan.consentRequired;
  const needsAllItemsDone = next?.to === "completed" && pending > 0;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button type="button" onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 p-3.5 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{plan.planCode}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[plan.status]}`}>
              {t(`pst.${plan.status}`)}
            </span>
            {plan.consentRequired && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                <ShieldCheck className="h-3 w-3" />{t("plan.consentRequired")}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-foreground">{plan.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length > 0 && `${done}/${items.length} ${t("plan.itemsDone")} · `}
            {fmtShortDate(lang, plan.createdAt)}
          </p>
        </div>
        <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border p-3.5">
          {/* ---- timeline ---- */}
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {plan.proposedAt  && <span>{t("plan.atProposed")} {fmtShortDate(lang, plan.proposedAt)}</span>}
            {plan.acceptedAt  && <span>{t("plan.atAccepted")} {fmtShortDate(lang, plan.acceptedAt)}</span>}
            {plan.activatedAt && <span>{t("plan.atActive")} {fmtShortDate(lang, plan.activatedAt)}</span>}
            {plan.completedAt && <span>{t("plan.atCompleted")} {fmtShortDate(lang, plan.completedAt)}</span>}
            {plan.cancelledAt && <span className="text-red-600">{t("plan.atCancelled")} {fmtShortDate(lang, plan.cancelledAt)}</span>}
          </div>
          {plan.cancelReason && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {plan.cancelReason}
            </p>
          )}

          {/* ---- items ---- */}
          {items.length > 0 && (
            <div className="mb-3 divide-y divide-border rounded-lg border border-border">
              {items.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${i.status === "done" ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                      {i.status === "done" && <Check className="h-3 w-3" />}
                    </span>
                    <span className={i.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}>
                      {i.description}
                    </span>
                    {i.toothFdi != null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {i.toothFdi}
                      </span>
                    )}
                  </span>
                  <SetItemDone item={i} t={t} disabled={!canEdit} />
                </div>
              ))}
            </div>
          )}

          {/* ---- gates, stated before they bite ---- */}
          {needsConsentFirst && (
            <p className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("plan.gateConsent")}
            </p>
          )}
          {needsAllItemsDone && (
            <p className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("plan.gateItems").replace("{n}", String(pending))}
            </p>
          )}

          {/* ---- actions: shown even when gated, with the reason above ---- */}
          <div className="flex flex-wrap gap-2">
            {canEdit && (next || CANCELLABLE.includes(plan.status)) && (
              <>
                {next && (
                  <Button size="sm" disabled={advancing}
                    className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => onAdvance(next.to)}>
                    {t(next.labelKey)}
                  </Button>
                )}
                {CANCELLABLE.includes(plan.status) && (
                  <Button size="sm" variant="outline" className="rounded-lg text-red-700" onClick={onCancel}>
                    <Ban className="mr-1.5 h-3.5 w-3.5" />{t("plan.cancel")}
                  </Button>
                )}
              </>
            )}
            {/* FASA 1C, charge the plan. Shown for EVERY plan that has items,
                regardless of status: a clinic bills a completed treatment and also
                bills ahead of one, and neither is the UI's call to make. The dialog
                states who may charge, so a dentist who opens it is told the rule
                instead of being shown a button that is missing. */}
            {items.length > 0 && (
              <Button size="sm" variant="outline" className="rounded-lg"
                onClick={onCharge}>
                <Receipt className="mr-1.5 h-3.5 w-3.5" />{t("charge.open")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Mark one item done. Its own component so the mutation is per-item and the list
 * stays readable — a shared handler with the id in the closure is how the wrong row
 * gets updated. */
function SetItemDone({ item, disabled, t }: { item: PlanItem; disabled?: boolean; t: (k: string) => string }) {
  const qc = useQueryClient();
  /* Its own `useAuth`, because `scope` from the parent is not in this closure. Ticking
   * an item is the most-used control on the screen, and without the fields it would be
   * the FIRST thing a dentist hit a 403 on. */
  const { user } = useAuth();
  const m = useMutation({
    mutationFn: () => api.patch(`/clinical/plans/items/${item.id}/status`, {
      status: item.status === "done" ? "pending" : "done",
      branchId: user?.branchId ?? null, doctorId: user?.doctorId ?? null,
    }),
    /* Both keys: `["plans", patientId]` is the list, `["plan", id]` is the detail that
     * actually carries the items. Invalidating only the list would leave the ticked
     * row still showing its old state — the exact failure this fix exists to remove. */
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan"] });
    },
    onError: () => toast.error(t("plan.updateFailed")),
  });

  return (
    <button type="button" disabled={disabled || m.isPending}
      onClick={() => m.mutate()}
      className="shrink-0 text-[11px] font-medium text-primary underline-offset-2 hover:underline disabled:opacity-40">
      {item.status === "done" ? t("plan.markPending") : t("plan.markDone")}
    </button>
  );
}

/* ------------------------------------------------------------------ forms */

function NewPlanForm({
  saving, onSubmit, t,
}: {
  saving: boolean; t: (k: string) => string;
  onSubmit: (b: { title: string; consentRequired: boolean; itemDescriptions: string[] }) => void;
}) {
  const [title, setTitle] = useState("");
  const [consentRequired, setConsent] = useState(false);
  /* One textarea rather than a repeating field group: a plan is usually 2–6 lines of
   * treatment typed in one go, and a "+ add item" row per line makes the common case
   * (three extractions) take three dialogs. */
  const [lines, setLines] = useState("");

  const descriptions = lines.split("\n").map((l) => l.trim()).filter(Boolean);
  const blocked = saving || title.trim().length < 2;

  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <Label htmlFor="ptitle">{t("plan.fieldTitle")}</Label>
          <Input id="ptitle" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t("plan.fieldTitlePh")} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="pitems">{t("plan.fieldItems")}</Label>
          <Textarea id="pitems" value={lines} onChange={(e) => setLines(e.target.value)}
            rows={4} placeholder={t("plan.fieldItemsPh")} className="mt-1.5 font-mono text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("plan.fieldItemsHint").replace("{n}", String(descriptions.length))}
          </p>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={consentRequired} onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border" />
          <span>
            <span className="font-medium text-foreground">{t("plan.fieldConsent")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("plan.fieldConsentHint")}</span>
          </span>
        </label>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={blocked}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit({ title: title.trim(), consentRequired, itemDescriptions: descriptions })}>
          {saving ? "…" : t("plan.create")}
        </Button>
      </DialogFooter>
    </>
  );
}

function CancelForm({
  title, saving, onSubmit, t,
}: { title: string; saving: boolean; t: (k: string) => string; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const blocked = saving || reason.trim().length < 3;

  return (
    <>
      <div className="space-y-3 py-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div>
          <Label htmlFor="creason">{t("plan.fieldReason")}</Label>
          <Textarea id="creason" value={reason} onChange={(e) => setReason(e.target.value)}
            rows={3} placeholder={t("plan.fieldReasonPh")} className="mt-1.5" />
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={blocked} variant="outline"
          className="rounded-lg text-red-700" onClick={() => onSubmit(reason.trim())}>
          <XCircle className="mr-1.5 h-3.5 w-3.5" />{saving ? "…" : t("plan.cancel")}
        </Button>
      </DialogFooter>
    </>
  );
}
