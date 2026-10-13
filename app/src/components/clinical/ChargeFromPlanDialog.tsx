/**
 * ChargeFromPlanDialog — Fasa 1c, Seksyen 1.
 *
 * THE GAP THIS CLOSES
 *
 * A treatment plan records WHAT will be done. It has never carried money, and
 * `treatment_plan_items` has no price column — deliberately. A plan is a clinical
 * agreement ("scaling, tooth 36"), not an invoice.
 *
 * The money step is a separate, permissioned act: `POST /finance/treatment-costs`.
 * That endpoint has existed all along and **had no caller in the product**. So the
 * chain
 *     record treatment -> store a cost -> render a bill
 * stopped at the second arrow. `treatment_costs` stayed empty, and every revenue
 * report read RM0.00 — not because the maths was wrong, but because nothing ever
 * put a number in.
 *
 * This dialog is that missing caller. It is where "what was done" becomes "what
 * was charged".
 *
 * WHO MAY CHARGE — HQ ONLY, AND THAT IS A DECISION TO RE-EXAMINE
 *
 * The gate is the PERMISSION, not the role: `POST /finance/treatment-costs` needs
 * `finance:create`. Read from the matrix as `R(view, create, edit, submit, approve,
 * del)`:
 *
 *     hq              finance = R(true,  true,  true,  true, false, false)  all
 *     branch_manager  finance = R(true,  false, false, true, false, false)  branch
 *     doctor          finance = NONE
 *
 * So HQ charges and **no branch can bill itself**. Verified live, not read off the
 * file: with the manager's branch and patient correct in the payload, the manager
 * still receives 403 — the refusal is the permission, not a missing field.
 *
 * ON A 14-BRANCH GROUP THIS BOTTLES EVERY BILL LINE THROUGH HQ. It works, it is
 * consistent, and it may be exactly what the owner wants (central pricing control).
 * It is written here as a note because it is a THROUGHPUT decision hiding inside a
 * permission table, and the person who can settle it is the owner.
 *
 * A DOCTOR DECIDES WHAT IS NEEDED; HQ DECIDES WHAT IT COSTS.
 *
 * A DOCTOR REACHING THIS SCREEN IS NOT AN ERROR
 *
 * The dialog is reachable from the plan panel, which is the dentist's own screen.
 * Rather than hide it (leaving a dentist to wonder why a plan never becomes a
 * bill), it opens and says plainly who can charge it. Hiding an action teaches
 * that the feature does not exist.
 *
 * MONEY IS ENTERED IN RINGGIT AND STORED AS A DECIMAL STRING
 *
 * The column is `numeric(19,4)` and the API takes a decimal STRING with up to 4
 * places — unlike `treatment_catalog.price`, which is integer sen. The conversion
 * happens once, here. A blank price is NOT sent as 0: `0` would record a
 * deliberately free treatment, which is a different fact from "nobody set it".
 *
 * ONE CHARGE PER ITEM
 *
 * `treatment_costs` is one row per charge, so ticked items are posted one at a
 * time. That makes partial failure possible, and partial failure is reported as
 * such — the dialog never claims success for rows the server rejected.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";
import { canWriteFinance } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Receipt } from "lucide-react";

import type { PlanItem, TreatmentPlan } from "./TreatmentPlanPanel";

/** Catalog entry, as `GET /clinical/treatments` returns it. `price` is integer SEN. */
interface CatalogTreatment {
  id: string;
  code?: string;
  name?: string;
  category?: string;
  price?: number | string | null;
}

/** An existing charge on the plan, as `GET /finance/treatment-costs?planId=` returns it. */
interface ExistingCost {
  id: string;
  description?: string;
  quantity?: number;
  unitCost?: number | string;
  totalCost?: number | string;
  costDate?: string;
}

/** What the operator has ticked, with the figures they typed. */
interface Row {
  item: PlanItem;
  checked: boolean;
  quantity: string;
  unit: string;
}

/* sen (integer, from the catalog) -> ringgit string for the field. NULL stays
 * blank: "not priced yet" and "priced at zero" are different facts. */
