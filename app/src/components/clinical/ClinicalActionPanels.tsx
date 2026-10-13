/* ============================================================================
 * ClinicalActionPanels — tiga tindakan klinikal yang sebelum ini TIADA UI.
 *
 * MASALAH YANG DIBETULKAN
 *
 * Halaman `/clinical` memaparkan senarai preskripsi, kesan buruk dan rujukan, tetapi
 * TIADA butang untuk menambahnya. Backend lengkap (POST /clinical/prescriptions,
 * /adverse-events, /referrals, PATCH /referrals/:id/status) — UI sahaja yang hilang.
 * Akibatnya tiga item Fasa 1 ("Preskripsi", "Rujukan", "Insiden") separuh siap: doktor
 * nampak tab kosong dan tiada cara mengisinya.
 *
 * KEPUTUSAN REKA BENTUK
 *
 * 1. Setiap tindakan berpaut pada SATU sesi rawatan (encounter) yang sedang dibuka.
 *    Ini bukan sekatan teknikal semata-mata: preskripsi dan kesan buruk hanya bermakna
 *    dalam konteks lawatan tertentu, dan backend juga mengesahkan `encounterId` milik
 *    doktor yang sama. Jadi butang dilumpuhkan sehingga doktor membuka sesi.
 *
 * 2. `branchId` + `doctorId` dihantar dalam body. Guard `scope: 'own'` bersifat
 *    fail-closed — ia mengisi `doctorId` sendiri untuk `view` sahaja, TIDAK untuk
 *    `create`. Ini pernah menyebabkan tiga bug 403 yang menyalahkan peranan doktor
 *    (1D, 1E, 1G), jadi ia dihantar secara eksplisit di sini.
 *
 * 3. Tiada warna keras: semuanya guna token tema supaya tema gelap kekal boleh dibaca.
 * ========================================================================== */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useScope } from "@/hooks/useScope";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/** Sesi rawatan yang sedang dibuka — sumber patientId dan encounterId. */
export interface EncounterRef {
  id: string;
  patientId?: string;
  patient_id?: string;
  patientName?: string;
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  encounter: EncounterRef | null;
}

const field =
  "rounded-xl border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground";

/** Buka/tutup dialog + bantu dua medan berulang. */
function Shell({
  open,
  onClose,
  title,
  hint,
  children,
  onSubmit,
  pending,
  submitLabel,
  submitDisabled,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  children: React.ReactNode;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
}) {
  const { t } = usePrefs();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-lg border border-border bg-card shadow-sm max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{hint}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">
              {t("btn.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={pending || submitDisabled}
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? t("clinical.saving") : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Kotak amaran bila doktor belum membuka sesi rawatan. */
function NeedEncounter() {
  const { t } = usePrefs();
  return (
    <p className="rounded-xl border border-border bg-accent p-3 text-xs text-accent-foreground">
      {t("clinical.needEncounter")}
    </p>
  );
}

/* ------------------------------------------------------------------------- *
 * 1. Preskripsi
 *
 * Nama ubat WAJIB (min 2 aksara). Dos/kekerapan/tempoh pilihan kerana doktor
 * kadangkala menulis arahan penuh dalam nota, dan memaksa medan kosong hanya
 * menghasilkan "TIDAK DINYATAKAN" dalam rekod.
 * ------------------------------------------------------------------------- */
export function PrescriptionDialog({ open, onClose, encounter }: DialogProps) {
  const { t } = usePrefs();
  const { user } = useAuth();
  const scope = useScope();
  const qc = useQueryClient();
  const isHQ = user?.role === "hq";
  /* HQ menulis preskripsi ATAS NAMA doktor (owner direction): pilihan doktor
   * eksplisit diperlukan — backend menolak HQ tanpa doctorId. */
  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: () => api.get<Array<{ id: string; name: string }>>("/admin/staff?role=doctor"),
    enabled: open && isHQ,
  });
  const [doctorId, setDoctorId] = useState("");
  const [medication, setMedication] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.post("/clinical/prescriptions", {
        ...scope,
        ...(isHQ ? { doctorId: doctorId || null } : {}),
        patientId: encounter?.patientId ?? encounter?.patient_id,
        encounterId: encounter?.id ?? null,
        medication,
        dosage: dosage || null,
        frequency: frequency || null,
        durationDays: durationDays ? Number(durationDays) : null,
        notes: notes || null,
      }),
    onSuccess: () => {
      toast.success(t("clinical.rxSaved"));
      qc.invalidateQueries({ queryKey: ["clinical"] });
      setMedication(""); setDosage(""); setFrequency(""); setDurationDays(""); setNotes("");
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.saveFailed"))),
  });

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t("clinical.addPrescription")}
      hint={encounter?.patientName ?? t("clinical.noPatient")}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      submitLabel={t("clinical.save")}
      submitDisabled={medication.trim().length < 2 || !encounter || (isHQ && !doctorId)}
    >
      {!encounter && <NeedEncounter />}
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
        <Label className="text-foreground font-medium">{t("clinical.medication")} *</Label>
        <Input required minLength={2} value={medication} onChange={(e) => setMedication(e.target.value)} placeholder={t("clinical.medicationPh")} className={field} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-foreground font-medium">{t("clinical.dosage")}</Label>
          <Input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder={t("clinical.dosagePh")} className={field} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-foreground font-medium">{t("clinical.frequency")}</Label>
          <Input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder={t("clinical.frequencyPh")} className={field} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.durationDays")}</Label>
        <Input type="number" min={1} max={365} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="5" className={field} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.notes")}</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} />
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------------- *
 * 2. Kesan buruk (adverse event)
 *
 * Ini rekod KESELAMATAN dan backend menyimpannya sebagai tidak boleh diubah.
 * Tahap keterukan WAJIB: ia menentukan sama ada kes ini perlu tindakan segera,
 * dan meninggalkannya kosong bermakna rekod tidak boleh disusun mengikut bahaya.
 * ------------------------------------------------------------------------- */
