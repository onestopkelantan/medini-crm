import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { useScope } from "@/hooks/useScope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* ============================================================================
 * AddTreatmentDialog — rekod rawatan yang DILAKUKAN pada pesakit (8 Okt 2026).
 *
 * MENGAPA DIALOG INI WUJUD
 *   Tab Treatments hanya memaparkan KATALOG. Pengguna bertanya "gbisa tambah
 *   treatment kh di clinical itu" — alur DentalERP ialah New Treatment:
 *   pilih pesakit, prosedur, gigi, kos. Di Medini, satu "rawatan dilakukan"
 *   terdiri daripada tiga rekod berangkai yang SEDIA ADA di backend:
 *
 *     (1) `POST /clinical/plans` + item   — pelan 1-item status draft
 *     (2) `POST /finance/treatment-costs` — kos bagi pesakit (boleh dibil)
 *
 *   Dialog ini menjahit kedua-dua panggilan menjadi SATU tindakan pengguna.
 *   Ia tidak mencipta endpoint baharu: semuanya laluan sah sedia ada.
 *
 * PERANAN (ikut matriks sedia ada):
 *   - Doktor: tulis klinikal sendiri (assertDoctor plans).
 *   - HQ: menulis ATAS NAMA doktor dipilih (doctorId) — kosakata yang sama
 *     dengan preskripsi/sesi.
 *   - Kos (treatment-costs) hanya HQ/manager sahaja boleh — oleh itu dialog
 *     ini meminta kuantiti & kos, dan bahagian kos dihantar hanya oleh peranan
 *     yang dibenarkan; doktor mendapat pelan sahaja + nota jujur.
 * ========================================================================== */

interface PatientRow { id: string; mrn: string; name: string; branchId?: string }
interface CatalogRow {
  id: string; code?: string; name: string; category?: string | null;
  durationMin?: number | null; price?: number | string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /* Rawatan katalog yang dipratetapkan bila dibuka dari baris jadual. */
  presetTreatment?: CatalogRow | null;
  /* Pesakit sesi aktif (jika ada) — pratetap pemilih pesakit. */
  presetPatientId?: string | null;
}