function senToRinggit(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

/* Ringgit -> the decimal string the API validates (/^\d+(\.\d{1,4})?$/).
 * Returns null for anything that would put a non-number on a legal record. */
function toAmount(v: string): string | null {
  const s = v.trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ChargeFromPlanDialog({
  open, onClose, patientId, patientName, planId, planTitle, encounterId, items, patientBranchId,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName?: string;
  planId: string;
  planTitle?: string;
  encounterId: string | null;
  items: PlanItem[];
  /** The patient's branch, when the caller already knows it. The plan's own
   *  `branchId` is preferred; this is the fallback for a caller holding the row. */
  patientBranchId?: string | null;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { branchId: activeBranchId } = useBranch();

  /* Same rule the server enforces on the money endpoint. Roles appear here because
   * the frontend has no permission helper for finance yet; if the matrix is widened,
   * change it HERE and in `architecture.contract.ts` together, or the screen and the
   * server will disagree — which is precisely what happened the first time this file
   * was written, and what `verify-fasa1-charge.sh` caught. */
  /* HQ only, and it now comes from ONE place. This was an inline `role === "hq"` here
   * and an inline `["hq"].includes(...)` there; a role rule written out twice is a role
   * rule that will disagree with itself. `canWriteFinance` mirrors `finance:create`. */
  const mayCharge = canWriteFinance(user?.role);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [costDate, setCostDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [createdFor, setCreatedFor] = useState<string | null>(null);

  /* The catalog, so a treatment that ALREADY has a price prefills it. A dentist's
   * plan names the treatment; if pricing exists it should travel with the name
   * rather than be retyped (and mistyped). */
  const catalog = useQuery({
    queryKey: ["clinical", "treatments"],
    queryFn: () => api.get<CatalogTreatment[]>("/clinical/treatments"),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  /* ITEMS COME FROM THE DETAIL ENDPOINT, FETCHED HERE.
   *
   * The `items` prop arrives from the plan LIST, and the list endpoint does not return
   * items at all — so a dialog that trusted the prop would open with "This plan has no
   * items to charge yet" on a plan that plainly has items on screen behind it. That is
   * exactly what happened the first time this screen was exercised in a browser.
   *
   * Fetching here rather than lifting state out of the panel keeps ONE source of truth:
   * `GET /clinical/plans/:id` is where items live, so the dialog asks for them directly.
   * The prop remains as a fallback for callers that already hold the detail. */
  const detail = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => api.get<{ plan: TreatmentPlan; items: PlanItem[] }>(`/clinical/plans/${planId}`),
    enabled: open && !!planId,
    staleTime: 30_000,
  });
  const planItems: PlanItem[] = detail.data?.items ?? items;

  /* What is ALREADY charged on this plan. The API cannot tell us which plan ITEM a
   * cost came from — `treatment_costs` has no `plan_item_id` — so this is shown as
   * information, not used to auto-disable rows. Claiming a duplicate-proof check
   * we cannot perform would be worse than showing the operator what exists. */
  const existing = useQuery({
    queryKey: ["finance", "treatment-costs", "plan", planId],
    queryFn: () => api.get<ExistingCost[]>(`/finance/treatment-costs?planId=${planId}`),
    enabled: open && mayCharge,
    retry: false,
  });

  /* Build the rows once per plan. Prefill each unit price from the catalog where
   * the item carries a treatmentId. */
  const priceOf = new Map((catalog.data ?? []).map((c) => [c.id, c.price]));
  if (open && createdFor !== planId) {
    setCreatedFor(planId);
    setRows(planItems.map((item) => ({
      item,
      checked: false,
      quantity: String(item.quantity && item.quantity > 0 ? item.quantity : 1),
      unit: item.treatmentId ? senToRinggit(priceOf.get(item.treatmentId)) : "",
    })));
    setCostDate(today());
    setNotes("");
  }
  if (!open && createdFor !== null) setCreatedFor(null);

  const list = rows ?? [];

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows(list.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));

  const chosen = list.filter((r) => r.checked);
  /* Rows the operator ticked but left unpriceable. Blocking on these rather than
   * silently posting RM0.00 for them — an unpriced line on a bill is a dispute. */
  const blocked = chosen.filter((r) => toAmount(r.unit) === null);

  const total = chosen.reduce((sum, r) => {
    const u = toAmount(r.unit);
    const q = Number(r.quantity);
    if (u === null || !Number.isFinite(q) || q <= 0) return sum;
    return sum + Number(u) * q;
  }, 0);

  const save = useMutation({
    mutationFn: async () => {
      /* THE BRANCH IS THE PLAN'S BRANCH, NOT THE OPERATOR'S.
       *
       * HQ has `branchId: null` — there is no "HQ branch". Sending the operator's branch
       * therefore sent `null`, and the API refused with 422 "Expected string, received
       * null". Every HQ charge failed, silently, with the generic "could not charge"
       * toast: the one role that is ALLOWED to charge could not.
       *
       * The plan already knows its branch, so read it from there. This also makes the
       * charge land in the right branch even when HQ has a DIFFERENT branch selected in
       * the switcher — a plan belongs to one branch and the money belongs with it. */
      const chargeBranchId =
        detail.data?.plan?.branchId ?? patientBranchId ?? activeBranchId ?? user?.branchId ?? null;
      const results: string[] = [];
      for (const r of chosen) {
        const unit = toAmount(r.unit);
        if (unit === null) continue;
        try {
          await api.post("/finance/treatment-costs", {
            branchId: chargeBranchId,
            patientId,
            planId,
            encounterId: encounterId ?? null,
            treatmentId: r.item.treatmentId ?? null,
            description: r.item.description,
            quantity: Number(r.quantity),
            unitCost: unit,
            costDate,
            notes: notes.trim() || null,
          });
          results.push(r.item.id);
        } catch (e) {
          /* Stop at the first failure and report which rows DID land. Continuing
           * would leave the operator unsure how much of the bill exists. */
          throw { e, done: results.length, failedOn: r.item.description };
        }
      }
      return results.length;
    },
    onSuccess: (n: number) => {
      toast.success(t("charge.saved").replace("{n}", String(n)));
      qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (err: unknown) => {
      const wrapped = err as { e?: unknown; done?: number; failedOn?: string };
      if (typeof wrapped?.done === "number") {
        toast.error(t("charge.partial")
          .replace("{n}", String(wrapped.done))
          .replace("{item}", String(wrapped.failedOn ?? "")));
      } else {
        toast.error(errorMessage(err, t("charge.saveFailed")));
      }
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const money = (r: Row, key: "unit" | "quantity", label: string) => (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      <Input
        type="text"
        inputMode="decimal"
        value={r[key]}
        onChange={(e) => setRow(r.item.id, { [key]: e.target.value } as Partial<Row>)}
        className="h-8 rounded-lg border-border bg-background px-2 text-sm"
      />
    </div>
  );

  const existingList = existing.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card max-h-[90vh] max-w-2xl overflow-y-auto rounded-lg border-0 bg-card shadow-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Receipt className="h-4 w-4" />
            {t("charge.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {mayCharge
              ? t("charge.hint").replace("{plan}", planTitle ?? "").replace("{patient}", patientName ?? "")
              : t("charge.onlyHq")}
          </DialogDescription>
        </DialogHeader>

        {/* What is already on this plan's bill, stated before anything is added. */}
        {existingList.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
              {t("charge.already")}
            </p>
            <ul className="space-y-0.5">
              {existingList.map((c) => (
                <li key={c.id} className="flex justify-between text-xs text-foreground">
                  <span>{c.description}</span>
                  <span className="font-mono">
                    RM{Number(c.totalCost ?? 0).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- items ---- */}
        {/* "No items" must not be said while the items are still in flight, a false
            "nothing to charge" on a plan that has items is what the browser test caught. */}
        {detail.isLoading && list.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("charge.loading")}
          </p>
        ) : list.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("charge.noItems")}
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {list.map((r) => (
              <div key={r.item.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex flex-1 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      disabled={!mayCharge}
                      onChange={(e) => setRow(r.item.id, { checked: e.target.checked })}
                      className="h-4 w-4 shrink-0 rounded border-border"
                    />
                    <span className="text-sm text-foreground">{r.item.description}</span>
                    {r.item.toothFdi != null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {r.item.toothFdi}
                      </span>
                    )}
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.item.treatmentId && !priceOf.get(r.item.treatmentId)
                      ? t("charge.noCatalogPrice")
                      : ""}
                  </span>
                </div>
                {r.checked && (
                  <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                    {money(r, "quantity", t("charge.quantity"))}
                    {money(r, "unit", t("charge.unitCost"))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ---- date + notes ---- */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("charge.date")}</Label>
            <Input
              type="date"
              value={costDate}
              onChange={(e) => setCostDate(e.target.value)}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("charge.notes")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={1}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* ---- blocking reasons, stated BEFORE the button is pressed ---- */}
        {blocked.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("charge.needPrice").replace("{n}", String(blocked.length))}
          </p>
        )}

        {/* ---- total + actions ---- */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div>
            <p className="text-[11px] text-muted-foreground">{t("charge.total")}</p>
            <p className="font-mono text-lg font-bold text-foreground">
              RM{total.toFixed(2)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}
              className="rounded-xl border-border text-foreground hover:bg-muted">
              {t("btn.close")}
            </Button>
            {/* Shown only to a role that may charge. A disabled control would read as
                "you could, if…"; the sentence in the header says who can. */}
            {mayCharge && (
              <Button
                type="button"
                className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={save.isPending || chosen.length === 0 || blocked.length > 0}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? t("charge.saving")
                  : t("charge.submit").replace("{n}", String(chosen.length))}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
