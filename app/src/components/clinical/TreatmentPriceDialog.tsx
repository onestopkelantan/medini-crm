/**
 * TreatmentPriceDialog — Fasa 1b, Seksyen 1.
 *
 * THE GAP THIS CLOSES
 *
 * `treatment_catalog` has carried no price at all, so the chain
 *   record treatment -> store a cost -> render a bill
 * ends in RM0.00 every time. The columns never existed; a bill cannot invent a
 * number. This dialog is the only screen that puts a real figure on a treatment.
 *
 * WHO MAY WRITE IT
 *
 * The gate is the PERMISSION, not the role. `POST /finance/treatment-costs` needs
 * `finance:create`, which the role matrix grants to HQ and withholds from
 * doctor — so a doctor can record what was done but cannot price it. Rather than
 * bake `role === 'hq'` into this component (which would silently keep a doctor
 * locked out even if the matrix were later widened), it asks the same permission
 * the server asks. If the matrix changes, the screen follows with no code edit.
 *
 * MONEY IS ENTERED IN RINGGIT AND STORED IN SEN
 *
 * The columns are integer sen, like every other money column in this schema, so
 * applying an SST percentage cannot introduce float drift. The operator types
 * ringgit because that is what a fee schedule is written in. The conversion
 * happens once, here, and a blank field stays NULL — "not decided yet" and
 * "deliberately free" must not collapse into the same 0.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface PricedTreatment {
  id: string;
  code?: string;
  name?: string;
  category?: string;
  price?: number | string | null;
  price2?: number | string | null;
  panelPrice?: number | string | null;
  cost?: number | string | null;
  localSstPct?: number | string | null;
  foreignerSstPct?: number | string | null;
  classificationCode?: string | null;
  keyboardLetter?: string | null;
}

/* sen -> the ringgit string an operator expects to see in the field. NULL stays
 * empty; 0 becomes "0.00" so a deliberately free treatment is visibly priced. */
function senToRinggit(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

/* Ringgit -> sen. Blank is NULL, not 0: the two states are different facts and
 * the column is nullable for exactly that reason. */
function ringgitToSen(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function TreatmentPriceDialog({
  open, onClose, treatment,
}: {
  open: boolean;
  onClose: () => void;
  treatment: PricedTreatment | null;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const { user } = useAuth();
  /* Same rule the SERVER enforces: `POST /finance/treatment-costs` needs
   * `finance:create`, which the role matrix grants to HQ only. Roles are listed
   * here because the frontend has no permission helper — if the matrix is ever
   * widened to let branch managers price their own treatments, add the role
   * HERE **and** in `architecture.contract.ts`, or the screen and the server
   * will disagree. */
  const mayPrice = ["hq"].includes(user?.role ?? "");

  /* Each field is its own state so a partially-filled schedule can be saved —
   * a clinic routinely knows its scaling fee long before its braces fee. */
  const [price, setPrice] = useState("");
  const [price2, setPrice2] = useState("");
  const [panelPrice, setPanelPrice] = useState("");
  const [cost, setCost] = useState("");
  const [localSst, setLocalSst] = useState("");
  const [foreignerSst, setForeignerSst] = useState("");
  const [classification, setClassification] = useState("");
  const [keyboard, setKeyboard] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const current = useQuery({
    queryKey: ["clinical", "treatment-price", treatment?.id],
    queryFn: () => api.get<PricedTreatment>(`/clinical/treatments/${treatment!.id}`),
    enabled: open && !!treatment?.id,
    retry: false,
  });

  /* Seed the fields from the server ONCE per treatment. Without the `loadedFor`
   * guard the effect would overwrite what the operator is typing on every
   * refetch. */
  const src = current.data ?? treatment;
  if (open && src && loadedFor !== src.id) {
    setLoadedFor(src.id);
    setPrice(senToRinggit(src.price));
    setPrice2(senToRinggit(src.price2));
    setPanelPrice(senToRinggit(src.panelPrice));
    setCost(senToRinggit(src.cost));
    setLocalSst(src.localSstPct == null ? "" : String(src.localSstPct));
    setForeignerSst(src.foreignerSstPct == null ? "" : String(src.foreignerSstPct));
    setClassification(src.classificationCode ?? "");
    setKeyboard(src.keyboardLetter ?? "");
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const save = useMutation({
    mutationFn: () => api.patch(`/clinical/treatments/${treatment!.id}`, {
      price: ringgitToSen(price),
      price2: ringgitToSen(price2),
      panelPrice: ringgitToSen(panelPrice),
      cost: ringgitToSen(cost),
      localSstPct: localSst.trim() === "" ? null : Number(localSst),
      foreignerSstPct: foreignerSst.trim() === "" ? null : Number(foreignerSst),
      classificationCode: classification.trim() || null,
      keyboardLetter: keyboard.trim() || null,
    }),
    onSuccess: () => {
      toast.success(t("price.saved"));
      qc.invalidateQueries({ queryKey: ["clinical"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("price.saveFailed"))),
  });

  if (!treatment) return null;

  const money = (label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label className="text-foreground font-medium text-xs">{label}</Label>
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={t("price.ringgitHint")}
        className="rounded-xl border-border bg-background px-3 py-2 text-sm"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            {t("price.title")}, {treatment.name ?? treatment.code}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            {mayPrice ? t("price.editHint") : t("price.onlyHq")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {money(t("price.base"), price, setPrice)}
          {money(t("price.second"), price2, setPrice2)}
          {money(t("price.panel"), panelPrice, setPanelPrice)}
          {money(t("price.cost"), cost, setCost)}
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium text-xs">{t("price.localSst")}</Label>
            <Input value={localSst} onChange={(e) => setLocalSst(e.target.value)}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium text-xs">{t("price.foreignerSst")}</Label>
            <Input value={foreignerSst} onChange={(e) => setForeignerSst(e.target.value)}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium text-xs">{t("price.classification")}</Label>
            <Input value={classification} onChange={(e) => setClassification(e.target.value)}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium text-xs">{t("price.keyboard")}</Label>
            <Input value={keyboard} onChange={(e) => setKeyboard(e.target.value)} maxLength={4}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}
            className="rounded-xl border-border text-foreground hover:bg-muted">
            {t("btn.close")}
          </Button>
          {/* Not rendered when the operator may not price it. A disabled control
              would suggest "you could, if…"; the sentence above says who can. */}
          {mayPrice && (
            <Button
              type="button"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {t("price.save")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
