import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtDate, rm } from "@/lib/format";
import { usePrefs } from "@/hooks/usePrefs";
/* Skop berpusat: guard backend fail-closed dan hanya mengisi doctorId untuk
   `view`. Setiap tulisan mesti hantar branchId + doctorId sendiri. */
import { useScope } from "@/hooks/useScope";
import ToothChartPanel from "@/components/clinical/ToothChartPanel";
import TreatmentPlanPanel from "@/components/clinical/TreatmentPlanPanel";
import { TreatmentPriceDialog, type PricedTreatment } from "@/components/clinical/TreatmentPriceDialog";
import { AddTreatmentDialog } from "@/components/clinical/AddTreatmentDialog";
import {
  PrescriptionDialog, AdverseEventDialog, ReferralDialog, ReferralStatusSelect,
} from "@/components/clinical/ClinicalActionPanels";
import { Stethoscope, Pill, AlertTriangle, Share2, Plus, FileText, CheckCircle2, Grid3x3, ShieldAlert, ClipboardList } from "lucide-react";
import { toast } from "sonner";

/* ---------- Types (backend contracts) ---------- */
interface Encounter {
  id: string; encounterCode?: string; encounter_code?: string;
  patientId?: string; patient_id?: string; patientName?: string;
  status: string; chiefComplaint?: string; chief_complaint?: string;
  startedAt?: string; started_at?: string; appointmentId?: string; appointment_id?: string;
  /* Pemilik 10 Okt: "detailkan masalah clinical" - doktor & cawangan encounter. */
  doctorName?: string | null;
  branchName?: string | null;
}
interface Appointment { id: string; code: string; patientName: string; patientId?: string; patient_id?: string; status: string; scheduledDate: string; scheduledTime: string }
/* `isActive`, BUKAN `status`: API katalog (/clinical/treatments) tidak menghantar medan
   status, jadi menaipnya sebagai `status: string` berbohong kepada TypeScript dan
   menyebabkan lencana memaparkan "Unknown" pada kesemua 12 rawatan. */
interface Treatment {
  id: string; name?: string; category?: string; isActive?: boolean; createdAt?: string;
  /* Kod katalog (TRT-0011) + durasi standard — papar seperti DentalERP. */
  code?: string;
  durationMin?: number | null;
  /* Fasa 1b — pricing. Nullable on purpose: `null` is "no fee decided yet",
   * which the list renders as "harga belum diisi" rather than RM0.00. */
  price?: number | string | null;
}
interface Prescription {
  id: string; medication?: string; status?: string; createdAt?: string;
  /* Medan jadual DentalERP: pesakit, doktor, dos, kekerapan, tempoh, nota. */
  patientId?: string; doctorId?: string; encounterId?: string | null;
  dosage?: string | null; frequency?: string | null; durationDays?: number | null;
  notes?: string | null;
  /* Nama pesakit dr API (LEFT JOIN) - jadual preskripsi tanpa kolum pesakit
   * tak nyambung (aduan pemilik: "ga nyambung pasien kh"). */
  patientName?: string | null;
}
interface AdverseEvent { id: string; description?: string; createdAt?: string; severity?: string; actionTaken?: string | null; patientName?: string | null }
interface Referral { id: string; status: string; createdAt?: string; toSpecialty?: string; reason?: string; patientName?: string | null }
interface ClinicalNote { id: string; soapSubjective?: string; soap_subjective?: string; signedAt?: string; signed_at?: string; createdAt?: string }

function useClinical<T>(key: string, path: string, enabled = true) {
  return useQuery({ queryKey: ["clinical", key], queryFn: () => api.get<T[]>(path), enabled });
}