export function AdverseEventDialog({ open, onClose, encounter }: DialogProps) {
  const { t } = usePrefs();
  const scope = useScope();
  const qc = useQueryClient();
  const [severity, setSeverity] = useState("mild");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  /* PEMILIH PESAKIT LANGSUNG (aduan pemilik: "harus open encounter dulu ya?").
   * Backend TIDAK mewajibkan encounter (encounterId nullish) - kekangan itu
   * hanya reka bentuk dialog lama. Tiada sesi -> doktor pilih pesakit di sini. */
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const { user } = useAuth();
  const isHQ = user?.role === "hq";
  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: () => api.get<Array<{ id: string; name: string }>>("/admin/staff?role=doctor"),
    enabled: open && isHQ,
  });
  const patients = useQuery({
    queryKey: ["patients", "for-ae"],
    queryFn: () => api.get<Array<{ id: string; name: string; mrn: string }>>("/patients?limit=200"),
    enabled: open && !encounter,
    staleTime: 60_000,
  });
  const effectivePatientId = encounter?.patientId ?? encounter?.patient_id ?? (patientId || null);

  const save = useMutation({
    mutationFn: () =>
      api.post("/clinical/adverse-events", {
        ...scope,
        patientId: effectivePatientId,
        encounterId: encounter?.id ?? null,
        ...(isHQ ? { doctorId: doctorId || null } : {}),
        severity,
        description,
        actionTaken: actionTaken || null,
      }),
    onSuccess: () => {
      toast.success(t("clinical.aeSaved"));
      qc.invalidateQueries({ queryKey: ["clinical"] });
      setSeverity("mild"); setDescription(""); setActionTaken("");
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.saveFailed"))),
  });

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t("clinical.addAdverse")}
      hint={encounter?.patientName ?? t("clinical.noPatient")}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      submitLabel={t("clinical.save")}
      submitDisabled={description.trim().length < 2 || !effectivePatientId || (isHQ && !doctorId)}
    >
      {!encounter && (
        <div className="space-y-1.5">
          <Label className="text-foreground font-medium">{t("clinical.patient")} *</Label>
          <Select value={patientId} onValueChange={setPatientId}>
            <SelectTrigger className={field} aria-label={t("clinical.pickPatient")}>
              <SelectValue placeholder={t("clinical.pickPatient")} />
            </SelectTrigger>
            <SelectContent>
              {(patients.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.mrn}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {isHQ && (
        <div className="space-y-1.5">
          <Label className="text-foreground font-medium">{t("clinical.onBehalfDoctor")} *</Label>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger className={field}><SelectValue placeholder={t("clinical.pickDoctor")} /></SelectTrigger>
            <SelectContent>
              {(doctors.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.severity")} *</Label>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className={field}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mild">{t("clinical.sevMild")}</SelectItem>
            <SelectItem value="moderate">{t("clinical.sevModerate")}</SelectItem>
            <SelectItem value="severe">{t("clinical.sevSevere")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.description")} *</Label>
        <Textarea required minLength={2} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("clinical.descriptionPh")} className={field} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.actionTaken")}</Label>
        <Textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} placeholder={t("clinical.actionTakenPh")} className={field} />
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------------- *
 * 3. Rujukan
 * ------------------------------------------------------------------------- */
export function ReferralDialog({ open, onClose, encounter }: DialogProps) {
  const { t } = usePrefs();
  const scope = useScope();
  const qc = useQueryClient();
  const [toSpecialty, setToSpecialty] = useState("");
  const [toProvider, setToProvider] = useState("");
  const [reason, setReason] = useState("");
  /* PEMILIH PESAKIT LANGSUNG - sama seperti kesan buruk (aduan pemilik).
   * encounterId pilihan di skema backend. */
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const { user } = useAuth();
  const isHQ = user?.role === "hq";
  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: () => api.get<Array<{ id: string; name: string }>>("/admin/staff?role=doctor"),
    enabled: open && isHQ,
  });
  const patients = useQuery({
    queryKey: ["patients", "for-referral"],
    queryFn: () => api.get<Array<{ id: string; name: string; mrn: string }>>("/patients?limit=200"),
    enabled: open && !encounter,
    staleTime: 60_000,
  });
  const effectivePatientId = encounter?.patientId ?? encounter?.patient_id ?? (patientId || null);

  const save = useMutation({
    mutationFn: () =>
      api.post("/clinical/referrals", {
        ...scope,
        patientId: effectivePatientId,
        encounterId: encounter?.id ?? null,
        ...(isHQ ? { doctorId: doctorId || null } : {}),
        toSpecialty,
        toProvider: toProvider || null,
        reason,
      }),
    onSuccess: () => {
      toast.success(t("clinical.refSaved"));
      qc.invalidateQueries({ queryKey: ["clinical"] });
      setToSpecialty(""); setToProvider(""); setReason("");
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.saveFailed"))),
  });

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t("clinical.addReferral")}
      hint={encounter?.patientName ?? t("clinical.noPatient")}
      onSubmit={() => save.mutate()}
      pending={save.isPending}
      submitLabel={t("clinical.save")}
      submitDisabled={toSpecialty.trim().length < 2 || reason.trim().length < 2 || !effectivePatientId || (isHQ && !doctorId)}
    >
      {!encounter && (
        <div className="space-y-1.5">
          <Label className="text-foreground font-medium">{t("clinical.patient")} *</Label>
          <Select value={patientId} onValueChange={setPatientId}>
            <SelectTrigger className={field} aria-label={t("clinical.pickPatient")}>
              <SelectValue placeholder={t("clinical.pickPatient")} />
            </SelectTrigger>
            <SelectContent>
              {(patients.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.mrn}</SelectItem>)}
      {isHQ && (
        <div className="space-y-1.5">
          <Label className="text-foreground font-medium">{t("clinical.onBehalfDoctor")} *</Label>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger className={field}><SelectValue placeholder={t("clinical.pickDoctor")} /></SelectTrigger>
            <SelectContent>
              {(doctors.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.toSpecialty")} *</Label>
        <Input required minLength={2} value={toSpecialty} onChange={(e) => setToSpecialty(e.target.value)} placeholder={t("clinical.toSpecialtyPh")} className={field} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.toProvider")}</Label>
        <Input value={toProvider} onChange={(e) => setToProvider(e.target.value)} placeholder={t("clinical.toProviderPh")} className={field} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-foreground font-medium">{t("clinical.reason")} *</Label>
        <Textarea required minLength={2} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("clinical.reasonPh")} className={field} />
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------------- *
 * 4. Status rujukan — aliran pending → sent → acknowledged → completed
 *
 * Tanpa ini rujukan tersangkut pada "pending" selama-lamanya: doktor menulis
 * rujukan tetapi tiada cara merekod bahawa ia sudah dihantar atau diterima.
 * ------------------------------------------------------------------------- */
const REFERRAL_FLOW = ["pending", "sent", "acknowledged", "completed"] as const;

export function ReferralStatusSelect({ id, status }: { id: string; status: string }) {
  const { t } = usePrefs();
  const scope = useScope();
  const qc = useQueryClient();
  const change = useMutation({
    /* branchId/doctorId WAJIB: guard `scope:'own'` fail-closed dan hanya mengisi
     * doctorId untuk tindakan `view`. Tanpanya PATCH ini dijawab 403 walaupun
     * doktor itu pemilik rujukan — gejala menyalahkan peranan, puncanya medan
     * skop yang tertinggal. */
    mutationFn: (next: string) =>
      api.patch(`/clinical/referrals/${id}/status`, { ...scope, status: next }),
    onSuccess: () => {
      toast.success(t("clinical.refUpdated"));
      qc.invalidateQueries({ queryKey: ["clinical"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.saveFailed"))),
  });

  const label: Record<string, string> = {
    pending: t("clinical.stPending"),
    sent: t("clinical.stSent"),
    acknowledged: t("clinical.stAcknowledged"),
    completed: t("clinical.stCompleted"),
  };

  return (
    <Select value={status} onValueChange={(v) => change.mutate(v)}>
      <SelectTrigger className="h-8 w-[9.5rem] rounded-xl border-border bg-background text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {REFERRAL_FLOW.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {label[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