export function AddTreatmentDialog({ open, onClose, presetTreatment, presetPatientId }: Props) {
  const { t } = usePrefs();
  const { user } = useAuth();
  const scope = useScope();
  const qc = useQueryClient();
  const isHQ = user?.role === "hq";
  const canCharge = user?.role === "hq" || user?.role === "branch_manager";

  const [patientId, setPatientId] = useState(presetPatientId ?? "");
  const [doctorId, setDoctorId] = useState("");
  const [treatmentId, setTreatmentId] = useState(presetTreatment?.id ?? "");
  const [toothFdi, setToothFdi] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState(presetTreatment?.price != null ? String(Number(presetTreatment.price) / 100) : "");
  const [notes, setNotes] = useState("");

  const patients = useQuery({
    queryKey: ["patients", "for-add-treatment"],
    queryFn: () => api.get<PatientRow[]>("/patients?limit=200"),
    enabled: open,
    staleTime: 60_000,
  });
  const catalog = useQuery({
    queryKey: ["clinical", "treatments"],
    queryFn: () => api.get<CatalogRow[]>("/clinical/treatments"),
    enabled: open,
  });
  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: () => api.get<Array<{ id: string; name: string }>>("/admin/staff?role=doctor"),
    enabled: open && isHQ,
  });

  const chosenTreatment = useMemo(
    () => (catalog.data ?? []).find((c) => c.id === treatmentId) ?? null,
    [catalog.data, treatmentId],
  );
  /* Pratetap kos dr harga katalog bila rawatan ditukar. */
  const effectiveCost = unitCost || (chosenTreatment?.price != null ? String(Number(chosenTreatment.price) / 100) : "");
  const patient = (patients.data ?? []).find((p) => p.id === patientId) ?? null;
  /* Cawangan kos = cawangan pesakit (bukan operator) — pelajaran HQ-branch
   * dari ChargeFromPlanDialog: HQ tiada branch, jadi null = 422 senyap. */
  const chargeBranchId = patient?.branchId ?? scope.branchId ?? null;

  const save = useMutation({
    mutationFn: async () => {
      /* (1) Pelan 1-item — peranan doktor/HQ(+doctorId) dikuatkuasakan backend. */
      const plan = await api.post<{ plan: { id: string; planCode?: string; branchId: string } }>("/clinical/plans", {
        patientId,
        title: chosenTreatment?.name ?? "Treatment",
        items: [{
          treatmentId,
          description: chosenTreatment?.name ?? "Treatment",
          toothFdi: toothFdi ? Number(toothFdi) : null,
          quantity: Number(quantity) || 1,
        }],
        /* HQ menulis atas nama doktor; doktor tidak hantar (backend guna identiti sendiri). */
        ...(isHQ ? { doctorId: doctorId || null } : {}),
      });

      /* (2) Kos — hanya HQ/manager (matriks finance:create). Doktor berhenti di sini. */
      if (canCharge && effectiveCost) {
        await api.post("/finance/treatment-costs", {
          branchId: chargeBranchId,
          patientId,
          planId: plan.plan.id,
          treatmentId,
          description: chosenTreatment?.name ?? "Treatment",
          quantity: Number(quantity) || 1,
          unitCost: String(effectiveCost),
          costDate: new Date().toISOString().slice(0, 10),
          notes: notes.trim() || null,
          ...(isHQ && doctorId ? { doctorId } : {}),
        });
      }
      return plan.plan;
    },
    onSuccess: (plan) => {
      toast.success(t("clinical.addTreatDone", { code: plan.planCode ?? "" }));
      qc.invalidateQueries({ queryKey: ["clinical"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
      reset();
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.addTreatFailed"))),
  });

  const reset = () => {
    setPatientId(presetPatientId ?? "");
    setDoctorId("");
    setTreatmentId(presetTreatment?.id ?? "");
    setToothFdi(""); setQuantity("1");
    setUnitCost(presetTreatment?.price != null ? String(Number(presetTreatment.price) / 100) : "");
    setNotes("");
  };

  const valid = patientId && treatmentId && (!isHQ || doctorId);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("clinical.addTreatment")}</DialogTitle>
          <DialogDescription>{t("clinical.addTreatDesc")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}
        >
          {/* HQ: atas nama doktor (pola yang sama dgn sesi/preskripsi) */}
          {isHQ && (
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("clinical.onBehalfDoctor")} *</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger className="w-full rounded-xl border-border bg-background px-4 py-2.5 text-sm">
                  <SelectValue placeholder={t("clinical.pickDoctor")} />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  {!(doctors.data ?? []).length && <SelectItem value="__none" disabled>{t("clinical.noDoctors")}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("clinical.patient")} *</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger className="w-full rounded-xl border-border bg-background px-4 py-2.5 text-sm">
                <SelectValue placeholder={t("clinical.pickPatient")} />
              </SelectTrigger>
              <SelectContent>
                {(patients.data ?? []).slice(0, 100).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.mrn})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("clinical.treatment")} *</Label>
            <Select value={treatmentId} onValueChange={(v) => { setTreatmentId(v); const c = (catalog.data ?? []).find((x) => x.id === v); setUnitCost(c?.price != null ? String(Number(c.price) / 100) : ""); }}>
              <SelectTrigger className="w-full rounded-xl border-border bg-background px-4 py-2.5 text-sm">
                <SelectValue placeholder={t("clinical.pickTreatment")} />
              </SelectTrigger>
              <SelectContent>
                {(catalog.data ?? []).filter((c) => c.id).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.code ? `${c.code} · ` : ""}{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("clinical.toothFdi")}</Label>
              <Input type="number" min={11} max={48} value={toothFdi} onChange={(e) => setToothFdi(e.target.value)} placeholder="46" className="rounded-xl border-border bg-background px-4 py-2.5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("clinical.qty")}</Label>
              <Input type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="rounded-xl border-border bg-background px-4 py-2.5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("clinical.unitCost")}</Label>
              <Input type="number" step="0.01" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" className="rounded-xl border-border bg-background px-4 py-2.5" disabled={!canCharge} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("clinical.colNotes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("clinical.notesPh")} className="rounded-xl border-border bg-background px-4 py-2.5" />
          </div>

          {!canCharge && (
            <p className="text-xs text-muted-foreground">{t("clinical.addTreatDoctorNote")}</p>
          )}
          {canCharge && !effectiveCost && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("clinical.addTreatNoPrice")}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }} className="rounded-xl border-border text-foreground hover:bg-muted">{t("btn.cancel")}</Button>
            <Button type="submit" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={save.isPending || !valid}>
              {save.isPending ? t("common.loading") : t("clinical.addTreatment")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
