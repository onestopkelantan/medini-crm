/**
 * PatientEditDialog — Fasa 1b, Seksyen 1.
 *
 * `PATCH /patients/:id` has existed since the beginning and the UI never called
 * it. A patient record was therefore WRITE-ONCE: a wrong phone number at
 * registration stayed wrong forever, and a receptionist's typos could only be
 * fixed in the database. The people who notice — the ones at the counter when
 * the patient gives the right number — had no way to correct it.
 *
 * WHAT IS EDITABLE, AND WHAT IS NOT
 *
 * Only the fields the server's `updatePatientSchema` accepts. Deliberately
 * absent: `mrn` (an allocated registration number — renumbering a record breaks
 * every printout that quotes it), `branchId` (moving a patient between branches
 * would move their clinical history's ownership, which is a governance act, not
 * a form field), and `status` (a lifecycle state with its own endpoint).
 *
 * The server derives `branchId` for a non-HQ caller and requires an explicit
 * target from HQ, so this dialog sends none: `useScope()` would be the wrong
 * helper here (it supplies `branchId`+`doctorId` for clinical WRITES), and
 * sending a branchId the caller does not control is how the scope-bug class
 * starts. The server already knows who is asking.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/* Nilai yang backend kenali. Disimpan huruf kecil supaya "WhatsApp" dan "whatsapp"
 * tidak menjadi dua saluran berbeza dalam laporan pemasaran. */
const PATIENT_SOURCES = ["walk_in", "whatsapp", "referral", "walk_by", "panel", "other"] as const;

export interface EditablePatient {
  id: string;
  mrn?: string;
  name: string;
  ic?: string | null;
  dob?: string | null;
  gender?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  /* Fasa 2B */
  pregnant?: boolean | null;
  patientSource?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  panelCompanyId?: string | null;
  panelMemberNo?: string | null;
}

export function PatientEditDialog({
  open, onClose, patient,
}: {
  open: boolean;
  onClose: () => void;
  patient: EditablePatient | null;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [ic, setIc] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("female");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  /* Fasa 2B. `pregnant` ialah tiga keadaan, bukan dua: "" = belum ditanya,
   * "yes" = hamil, "no" = tidak. Menggunakan kotak semak akan runtuhkan "belum
   * ditanya" menjadi "tidak", dan itu perubahan makna pada rekod klinikal. */
  const [pregnant, setPregnant] = useState("");
  const [source, setSource] = useState("");
  const [kinName, setKinName] = useState("");
  const [kinPhone, setKinPhone] = useState("");
  const [panelNo, setPanelNo] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  /* Seed once per patient. Without the id guard a background refetch would
   * overwrite whatever the operator is currently typing. */
  if (open && patient && loadedFor !== patient.id) {
    setLoadedFor(patient.id);
    setName(patient.name ?? "");
    setIc(patient.ic ?? "");
    setDob(patient.dob ? String(patient.dob).slice(0, 10) : "");
    setGender(patient.gender ?? "female");
    setPhone(patient.phone ?? "");
    setWhatsapp(patient.whatsapp ?? "");
    setEmail(patient.email ?? "");
    setPregnant(patient.pregnant === true ? "yes" : patient.pregnant === false ? "no" : "");
    setSource(patient.patientSource ?? "");
    setKinName(patient.nextOfKinName ?? "");
    setKinPhone(patient.nextOfKinPhone ?? "");
    setPanelNo(patient.panelMemberNo ?? "");
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const save = useMutation({
    mutationFn: () => api.patch(`/patients/${patient!.id}`, {
      name: name.trim(),
      /* Empty string -> null. The column is nullable and "" is not a phone
       * number: storing it would make every blank field compare equal to every
       * other blank field on a duplicate check. */
      ic: ic.trim() || null,
      dob: dob.trim() || null,
      gender,
      phone: phone.trim() || null,
      whatsapp: whatsapp.trim() || null,
      email: email.trim() || null,
      /* "" -> null: "belum ditanya" mesti boleh dibezakan daripada "tidak hamil". */
      pregnant: pregnant === "" ? null : pregnant === "yes",
      patientSource: source.trim() || null,
      nextOfKinName: kinName.trim() || null,
      nextOfKinPhone: kinPhone.trim() || null,
      panelMemberNo: panelNo.trim() || null,
    }),
    onSuccess: () => {
      toast.success(t("ptedit.saved"));
      qc.invalidateQueries({ queryKey: ["patients"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ptedit.saveFailed"))),
  });

  if (!patient) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            {t("ptedit.title")}, {patient.mrn ?? patient.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            {t("ptedit.hint")}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium text-xs">{t("ptedit.name")} *</Label>
            <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.ic")}</Label>
              <Input value={ic} onChange={(e) => setIc(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.dob")}</Label>
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.gender")}</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger className="rounded-xl border-border bg-background px-3 py-2 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="female">{t("ptedit.female")}</SelectItem>
                  <SelectItem value="male">{t("ptedit.male")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.phone")}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.whatsapp")}</Label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.email")}</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
          </div>

          {/* ---- Fasa 2B: soalan klinikal + operasi ---- */}
          <div className="h-px bg-border" />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.pregnant")}</Label>
              <Select value={pregnant || "unset"} onValueChange={(v) => setPregnant(v === "unset" ? "" : v)}>
                <SelectTrigger className="rounded-xl border-border bg-background px-3 py-2 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{t("ptedit.pregnantUnset")}</SelectItem>
                  <SelectItem value="yes">{t("ptedit.pregnantYes")}</SelectItem>
                  <SelectItem value="no">{t("ptedit.pregnantNo")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.source")}</Label>
              <Select value={source || "unset"} onValueChange={(v) => setSource(v === "unset" ? "" : v)}>
                <SelectTrigger className="rounded-xl border-border bg-background px-3 py-2 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{t("ptedit.sourceUnset")}</SelectItem>
                  {PATIENT_SOURCES.map((sc) => (
                    <SelectItem key={sc} value={sc}>{t(`ptedit.source.${sc}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.kinName")}</Label>
              <Input value={kinName} onChange={(e) => setKinName(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
              <p className="text-[10px] text-muted-foreground">{t("ptedit.kinHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium text-xs">{t("ptedit.kinPhone")}</Label>
              <Input value={kinPhone} onChange={(e) => setKinPhone(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground font-medium text-xs">{t("ptedit.panelNo")}</Label>
            <Input value={panelNo} onChange={(e) => setPanelNo(e.target.value)}
              placeholder={t("ptedit.panelNoHint")}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}
              className="rounded-xl border-border text-foreground hover:bg-muted">
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || save.isPending}
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {t("ptedit.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