/* ---------- New Encounter dialog (from an in-progress appointment) ---------- */
function NewEncounterDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (enc: Encounter) => void }) {
  /* Terjemahan per komponen: `t` daripada hook, bukan pemboleh ubah global. */
  const { t } = usePrefs();
  const { user } = useAuth();
  const scope = useScope();
  const qc = useQueryClient();
  const isHQ = user?.role === "hq";
  const today = new Date().toISOString().slice(0, 10);
  const queue = useQuery({
    queryKey: ["appointments", "queue", today],
    queryFn: () => api.get<Appointment[]>(`/appointments?limit=50`),
    enabled: open,
  });
  /* HQ membuka sesi ATAS NAMA doktor (owner direction 8 Okt): senarai doktor
   * diperlukan supaya pilihan itu eksplisit, bukan teks UUID yang disuruh
   * pengguna taip. Doktor biasa tidak nampak pemilih ini. */
  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: () => api.get<Array<{ id: string; name: string; branchId?: string | null }>>("/admin/staff?role=doctor"),
    enabled: open && isHQ,
  });
  const [apptId, setApptId] = useState("");
  const [complaint, setComplaint] = useState("");
  const [doctorId, setDoctorId] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const appt = (queue.data ?? []).find((a) => a.id === apptId);
      const patientId = appt?.patientId ?? appt?.patient_id;
      return api.post<Encounter>("/clinical/encounters", {
        ...scope,
        patientId, appointmentId: apptId || null,
        chiefComplaint: complaint || null,
        /* HQ sahaja: atas nama doktor pilihan; backend menolak HQ tanpa ini. */
        ...(isHQ ? { doctorId: doctorId || null } : {}),
      });
    },
    onSuccess: (r) => {
      toast.success(`${t("clinical.encOpened")} ${r.encounterCode ?? r.encounter_code ?? ""}`);
      qc.invalidateQueries({ queryKey: ["clinical"] });
      /* Hantar rekod yang baru dicipta. Mencari semula dalam senarai cache
       * pulangkan null kerana invalidateQueries() belum selesai — dan itu
       * meninggalkan activeEnc null, jadi butang tindakan kekal LUMPUH
       * walaupun sesi sudah wujud di pelayan. */
      onCreated(r);
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.encFailed"))),
  });

  const candidates = (queue.data ?? []).filter((a) => ["in-progress", "waiting", "checked-in", "confirmed"].includes(a.status));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">{t("clinical.openEncounter")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("clinical.openHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          {isHQ && (
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("clinical.onBehalfDoctor")} *</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger className="w-full rounded-xl border-input border bg-card px-4 py-2.5 text-sm shadow-sm">
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
            <Label className="text-foreground font-medium">{t("clinical.openEncounterLabel")} *</Label>
            <Select value={apptId} onValueChange={setApptId}>
              <SelectTrigger className="w-full rounded-xl border-input border bg-card px-4 py-2.5 text-sm shadow-sm">
                <SelectValue placeholder={t("clinical.selectAppointment")} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((a) => <SelectItem key={a.id} value={a.id}>{a.patientName} ({a.code}), {a.status}</SelectItem>)}
                {!candidates.length && <SelectItem value="__none" disabled>{t("clinical.noQueue")}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("clinical.chiefComplaintLabel")}</Label>
            <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder={t("clinical.complaintPh")} className="rounded-xl border-border bg-background px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("btn.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || !apptId || apptId === "__none" || (isHQ && !doctorId)}>
              {create.isPending ? t("clinical.opening") : t("clinical.openEncounterBtn")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- SOAP note dialog ---------- */
function SoapDialog({ open, onClose, encounter }: { open: boolean; onClose: () => void; encounter: Encounter | null }) {
  /* Terjemahan per komponen: `t` daripada hook, bukan pemboleh ubah global. */
  const { t } = usePrefs();
  const scope = useScope();
  const qc = useQueryClient();
  const [s, setS] = useState("");
  const [o, setO] = useState("");
  const [a, setA] = useState("");
  const [p, setP] = useState("");
  /* Set bila pelayan MENOLAK penutupan kerana alahan belum diakui. Menyimpan
   * mesej 409 (yang menamakan alahan itu) bermakna butang pengakuan hanya
   * muncul selepas gerbang benar-benar bertindak — bukan sebagai kotak yang
   * dipratanda yang akan diklik tanpa dibaca. */
  const [blockedByAllergy, setBlockedByAllergy] = useState<string | null>(null);

  const notes = useQuery({
    queryKey: ["clinical", "notes", encounter?.id],
    queryFn: () => api.get<ClinicalNote[]>(`/clinical/notes?encounterId=${encounter!.id}`),
    enabled: open && !!encounter?.id,
  });

  const save = useMutation({
    mutationFn: () => api.post<ClinicalNote>("/clinical/notes", {
      ...scope,
      encounterId: encounter!.id,
      soapSubjective: s, soapObjective: o, soapAssessment: a, soapPlan: p,
    }),
    onSuccess: () => { toast.success(t("clinical.soapSaved")); qc.invalidateQueries({ queryKey: ["clinical"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.saveFailed"))),
  });

  const sign = useMutation({
    mutationFn: (noteId: string) => api.post(`/clinical/notes/${noteId}/sign`, { ...scope }),
    onSuccess: () => { toast.success(t("clinical.signedOk")); qc.invalidateQueries({ queryKey: ["clinical"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.signFailed"))),
  });

  /* Pindaan (amendment) — item Fasa 1 #3.
   *
   * ADR-009: nota yang SUDAH DITANDATANGAN tidak boleh diubah. Membetulkannya
   * bermakna mencipta nota BAHARU yang merujuk nota asal, dan nota asal kekal
   * dalam rekod. Backend hanya membenarkan ini untuk nota bertandatangan —
   * "Only signed notes can be amended (use draft replace for unsigned)".
   *
   * Sebelum ini UI tiada butang ini langsung, jadi satu-satunya cara untuk
   * meminda nota ialah menulis nota baharu tanpa pautan — dan jejaknya hilang. */
  const amend = useMutation({
    mutationFn: (noteId: string) => api.post(`/clinical/notes/${noteId}/amend`, {
      ...scope,
      encounterId: encounter!.id,
      soapSubjective: s, soapObjective: o, soapAssessment: a, soapPlan: p,
    }),
    onSuccess: () => {
      toast.success(t("clinical.amendSaved"));
      qc.invalidateQueries({ queryKey: ["clinical"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("clinical.amendFailed"))),
  });

  const complete = useMutation({
    mutationFn: () => api.patch(`/clinical/encounters/${encounter!.id}/status`, { ...scope, status: "completed" }),
    onSuccess: () => { toast.success(t("clinical.encCompleted")); qc.invalidateQueries({ queryKey: ["clinical"] }); onClose(); },
    onError: (e: unknown) => {
      const msg = errorMessage(e, t("clinical.completeFailed"));
      /* A 409 from the safety gate is not a failure to report and forget — it
       * is an instruction. Hold the message so the acknowledgement control can
       * appear next to it. Any other error is a plain toast. */
      if (/ALLERGY_UNACKNOWLEDGED|Safety gate/i.test(msg)) setBlockedByAllergy(msg);
      else toast.error(msg);
    },
  });

  /* Fasa 1a — the missing door on the safety gate.
   *
   * `evaluateCompletionGate` (domain/safety-gate.ts) REFUSES to complete an
   * encounter while a moderate-or-worse allergy is unacknowledged, and names
   * the allergy in a 409. The endpoint that clears that condition
   * (`POST /clinical/encounters/:id/acknowledge-allergy`) has existed all along,
   * but NOTHING in the UI ever called it — so a doctor whose patient is allergic
   * to penicillin reached a case they could not close, with no control on screen
   * that would let them close it. The gate was right; it simply had no door.
   *
   * The acknowledgement is a DELIBERATE act, so it is a separate button that
   * only appears once the server has actually refused: the doctor reads the 409
   * naming the allergy, then confirms. A checkbox pre-ticked by the client would
   * turn the gate into a formality, and a gate clicked through without reading
   * protects nobody. */
  const blockingAllergies = useQuery({
    queryKey: ["clinical", "blocking-allergies", encounter?.patientId ?? encounter?.patient_id],
    queryFn: () => api.get<{ blocking: Array<{ id: string; allergen: string; severity: string }> }>(
      `/clinical/patients/${encounter!.patientId ?? encounter!.patient_id}/allergies`),
    enabled: open && !!encounter && !!blockedByAllergy,
    retry: false,
  });

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/clinical/encounters/${encounter!.id}/acknowledge-allergy`, { ...scope }),
    onSuccess: () => {
      toast.success(t("allergy.ackDone"));
      setBlockedByAllergy(null);
      qc.invalidateQueries({ queryKey: ["clinical"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("allergy.ackFailed"))),
  });

  if (!encounter) return null;
  const existing = (notes.data ?? [])[0];
  const signed = !!(existing?.signedAt ?? existing?.signed_at);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">{t("clinical.noteTitle")}, {encounter.patientName ?? t("clinical.patient")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{encounter.chiefComplaint ?? encounter.chief_complaint ?? t("clinical.noComplaint")}</DialogDescription>
        </DialogHeader>

        {existing && (
          <div className="rounded-xl border border-border bg-accent p-3 text-xs space-y-1">
            <p className="font-semibold text-foreground">{t("clinical.existingNote")} {signed ? t("clinical.signedTag") : t("clinical.draftTag")}</p>
            <p><b>S:</b> {existing.soapSubjective ?? existing.soap_subjective}</p>
          </div>
        )}

        {/* Gerbang keselamatan bertindak: nama alahan datang dari mesej 409
            pelayan, jadi doktor melihat APA yang menyekat dan boleh bertindak
            — bukan dinding tanpa pintu. */}
        {blockedByAllergy && (
          <div className="rounded-xl border border-destructive bg-destructive/10 p-3 space-y-2">
            <p className="text-xs font-semibold text-destructive">{t("allergy.bannerTitle")}</p>
            <p className="text-xs text-foreground">{blockedByAllergy}</p>
            <p className="text-xs text-muted-foreground">{t("allergy.ackRequired")}</p>
            {(blockingAllergies.data?.blocking ?? []).length > 0 && (
              <ul className="text-xs text-foreground space-y-0.5 pl-4 list-disc">
                {(blockingAllergies.data?.blocking ?? []).map((al) => (
                  <li key={al.id}><b>{al.allergen}</b>, {t(`sev.${al.severity}`)}</li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate()}
            >
              <ShieldAlert className="h-4 w-4 mr-1.5" /> {t("allergy.ackButton")}
            </Button>
          </div>
        )}

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1.5"><Label className="text-foreground font-medium">{t("clinical.soapS")} *</Label><Textarea required minLength={2} value={s} onChange={(e) => setS(e.target.value)} rows={2} placeholder={t("clinical.soapSPh")} className="rounded-xl border-border bg-background p-3" /></div>
          <div className="space-y-1.5"><Label className="text-foreground font-medium">{t("clinical.soapO")} *</Label><Textarea required minLength={2} value={o} onChange={(e) => setO(e.target.value)} rows={2} placeholder={t("clinical.soapOPh")} className="rounded-xl border-border bg-background p-3" /></div>
          <div className="space-y-1.5"><Label className="text-foreground font-medium">{t("clinical.soapA")} *</Label><Textarea required minLength={2} value={a} onChange={(e) => setA(e.target.value)} rows={2} placeholder={t("clinical.soapAPh")} className="rounded-xl border-border bg-background p-3" /></div>
          <div className="space-y-1.5"><Label className="text-foreground font-medium">{t("clinical.soapP")} *</Label><Textarea required minLength={2} value={p} onChange={(e) => setP(e.target.value)} rows={2} placeholder={t("clinical.soapPPh")} className="rounded-xl border-border bg-background p-3" /></div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("btn.close")}</Button>
            <Button type="submit" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={save.isPending}>
              {save.isPending ? t("clinical.saving") : existing ? t("clinical.saveDraft") : t("clinical.saveNote")}
            </Button>
            {existing && !signed && (
              <Button type="button" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={sign.isPending} onClick={() => sign.mutate(existing.id)}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> {t("clinical.signNote")}
              </Button>
            )}
            {/* Nota bertandatangan: butang SIMPAN menjadi "Simpan Pindaan" kerana
                ia mencipta versi baharu dan mengekalkan yang asal. */}
            {existing && signed && (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-border text-foreground hover:bg-muted disabled:opacity-50"
                disabled={amend.isPending}
                onClick={() => amend.mutate(existing.id)}
                title={t("clinical.amendHint")}
              >
                <FileText className="h-4 w-4 mr-1.5" /> {t("clinical.amend")}
              </Button>
            )}
            <Button type="button" className="rounded-xl bg-accent text-accent-foreground hover:bg-muted disabled:opacity-50" disabled={complete.isPending} onClick={() => complete.mutate()}>
              {t("clinical.completeEncounter")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Clinical page ---------- */
export default function Clinical() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const isDoctor = user?.role === "doctor";
  const encounters = useClinical<Encounter>("encounters", "/clinical/encounters?limit=50");
  const treatments = useClinical<Treatment>("treatments", "/clinical/treatments");
  const prescriptions = useClinical<Prescription>("prescriptions", "/clinical/prescriptions");
  const adverse = useClinical<AdverseEvent>("adverse", "/clinical/adverse-events");
  const referrals = useClinical<Referral>("referrals", "/clinical/referrals");

  const [showNew, setShowNew] = useState(false);
  const [activeEnc, setActiveEnc] = useState<Encounter | null>(null);

  /* Patient for the Plans tab: the URL wins (arrived from the patient page), then the
   * open session. Both are the same person the dentist is looking at; neither is a guess. */
  const [urlPatientId] = useSearchParams();
  const activeEncPatientId = activeEnc
    ? (activeEnc.patientId ?? (activeEnc as { patient_id?: string }).patient_id ?? null)
    : null;
  const [soapOpen, setSoapOpen] = useState(false);
  /* Tab aktif dikesan supaya butang header sepadan dengan senarai yang dilihat. */
  const [tab, setTab] = useState(isDoctor ? "encounters" : "treatments");
  /* Carian jadual gaya DentalERP (treatments + prescriptions). */
  const [treatSearch, setTreatSearch] = useState("");
  const [rxSearch, setRxSearch] = useState("");
  /* Tab Plans: pemilih pesakit MANUAL (aduan pemilik: tab "kosong" + tiada
   * cara terus memilih). Dropdown sebenar di skrin kosong, pola Tooth Chart. */
  const [plansPick, setPlansPick] = useState("");
  /* Senarai pesakit utk pemilih (tab Plans). Endpoint sama dgn Patients.tsx. */
  const patients = useQuery({
    queryKey: ["patients", "for-clinical-pickers"],
    queryFn: () => api.get<Array<{ id: string; mrn: string; name: string }>>("/patients?limit=200"),
    staleTime: 60_000,
  });
  const plansPatientId = urlPatientId.get("patientId") ?? activeEncPatientId ?? (plansPick || null);
  /* Fasa 1b — which treatment's price sheet is open. */
  const [priceFor, setPriceFor] = useState<PricedTreatment | null>(null);
  const [rxOpen, setRxOpen] = useState(false);
  /* Tambah Rawatan (dilakukan): dialog pelan-1-item + kos. presetTreatment dipilih dari baris jadual. */
  const [addTreatOpen, setAddTreatOpen] = useState(false);
  const [presetTreatment, setPresetTreatment] = useState<{ id: string; code?: string; name: string; category?: string | null; durationMin?: number | null; price?: number | string | null } | null>(null);
  const [aeOpen, setAeOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  /* Carian encounter (pemilik 10 Okt): nama pesakit, kod, keluhan, doktor. */
  const [encSearch, setEncSearch] = useState("");
  const encRows = (encounters.data ?? []).filter((e) => {
    const q = encSearch.trim().toLowerCase();
    if (!q) return true;
    const hay = [e.patientName, e.encounterCode ?? e.encounter_code, e.chiefComplaint ?? e.chief_complaint, e.doctorName, e.branchName]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("clinical.title")}
        description={t(isDoctor ? "clinical.subtitleDoctor" : "clinical.subtitleOther")}
        actions={(isDoctor || user?.role === "hq") && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Tindakan bergantung pada tab: preskripsi/kesan buruk/rujukan
                memerlukan sesi rawatan yang DIBUKA, jadi butang utamanya ialah
                "Buka Sesi" sehingga satu sesi aktif wujud. */}
            <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> {t("clinical.openEncounter")}
            </Button>
            {tab === "treatments" && (
              <Button size="sm" variant="outline" className="rounded-xl border-border text-foreground hover:bg-muted" onClick={() => { setPresetTreatment(null); setAddTreatOpen(true); }}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("clinical.addTreatment")}
              </Button>
            )}
            {tab === "prescriptions" && (
              <Button size="sm" variant="outline" className="rounded-xl border-border text-foreground hover:bg-muted" onClick={() => setRxOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("clinical.addPrescription")}
              </Button>
            )}
            {tab === "adverse" && (
              <Button size="sm" variant="outline" className="rounded-xl border-border text-foreground hover:bg-muted" onClick={() => setAeOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("clinical.addAdverse")}
              </Button>
            )}
            {tab === "referrals" && (
              <Button size="sm" variant="outline" className="rounded-xl border-border text-foreground hover:bg-muted" onClick={() => setRefOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> {t("clinical.addReferral")}
              </Button>
            )}
          </div>
        )}
      />

      {/* Konteks sesi: preskripsi/kesan buruk/rujukan berpaut pada satu lawatan.
          Tanpa penunjuk ini doktor menekan "Tambah" lalu tidak faham mengapa
          senarai kekal kosong. */}
      {activeEnc && (
        <p className="text-xs text-muted-foreground">
          {t("clinical.activeSession")}: {activeEnc.patientName ?? t("clinical.patient")} ·{" "}
          {activeEnc.encounterCode ?? activeEnc.encounter_code ?? activeEnc.id.slice(0, 8)}
        </p>
      )}

      {/* CHARTING INLINE WITH THE VISIT, the doctor's real flow is "write the
          notes AND chart the teeth in one place". The Chart tab stays for
          opening any patient's chart without an active encounter; this panel is
          the chairside path: read = the patient's continuous chart, write = the
          open encounter (ToothChartPanel already holds that contract). */}
      {activeEnc && activeEncPatientId && (
        <details className="group rounded-lg border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-foreground">
            {t("clinical.chartInlineTitle")}, {activeEnc.patientName ?? t("clinical.patient")}
          </summary>
          <div className="border-t border-border px-5 py-4">
            <ToothChartPanel
              encounterId={activeEnc.id}
              encounterPatientId={activeEncPatientId}
              canEdit={isDoctor}
            />
          </div>
        </details>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-muted border border-border rounded-lg p-1 shadow-sm">
          <TabsTrigger value="encounters" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <FileText className="h-3.5 w-3.5 mr-1.5" />{t("clinical.tabEncounters")}
          </TabsTrigger>
          <TabsTrigger value="chart" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Grid3x3 className="h-3.5 w-3.5 mr-1.5" />{t("chart.title")}
          </TabsTrigger>
          <TabsTrigger value="plans" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" />{t("plan.title")}
          </TabsTrigger>
          <TabsTrigger value="treatments" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Stethoscope className="h-3.5 w-3.5 mr-1.5" />{t("clinical.tabTreatments")}
          </TabsTrigger>
          <TabsTrigger value="prescriptions" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Pill className="h-3.5 w-3.5 mr-1.5" />{t("clinical.tabPrescriptions")}
          </TabsTrigger>
          <TabsTrigger value="adverse" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />{t("clinical.tabAdverse")}
          </TabsTrigger>
          <TabsTrigger value="referrals" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Share2 className="h-3.5 w-3.5 mr-1.5" />{t("clinical.tabReferrals")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="encounters" className="mt-4">

          {/* Penjelasan sub-fitur: sesi rawatan */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t("clinical.encDesc")}</p>
            {/* Carian encounter: nama pesakit / kod / keluhan / doktor / cawangan. */}
            <Input
              value={encSearch}
              onChange={(e) => setEncSearch(e.target.value)}
              placeholder={t("clinical.searchEnc")}
              className="h-9 w-64 rounded-xl"
              aria-label={t("clinical.searchEnc")}
            />
          </div>
          <Panel className="rounded-lg border border-border bg-card p-5">
            {encounters.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {encRows.map((e) => (
                <div key={e.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{e.patientName ?? t("clinical.patient")}</p>
                    <p className="text-xs text-muted-foreground">{e.encounterCode ?? e.encounter_code} · {fmtDateTime(e.startedAt ?? e.started_at)}</p>
                    {/* Siapa merawat, di cawangan mana - butiran yang pemilik
                        cari bila membaca senarai (bukan cuma nama & masa). */}
                    {(e.doctorName || e.branchName) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">{e.doctorName ?? "—"}</span>
                        {e.branchName ? ` · ${e.branchName}` : ""}
                      </p>
                    )}
                    {(e.chiefComplaint ?? e.chief_complaint) && <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.chiefComplaint ?? e.chief_complaint}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={e.status} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-accent-foreground" />
                    {(isDoctor || user?.role === "hq") && e.status === "open" && (
                      <Button size="sm" className="text-xs rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { setActiveEnc(e); setTab("encounters"); }}>{t("clinical.continueSession")}</Button>
                    )}
                    {isDoctor && e.status === "open" && (
                      <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" onClick={() => { setActiveEnc(e); setSoapOpen(true); }}>{t("clinical.soapComplete")}</Button>
                    )}
                  </div>
                </div>
              ))}
              {!encounters.isLoading && !encRows.length && (
                <EmptyState title={t("clinical.noEncounters")} description={t(isDoctor ? "clinical.noEncountersDoctor" : "clinical.noEncountersOther")} />
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="chart" className="mt-4">

          {/* Penjelasan sub-fitur: carta gigi berterusan */}
          <p className="mb-3 text-sm text-muted-foreground">{t("clinical.chartDesc")}</p>          <Panel className="rounded-lg border border-border bg-card p-5">
            {/* Chart reads the CONTINUOUS patient chart; writes go to the open
                encounter, because every tooth change is a dated clinical event. */}
            <ToothChartPanel
              encounterId={activeEnc?.id ?? null}
              encounterPatientId={activeEnc ? (activeEnc.patientId ?? activeEnc.patient_id ?? null) : null}
              canEdit={isDoctor}
            />
          </Panel>
        </TabsContent>

        <TabsContent value="plans" className="mt-4">

          {/* Penjelasan sub-fitur: pelan rawatan */}
          <p className="mb-3 text-sm text-muted-foreground">{t("clinical.plansDesc")}</p>          {/* WHICH PATIENT'S PLANS?
              A patient is chosen in one of two ways, in order of directness:
                1. `?patientId=`, arrived from a patient's own page.
                2. the ACTIVE SESSION below, the dentist opened a visit, so the plans
                   shown are that patient's. This is the path that was missing: a dentist
                   finishing treatment at the chair had no route to the bill, because the
                   plans and the charge control only lived on the patient page.
              With neither, it says so instead of showing every plan in the branch. */}
          {plansPatientId ? (
            <div className="space-y-3">
              {/* BARIS TUKAR PESAKIT - kekal kelihatan selepas pilih (aduan
               * pemilik: "abis pilih kok gabisa balik milih lihat treatment
               * plans lain"). Dropdown sama seperti skrin kosong. */}
              {!urlPatientId.get("patientId") && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">
                    {(patients.data ?? []).find((p) => p.id === plansPatientId)?.name ?? "…"}
                  </span>
                  <Select value={plansPick} onValueChange={setPlansPick}>
                    <SelectTrigger className="max-w-xs rounded-xl border border-input bg-card shadow-sm" aria-label={t("clinical.plansPickPatient")}>
                      <SelectValue placeholder={t("clinical.pickPatient")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(patients.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} · {p.mrn}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <TreatmentPlanPanel patientId={plansPatientId} canEdit={isDoctor} />
            </div>
          ) : (
            <Panel className="space-y-4">
              {/* PEMILIH TERUS: bukan lagi teks "pergi ke tempat lain". */}
              <div className="space-y-1.5 max-w-md">
                <Label className="text-foreground font-medium">{t("clinical.plansPickPatient")}</Label>
                <Select value={plansPick} onValueChange={setPlansPick}>
                  <SelectTrigger className="w-full rounded-xl border-input border bg-card px-4 py-2.5 text-sm shadow-sm">
                    <SelectValue placeholder={t("clinical.pickPatient")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(patients.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} · {p.mrn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* PETA ALIRAN - tab ini difahami tanpa membaca kod. */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {["pst.draft", "pst.proposed", "pst.accepted", "pst.active", "pst.completed"].map((k, i) => (
                  <span key={k} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-medium text-foreground">{t(k)}</span>
                  </span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{t("clinical.plansPickPatientHint")}</p>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="treatments" className="mt-4">
          <Panel className="rounded-lg border border-border bg-card p-5">
            {/* JADUAL GAYA DENTALERP, kod, nama, kategori, durasi, harga, status.
                Sebelum ini senarai 2-baris sahaja; pengguna Medini banding terus
                dengan DentalERP dan minta jadual yang boleh diskrol. */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t("clinical.treatDesc")}</p>
              <div className="relative">
                <Input
                  value={treatSearch}
                  onChange={(e) => setTreatSearch(e.target.value)}
                  placeholder={t("clinical.searchTreat")}
                  className="h-9 w-56 rounded-xl pl-3"
                  aria-label={t("clinical.searchTreat")}
                />
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colCode")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colName")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colCategory")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colDuration")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colPrice")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colStatus")}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {treatments.isLoading && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">…</td></tr>
                  )}
                  {(treatments.data ?? [])
                    .filter((tr) => !treatSearch
                      || (tr.name ?? "").toLowerCase().includes(treatSearch.toLowerCase())
                      || (tr.code ?? "").toLowerCase().includes(treatSearch.toLowerCase())
                      || (tr.category ?? "").toLowerCase().includes(treatSearch.toLowerCase()))
                    .map((tr) => (
                    <tr key={tr.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{tr.code ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{tr.name ?? t("clinical.treatment")}</td>
                      <td className="px-3 py-2 text-muted-foreground">{tr.category ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{tr.durationMin ? `${tr.durationMin} min` : "—"}</td>
                      <td className="px-3 py-2">
                        {/* Fasa 1b, a treatment with no price is why a bill totals
                            RM0.00. "belum diisi" is the honest state, never RM0.00. */}
                        <span className="text-foreground">
                          {tr.price == null ? <span className="text-muted-foreground italic">{t("price.notSet")}</span> : rm(Number(tr.price) / 100, 2)}
                        </span>
                        {tr.price != null && (
                          <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                            {t("price.demoBadge")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {/* `isActive`, bukan `status`: API katalog tidak menghantar medan status. */}
                        <StatusBadge status={tr.isActive === false ? "inactive" : "active"} statusText={tr.isActive === false ? t("clinical.inactive") : t("clinical.active")} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-accent-foreground" />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {/* Rekod rawatan dilakukan: pelan-1-item + kos dalam satu klik. */}
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-border text-foreground hover:bg-muted h-8 px-3 text-xs mr-1"
                          onClick={() => { setPresetTreatment({ id: tr.id, code: tr.code, name: tr.name ?? "", category: tr.category, durationMin: tr.durationMin, price: tr.price }); setAddTreatOpen(true); }}
                        >
                          {t("clinical.addTreatmentShort")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-border text-foreground hover:bg-muted h-8 px-3 text-xs"
                          onClick={() => setPriceFor(tr)}
                        >
                          {t("price.title")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!treatments.isLoading && !(treatments.data ?? []).length && (
                    <tr><td colSpan={7}><EmptyState title={t("clinical.noTreatments")} description={t("clinical.noTreatmentsHint")} /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="prescriptions" className="mt-4">
          <Panel className="rounded-lg border border-border bg-card p-5">
            {/* JADUAL GAYA DENTALERP, ubat, dos, kekerapan, tempoh, nota, tarikh.
                Medan dos/kekerapan/tempoh sudah lama ada di DB; senarai lama
                hanya papar nama ubat + tarikh (membazirkan data). */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t("clinical.rxDesc")}</p>
              <div className="relative">
                <Input
                  value={rxSearch}
                  onChange={(e) => setRxSearch(e.target.value)}
                  placeholder={t("clinical.searchRx")}
                  className="h-9 w-56 rounded-xl pl-3"
                  aria-label={t("clinical.searchRx")}
                />
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colPatient")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colMedication")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colDosage")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colFrequency")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colDuration")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colNotes")}</th>
                    <th className="px-3 py-2 font-semibold text-foreground">{t("clinical.colDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {prescriptions.isLoading && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">…</td></tr>
                  )}
                  {(prescriptions.data ?? [])
                    .filter((r) => !rxSearch
                      || (r.medication ?? "").toLowerCase().includes(rxSearch.toLowerCase())
                      || (r.notes ?? "").toLowerCase().includes(rxSearch.toLowerCase())
                      || (r.patientName ?? "").toLowerCase().includes(rxSearch.toLowerCase()))
                    .map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium text-foreground">{r.patientName ?? r.patientId?.slice(0, 8) ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.medication ?? t("clinical.prescription")}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.dosage ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.frequency ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.durationDays ? `${r.durationDays} ${t("clinical.days")}` : "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-48 truncate">{r.notes ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    </tr>
                  ))}
                  {!prescriptions.isLoading && !(prescriptions.data ?? []).length && (
                    <tr><td colSpan={6}><EmptyState title={t("clinical.noPrescriptions")} description={t("clinical.noPrescriptionsHint")} /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="adverse" className="mt-4">

          {/* Penjelasan sub-fitur: kesan buruk */}
          <p className="mb-3 text-sm text-muted-foreground">{t("clinical.aeDesc")}</p>          <Panel className="rounded-lg border border-border bg-card p-5">
            {adverse.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(adverse.data ?? []).map((a) => (
                <div key={a.id} className="py-3">
                  <p className="text-sm text-foreground"><span className="font-medium">{a.patientName ?? t("msg.patientFallback")}</span> · <span className="text-xs uppercase tracking-wide text-muted-foreground">{a.severity ?? ""}</span></p>
                  <p className="text-sm text-foreground">{a.description ?? t("clinical.adverseEvent")}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(a.createdAt)}</p>
                </div>
              ))}
              {!adverse.isLoading && !(adverse.data ?? []).length && <EmptyState title={t("clinical.noAdverse")} description={t("clinical.noAdverseHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="referrals" className="mt-4">

          {/* Penjelasan sub-fitur: rujukan */}
          <p className="mb-3 text-sm text-muted-foreground">{t("clinical.refDesc")}</p>          <Panel className="rounded-lg border border-border bg-card p-5">
            {referrals.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(referrals.data ?? []).map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{r.patientName ?? t("msg.patientFallback")} → {r.toSpecialty ?? "—"}</p>
                    {r.reason && <p className="text-xs text-muted-foreground truncate">{r.reason}</p>}
                  </div>
                  {/* Status boleh diubah oleh doktor: tanpa ini rujukan kekal
                      "pending" selama-lamanya dan tiada rekod ia sudah dihantar. */}
                  {isDoctor ? (
                    <ReferralStatusSelect id={r.id} status={r.status} />
                  ) : (
                    <StatusBadge status={r.status} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-accent-foreground" />
                  )}
                </div>
              ))}
              {!referrals.isLoading && !(referrals.data ?? []).length && <EmptyState title={t("clinical.noReferrals")} description={t("clinical.noReferralsHint")} />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewEncounterDialog open={showNew} onClose={() => setShowNew(false)} onCreated={(enc) => {
        /* Guna rekod yang dihantar, bukan carian dalam cache yang belum dikemas kini. */
        setActiveEnc(enc);
        setSoapOpen(true);
      }} />
      <SoapDialog open={soapOpen} onClose={() => setSoapOpen(false)} encounter={activeEnc} />
      <PrescriptionDialog open={rxOpen} onClose={() => setRxOpen(false)} encounter={activeEnc} />
      <TreatmentPriceDialog open={!!priceFor} onClose={() => setPriceFor(null)} treatment={priceFor} />
      <AddTreatmentDialog open={addTreatOpen} onClose={() => setAddTreatOpen(false)} presetTreatment={presetTreatment} presetPatientId={activeEncPatientId} />
      <AdverseEventDialog open={aeOpen} onClose={() => setAeOpen(false)} encounter={activeEnc} />
      <ReferralDialog open={refOpen} onClose={() => setRefOpen(false)} encounter={activeEnc} />
    </div>
  );
}
