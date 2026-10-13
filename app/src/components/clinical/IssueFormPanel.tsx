/**
 * IssueFormPanel — issue a numbered form and print it (Fasa 1G-d).
 *
 * WHERE THIS SITS IN A CLINIC
 *
 * This is the screen someone opens when a patient says "I need an MC". It is deliberately
 * NOT inside Patient360 alone: an MC is issued at the counter, a time-off form is issued
 * for staff, and neither conversation starts by finding a patient record.
 *
 * WHY THE FORM IS ADDRESSED BEFORE IT IS NUMBERED
 *
 * The server claims the serial inside the same transaction that writes the row, and it
 * serialises on the PATIENT or STAFF row (two receptionists issuing an MC for the same
 * patient queue behind each other; different patients never contend). So the recipient is
 * not a detail — it is part of how the number stays unique. That is why the recipient is
 * chosen first and the preview shows the exact wording before anything is issued.
 *
 * WHY PRINTING IS A SEPARATE ACTION
 *
 * Issuing writes an auditable row with a serial number. Printing can happen again — a
 * patient loses the paper, an employer asks for a copy. If printing also issued, every
 * reprint would burn a new number and the sequence would no longer mean "certificates
 * given out".
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { downloadFormPdf } from "@/lib/form-pdf";
import { FileHeart, ShieldCheck, CalendarOff, FileText, Printer, AlertTriangle, Hash, Ban } from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------- types */

export type FormKind = "consent" | "mc" | "pdpa" | "time_off";

export interface FormTemplate {
  id: string; kind: FormKind; title: string; body: string;
  version: number; isActive: boolean;
}

export interface IssuedForm {
  id: string; kind: FormKind; serialNo: string; serialYear: number;
  templateId: string; templateVersion: number;
  titleSnapshot: string; bodySnapshot: string;
  patientId: string | null; staffId: string | null;
  subject: string | null; details: string | null;
  status: "issued" | "cancelled"; cancelReason: string | null;
  issuedAt: string;
}

interface Props {
  patientId?: string | null;
  patientName?: string | null;
  patientMrn?: string | null;
  /** Staff member, for a time-off form. */
  staffId?: string | null;
  staffName?: string | null;
  branchName: string;
  canIssue: boolean;
}

const KIND_META: { key: FormKind; labelKey: string; icon: typeof FileHeart; to: "patient" | "staff" }[] = [
  { key: "mc", labelKey: "form.mc", icon: FileHeart, to: "patient" },
  { key: "pdpa", labelKey: "form.pdpa", icon: ShieldCheck, to: "patient" },
  { key: "time_off", labelKey: "form.timeOff", icon: CalendarOff, to: "staff" },
  { key: "consent", labelKey: "form.consent", icon: FileText, to: "patient" },
];

