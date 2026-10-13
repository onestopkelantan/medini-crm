/**
 * AllergyPanel + AllergyBanner (Fasa 1C).
 *
 * TWO COMPONENTS, TWO JOBS, AND THE SPLIT IS THE DESIGN
 *
 *   `AllergyBanner`  — one line, no controls, ALWAYS AT THE TOP OF THE PATIENT
 *                      RECORD. It exists to be seen without being looked for.
 *   `AllergyPanel`   — the full list with add and retire, inside a tab where a
 *                      clinician has deliberately navigated.
 *
 * The banner is not a summary of the panel; it is the safety surface. A clinician
 * opening a patient to book an appointment must not have to open a tab to learn the
 * patient is anaphylactic. That is why the banner has NO interaction — a widget you
 * can click is a widget you can dismiss in your head.
 *
 * `unknown` SEVERITY IS RENDERED AMBER, NOT GREEN. The domain ranks an unassessed
 * allergy above mild because nobody established how bad it is. Green would say the
 * opposite, and colour is what gets read first.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { fmtShortDate } from "@/lib/dateFormat";
import { AlertTriangle, Plus, ShieldAlert, History } from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------- types */

export type AllergySeverity = "mild" | "moderate" | "unknown" | "severe" | "life_threatening";
export type AllergyCategory = "drug" | "food" | "material" | "environmental" | "other";

export interface ActiveAllergy {
  id: string; allergen: string; severity: AllergySeverity; reaction: string | null;
}
export interface RetiredAllergy {
  id: string; allergen: string; severity: AllergySeverity; reaction: string | null;
  retiredAt: string | null; retiredReason: string | null;
}
export interface AllergyPayload {
  patientId: string;
  active: ActiveAllergy[];
  retired: RetiredAllergy[];
  blocking: ActiveAllergy[];
}

/* ------------------------------------------------------------- appearance */

/**
 * Colour PER SEVERITY. Ordered worst-first so a reader scanning the list meets the
 * dangerous ones at the top, and `unknown` sits with the serious ones rather than
 * with mild — see the file header.
 */