const isPlaceholder = (body: string) => /^\[(TEKS|NOTIS|BORANG) BELUM DIISI/.test(body.trim());

/* ------------------------------------------------------------------- panel */

export default function IssueFormPanel({
  patientId, patientName, patientMrn, staffId, staffName, branchName, canIssue,
}: Props) {
  const { t } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FormKind>("mc");
  const [issuing, setIssuing] = useState(false);

  const meta = KIND_META.find((k) => k.key === kind)!;

  const templates = useQuery({
    queryKey: ["form-templates", kind, "active"],
    queryFn: () => api.get<FormTemplate[]>(`/clinical/forms/templates?kind=${kind}`),
    staleTime: 60_000,
  });

  /* Only the forms for THIS recipient. A patient's tab shows their MCs, not every MC in
   * the clinic — the list is the record of what was given to this person. */
  const filter = meta.to === "staff" ? `staffId=${staffId}` : `patientId=${patientId}`;
  const issued = useQuery({
    queryKey: ["issued-forms", kind, patientId, staffId],
    queryFn: () => api.get<IssuedForm[]>(`/clinical/forms?kind=${kind}&${filter}`),
    enabled: !!(patientId || staffId),
  });

  const issue = useMutation({
    mutationFn: (b: { templateId: string; subject: string; details: string }) =>
      api.post<IssuedForm>("/clinical/forms", {
        kind,
        templateId: b.templateId,
        ...(meta.to === "staff" ? { staffId } : { patientId }),
        subject: b.subject || null,
        details: b.details || null,
        /* The scope the form is issued under. The server derives the branch from it and
         * refuses without it — see `assertStaffWriter`. */
        branchId: user?.branchId ?? null,
        doctorId: user?.doctorId ?? null,
      }),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["issued-forms"] });
      setIssuing(false);
      toast.success(`${t("issue.done")} ${rec.serialNo}`);
      /* Printed IMMEDIATELY: an MC that is issued but not printed is a number with no
       * paper behind it, and the patient is standing there waiting. */
      print(rec);
    },
    onError: (e) => toast.error(errorMessage(e, t("issue.failed"))),
  });

  const cancel = useMutation({
    mutationFn: (b: { id: string; reason: string }) =>
      /* The skip is NOT optional here: `clinical:edit` carries scope 'own' and the guard is
       * fail-closed, so a PATCH without `branchId` + `doctorId` returns 403 "You do not have
       * permission" — a message that blames the ROLE while the cause is a missing field.
       * Same trap as TreatmentPlanPanel and ConsentPanel. */
      api.patch(`/clinical/forms/${b.id}/cancel`, {
        cancelReason: b.reason,
        branchId: user?.branchId ?? null,
        doctorId: user?.doctorId ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issued-forms"] });
      toast.success(t("issue.cancelled"));
    },
    onError: (e) => toast.error(errorMessage(e, t("issue.cancelFailed"))),
  });

  const print = (rec: IssuedForm) => {
    downloadFormPdf({
      clinicName: t("consent.clinicName"),
      branchName,
      kind: rec.kind,
      serialNo: rec.serialNo,
      /* The FROZEN snapshot, not the live template: a form is the words that were agreed
       * on the day, and an edit since then must not reach a reprint. */
      title: rec.titleSnapshot,
      templateVersion: rec.templateVersion,
      body: rec.bodySnapshot,
      patientName: patientName ?? null,
      patientMrn: patientMrn ?? null,
      staffName: staffName ?? null,
      subject: rec.subject,
      details: rec.details,
      issuedAt: new Date(rec.issuedAt).toISOString().slice(0, 16).replace("T", " "),
      issuedByName: null,
      cancelledReason: rec.cancelReason,
      labels: {
        heading: {
          consent: t("form.consent"), mc: t("form.mc"),
          pdpa: t("form.pdpa"), time_off: t("form.timeOff"),
        },
        patient: t("consent.pdfPatient"), mrn: t("consent.pdfMrn"),
        staff: t("issue.staff"), subject: t("issue.subject"), details: t("issue.details"),
        serial: t("issue.serial"), issuedBy: t("consent.pdfRecordedBy"),
        date: t("consent.pdfDate"), version: t("consent.pdfVersion"),
        signature: t("consent.pdfSignature"),
        patientSignature: t("issue.patientSignature"),
        issuerSignature: t("issue.issuerSignature"),
        voidMark: t("issue.voidMark"), voidReason: t("issue.voidReason"),
      },
    });
  };

  const recipientMissing = meta.to === "staff" ? !staffId : !patientId;
  const rows = issued.data ?? [];
  const activeTpl = (templates.data ?? [])[0];

  return (
    <div className="space-y-4">
      {/* ---- family selector ---- */}
      <div className="flex flex-wrap gap-2">
        {KIND_META.map((k) => {
          const Icon = k.icon;
          const on = k.key === kind;
          /* A family that needs a recipient this screen does not have (e.g. a time-off form
           * on a patient page) is shown DISABLED with the reason, not hidden — a missing
           * control looks like a missing feature. */
          const unavail = k.to === "staff" ? !staffId : !patientId;
          return (
            <button key={k.key} type="button" disabled={unavail}
              onClick={() => setKind(k.key)}
              title={unavail ? t("issue.noRecipient") : undefined}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                on ? "border-primary bg-primary text-primary-foreground"
                   : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}>
              <Icon className="h-3.5 w-3.5" />{t(k.labelKey)}
            </button>
          );
        })}
      </div>

      {/* ---- what will be issued ---- */}
      {templates.isLoading ? null : !activeTpl ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5 text-center">
          <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t("issue.noTemplate")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("issue.noTemplateHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-3.5">
            <p className="text-sm font-semibold text-foreground">
              {activeTpl.title}
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                v{activeTpl.version}
              </span>
            </p>
            {/* The exact wording, shown BEFORE issuing. An MC is a legal document; the person
                signing it should have read the text, not trusted a title. */}
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-2.5 text-xs leading-relaxed text-foreground">
              {activeTpl.body}
            </pre>
            {isPlaceholder(activeTpl.body) && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />{t("issue.placeholderWarn")}
                </p>
                <p className="mt-0.5">{t("issue.placeholderWarnBody")}</p>
              </div>
            )}
          </div>

          <Button size="sm" disabled={!canIssue || recipientMissing || issue.isPending}
            className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setIssuing(true)}>
            <Hash className="mr-1.5 h-4 w-4" />{t("issue.issueAndPrint")}
          </Button>
          {!canIssue && <p className="text-xs text-muted-foreground">{t("issue.noPermission")}</p>}
        </div>
      )}

      {/* ---- issued so far ---- */}
      {rows.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-mono text-xs font-medium text-foreground">
                  {r.serialNo}
                  {r.status === "cancelled" && (
                    <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-normal text-red-700 dark:text-red-400">
                      <Ban className="h-2.5 w-2.5" />{t("issue.voidMark")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {new Date(r.issuedAt).toLocaleDateString()} · v{r.templateVersion}
                  {r.subject ? ` · ${r.subject}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={() => print(r)}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />{t("issue.reprint")}
                </Button>
                {canIssue && r.status === "issued" && (
                  <Button size="sm" variant="outline" className="rounded-lg text-xs text-red-700"
                    onClick={() => {
                      const reason = window.prompt(t("issue.cancelPrompt"));
                      /* A cancellation without a reason is a gap someone has to explain
                       * later, so the reason is required and the number is KEPT. */
                      if (reason && reason.trim().length >= 4) cancel.mutate({ id: r.id, reason: reason.trim() });
                      else if (reason !== null) toast.error(t("issue.cancelReasonTooShort"));
                    }}>
                    {t("issue.cancel")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- issue dialog ---- */}
      <Dialog open={issuing} onOpenChange={setIssuing}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("issue.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("issue.dialogHint")}</DialogDescription>
          </DialogHeader>
          <IssueForm saving={issue.isPending} t={t}
            recipientName={(meta.to === "staff" ? staffName : patientName) ?? "—"}
            onSubmit={(b) => activeTpl && issue.mutate({ templateId: activeTpl.id, ...b })} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------- form */

function IssueForm({
  saving, t, recipientName, onSubmit,
}: {
  saving: boolean; t: (k: string) => string; recipientName: string;
  onSubmit: (b: { subject: string; details: string }) => void;
}) {
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="rounded-lg border border-border bg-muted p-3 text-xs">
          <p className="text-muted-foreground">{t("issue.recipient")}</p>
          <p className="mt-0.5 font-semibold text-foreground">{recipientName}</p>
        </div>
        <div>
          <Label htmlFor="isubject">{t("issue.subject")}</Label>
          <Input id="isubject" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder={t("issue.subjectPh")} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="idetails">{t("issue.details")}</Label>
          <Textarea id="idetails" value={details} onChange={(e) => setDetails(e.target.value)}
            rows={3} placeholder={t("issue.detailsPh")} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{t("issue.detailsHint")}</p>
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={saving}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit({ subject: subject.trim(), details: details.trim() })}>
          {saving ? "…" : t("issue.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