const SEV_STYLE: Record<AllergySeverity, { chip: string; dot: string; badge: string }> = {
  life_threatening: { chip: "bg-red-100 text-red-800 border-red-300", dot: "bg-red-600", badge: "bg-red-600 text-white" },
  severe:           { chip: "bg-red-50 text-red-700 border-red-200",  dot: "bg-red-500", badge: "bg-red-500 text-white" },
  unknown:          { chip: "bg-amber-50 text-amber-800 border-amber-300", dot: "bg-amber-500", badge: "bg-amber-500 text-white" },
  moderate:         { chip: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500", badge: "bg-orange-500 text-white" },
  mild:             { chip: "bg-muted text-muted-foreground border-border", dot: "bg-slate-400", badge: "bg-muted/500 text-white" },
};

const ORDER: AllergySeverity[] = ["life_threatening", "severe", "unknown", "moderate", "mild"];

/* ----------------------------------------------------------------- banner */

/**
 * The safety banner. Rendered on the patient record whether or not the allergy tab
 * has ever been opened.
 *
 * Returns `null` for a patient with NO blocking allergy — deliberately, so it costs
 * nothing on the common case and does not become wallpaper. The moment it appears
 * it means something.
 */
export function AllergyBanner({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["allergies", patientId],
    queryFn: () => api.get<AllergyPayload>(`/clinical/patients/${patientId}/allergies`),
    enabled: !!patientId,
    staleTime: 30_000,
  });

  const blocking = q.data?.blocking ?? [];
  if (q.isLoading || blocking.length === 0) return null;

  const worst = blocking[0]!;
  const style = SEV_STYLE[worst.severity];

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border p-3.5 ${style.chip}`}
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-bold">
          {t("allergy.bannerTitle")}, {blocking.length}
        </p>
        <p className="mt-0.5 text-sm">
          {blocking.map((a) => (
            <span key={a.id} className="mr-2 inline-block font-semibold">
              {a.allergen}
              <span className="ml-1 font-normal opacity-80">
                ({t(`sev.${a.severity}`)}{a.reaction ? ` · ${a.reaction}` : ""})
              </span>
            </span>
          ))}
        </p>
        <p className="mt-1 text-xs opacity-80">{t("allergy.bannerHint")}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

export default function AllergyPanel({ patientId, canEdit }: { patientId: string; canEdit?: boolean }) {
  const { t, lang } = usePrefs();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [retiring, setRetiring] = useState<ActiveAllergy | null>(null);

  const q = useQuery({
    queryKey: ["allergies", patientId],
    queryFn: () => api.get<AllergyPayload>(`/clinical/patients/${patientId}/allergies`),
    enabled: !!patientId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["allergies", patientId] });

  const create = useMutation({
    mutationFn: (body: { allergen: string; severity: string; category: string; reaction: string | null }) =>
      api.post(`/clinical/patients/${patientId}/allergies`, body),
    onSuccess: () => { invalidate(); setAdding(false); toast.success(t("allergy.saved")); },
    onError: () => toast.error(t("allergy.saveFailed")),
  });

  const retire = useMutation({
    mutationFn: (body: { id: string; reason: string }) =>
      api.post(`/clinical/allergies/${body.id}/retire`, { reason: body.reason }),
    onSuccess: () => { invalidate(); setRetiring(null); toast.success(t("allergy.retired")); },
    onError: () => toast.error(t("allergy.retireFailed")),
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;

  const data = q.data;
  const active = data?.active ?? [];
  const retired = data?.retired ?? [];
  const blockingIds = new Set((data?.blocking ?? []).map((b) => b.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-foreground">{active.length}</span>
          <span className="text-muted-foreground">{t("allergy.activeCount")}</span>
          {blockingIds.size > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              <AlertTriangle className="h-3 w-3" />
              {blockingIds.size} {t("allergy.requireAck")}
            </span>
          )}
        </div>
        {canEdit && (
          <Button size="sm" className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("allergy.add")}
          </Button>
        )}
      </div>

      {/* ---- active ---- */}
      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
          <p className="text-sm font-medium text-foreground">{t("allergy.none")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("allergy.noneHint")}</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {active.map((a) => {
            const style = SEV_STYLE[a.severity];
            const blocks = blockingIds.has(a.id);
            return (
              <div key={a.id} className="flex items-start justify-between gap-3 p-3.5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {a.allergen}
                      {blocks && <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-red-600" />}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className={`mr-1.5 rounded px-1.5 py-0.5 font-semibold uppercase ${style.badge}`}>
                        {t(`sev.${a.severity}`)}
                      </span>
                      {a.reaction ?? t("allergy.noReaction")}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <Button
                    size="sm" variant="outline"
                    className="shrink-0 rounded-lg text-xs"
                    onClick={() => setRetiring(a)}
                  >
                    {t("allergy.retire")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- retired ---- */}
      {retired.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <History className="h-3 w-3" /> {t("allergy.retiredTitle")}
          </p>
          <div className="divide-y divide-border">
            {retired.map((r) => (
              <div key={r.id} className="py-2 first:pt-0 last:pb-0">
                <p className="text-sm text-muted-foreground line-through">{r.allergen}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(`sev.${r.severity}`)}
                  {r.retiredAt ? ` · ${fmtShortDate(lang, r.retiredAt)}` : ""}
                  {r.retiredReason ? ` · ${r.retiredReason}` : ""}
                </p>
              </div>
            ))}
          </div>
          {/* Why a retired allergy stays visible, stated where a reader will see it. */}
          <p className="mt-2 text-[11px] text-muted-foreground">{t("allergy.retiredNote")}</p>
        </div>
      )}

      {/* ---- add dialog ---- */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("allergy.add")}</DialogTitle>
            <DialogDescription>{t("allergy.addHint")}</DialogDescription>
          </DialogHeader>
          <AddAllergyForm
            saving={create.isPending}
            onSubmit={(body) => create.mutate(body)}
            t={t}
          />
        </DialogContent>
      </Dialog>

      {/* ---- retire dialog ---- */}
      <Dialog open={!!retiring} onOpenChange={(o) => !o && setRetiring(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("allergy.retireTitle")}</DialogTitle>
            {/* The reason is REQUIRED by the domain: an allergy that vanished
                without an answer is indistinguishable from one deleted by mistake. */}
            <DialogDescription>{t("allergy.retireHint")}</DialogDescription>
          </DialogHeader>
          <RetireForm
            allergen={retiring?.allergen ?? ""}
            saving={retire.isPending}
            onSubmit={(reason) => retiring && retire.mutate({ id: retiring.id, reason })}
            t={t}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

function AddAllergyForm({
  saving, onSubmit, t,
}: {
  saving: boolean;
  t: (k: string) => string;
  onSubmit: (b: { allergen: string; severity: string; category: string; reaction: string | null }) => void;
}) {
  const [allergen, setAllergen] = useState("");
  const [severity, setSeverity] = useState<AllergySeverity>("moderate");
  const [category, setCategory] = useState<AllergyCategory>("drug");
  const [reaction, setReaction] = useState("");

  /* Mirrors the server rule in `validateAllergyDraft` so the form refuses before a
   * round trip — but the SERVER stays the authority, because a client check is a
   * convenience, not a control. */
  const needsReaction = severity === "life_threatening" && reaction.trim().length === 0;
  const tooShort = allergen.trim().length < 2;
  const blocked = saving || tooShort || needsReaction;

  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <Label htmlFor="allergen">{t("allergy.fieldAllergen")}</Label>
          <Input
            id="allergen" value={allergen} onChange={(e) => setAllergen(e.target.value)}
            placeholder={t("allergy.fieldAllergenPh")} className="mt-1.5"
          />
          {tooShort && allergen.length > 0 && (
            <p className="mt-1 text-xs text-red-600">{t("allergy.errAllergen")}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block">{t("allergy.fieldSeverity")}</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as AllergySeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER.map((s) => (
                  <SelectItem key={s} value={s}>{t(`sev.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block">{t("allergy.fieldCategory")}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as AllergyCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["drug", "food", "material", "environmental", "other"] as const).map((c) => (
                  <SelectItem key={c} value={c}>{t(`cat.${c}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="reaction">{t("allergy.fieldReaction")}</Label>
          <Textarea
            id="reaction" value={reaction} onChange={(e) => setReaction(e.target.value)}
            placeholder={t("allergy.fieldReactionPh")} rows={2} className="mt-1.5"
          />
          {needsReaction && (
            <p className="mt-1 text-xs text-red-600">{t("allergy.errReaction")}</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button
          size="sm" disabled={blocked}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit({ allergen: allergen.trim(), severity, category, reaction: reaction.trim() || null })}
        >
          {saving ? "…" : t("allergy.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function RetireForm({
  allergen, saving, onSubmit, t,
}: {
  allergen: string; saving: boolean; t: (k: string) => string; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const tooShort = reason.trim().length < 3;

  return (
    <>
      <div className="space-y-3 py-2">
        <p className="text-sm font-medium text-foreground">{allergen}</p>
        <div>
          <Label htmlFor="reason">{t("allergy.fieldReason")}</Label>
          <Textarea
            id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t("allergy.fieldReasonPh")} rows={3} className="mt-1.5"
          />
          {reason.length > 0 && tooShort && (
            <p className="mt-1 text-xs text-red-600">{t("allergy.errReason")}</p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button
          size="sm" disabled={saving || tooShort}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit(reason.trim())}
        >
          {saving ? "…" : t("allergy.retire")}
        </Button>
      </DialogFooter>
    </>
  );
}
