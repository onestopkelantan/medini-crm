/**
 * ConsentPanel — consent templates and recorded consent (Fasa 1E).
 *
 * WHAT THIS SCREEN IS FOR
 *
 * Two jobs that look similar and are not:
 *
 *   1. RECORD consent. Pick a template, say who agreed and how, save. This is the
 *      clinical act and it is what unblocks a consent-required treatment plan
 *      (`evaluateConsentGate` refuses `accepted` until a record exists — proven in
 *      `verify-fasa1d-plan.sh`).
 *   2. PRINT it. A consent form is signed on paper and filed. The PDF carries the
 *      exact template VERSION that was agreed to, which is the whole reason it is a
 *      real PDF and not a re-rendered page.
 *
 * TEMPLATES ARE HQ-ONLY TO WRITE, EVERYONE READS
 *
 * `createTemplate` calls `assertHq`, and the matrix agrees. So the "new template"
 * control is hidden for every other role rather than shown-and-refused — a control
 * that fails on submit is worse than no control, because it wastes the attempt.
 *
 * RECORDS ARE IMMUTABLE (ADR-009)
 *
 * There is no edit and no delete, by design: `consent_records` is INSERT-only. A
 * consent that could be quietly changed is not evidence. The screen therefore has no
 * such control — not because it was forgotten, but because consent is a fact about a
 * moment.
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
import { downloadConsentPdf } from "@/lib/consent-pdf";
import { FileText, Plus, Download, ShieldCheck, Lock } from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------- types */

export interface ConsentTemplate {
  id: string; title: string; body: string; version: number; isActive: boolean;
}
export interface ConsentRecord {
  id: string; templateId: string; templateVersion: number;
  patientId: string; planId: string | null; encounterId: string | null;
  method: "verbal" | "written" | "electronic";
  consentedBy: string; consentedAt: string;
  recordedBy: string; witnessedBy: string | null; notes: string | null;
}

interface Props {
  patientId: string;
  patientName: string;
  patientMrn: string;
  /** A plan to attach the consent to, when the screen was reached from one. */
  planId?: string | null;
  encounterId?: string | null;
  canWrite: boolean;
  isHq: boolean;
  clinicName: string;
}

/* ------------------------------------------------------------------- panel */

export default function ConsentPanel({
  patientId, patientName, patientMrn, planId, encounterId, canWrite, isHq, clinicName,
}: Props) {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [newTemplate, setNewTemplate] = useState(false);

  /* THE WRITE SCOPE — the panel's own trap.
   *
   * `clinical:create` is granted to the doctor with scope `own`, and the scope guard is
   * FAIL-CLOSED: it fills the doctor in for reads, but a WRITE must carry `branchId` +
   * `doctorId` explicitly. Without them every save dies as a 403 "You do not have
   * permission" — a message that points at the role, not at the missing field, so it
   * reads as "this screen is not for you" while the API is merely missing a value.
   *
   * This is exactly the bug the verify script could not catch: the script sends the
   * fields, so it passed while the screen failed. The server stays the authority; the
   * screen simply states who is acting. */
  const scope = { branchId: user?.branchId ?? null, doctorId: user?.doctorId ?? null };

  const records = useQuery({
    queryKey: ["consents", patientId],
    queryFn: () => api.get<ConsentRecord[]>(`/clinical/consents/records?patientId=${patientId}`),
    enabled: !!patientId,
  });

  const templates = useQuery({
    queryKey: ["consent-templates"],
    queryFn: () => api.get<ConsentTemplate[]>("/clinical/consents/templates"),
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["consents", patientId] });

  const create = useMutation({
    mutationFn: (b: { templateId: string; method: string; consentedBy: string; notes: string | null }) =>
      api.post("/clinical/consents/records", {
        patientId, templateId: b.templateId, method: b.method,
        consentedBy: b.consentedBy, notes: b.notes,
        ...(planId ? { planId } : {}),
        ...(encounterId ? { encounterId } : {}),
        ...scope,
      }),
    onSuccess: () => { invalidate(); setRecording(false); toast.success(t("consent.recorded")); },
    onError: (e) => toast.error(errorMessage(e, t("consent.recordFailed"))),
  });

  const addTemplate = useMutation({
    mutationFn: (b: { title: string; body: string }) => api.post("/clinical/consents/templates", b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consent-templates"] });
      setNewTemplate(false);
      toast.success(t("consent.templateAdded"));
    },
    onError: (e) => toast.error(errorMessage(e, t("consent.templateFailed"))),
  });

  const tplById = new Map((templates.data ?? []).map((x) => [x.id, x]));

  /* ---- print ---- */
  const print = (rec: ConsentRecord) => {
    const tpl = tplById.get(rec.templateId);
    if (!tpl) {
      /* The PDF must carry the AGREED WORDING. If the template cannot be read, say so
       * rather than printing a form with an empty body — a consent with no terms is
       * not evidence of anything. */
      toast.error(t("consent.templateMissing"));
      return;
    }
    downloadConsentPdf({
      clinicName,
      templateTitle: tpl.title,
      templateVersion: rec.templateVersion,
      templateBody: tpl.body,
      patientName, patientMrn,
      consentedBy: rec.consentedBy,
      method: rec.method,
      consentedAt: new Date(rec.consentedAt).toISOString().slice(0, 16).replace("T", " "),
      recordedByName: null,
      witnessedByName: rec.witnessedBy,
      notes: rec.notes,
      labels: {
        title: t("consent.pdfTitle"),
        patient: t("consent.pdfPatient"),
        mrn: t("consent.pdfMrn"),
        consentedBy: t("consent.pdfConsentedBy"),
        method: t("consent.pdfMethod"),
        date: t("consent.pdfDate"),
        recordedBy: t("consent.pdfRecordedBy"),
        witnessedBy: t("consent.pdfWitnessedBy"),
        notes: t("consent.pdfNotes"),
        statement: t("consent.pdfStatement"),
        signature: t("consent.pdfSignature"),
        version: t("consent.pdfVersion"),
        methods: {
          verbal: t("method.verbal"), written: t("method.written"), electronic: t("method.electronic"),
        },
      },
    });
  };

  if (records.isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = records.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-foreground">{rows.length}</span>
          <span className="text-muted-foreground">{t("consent.count")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* HQ-only: `createTemplate` asserts HQ, so showing it to anyone else
              would be a control that always fails. */}
          {isHq && (
            <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setNewTemplate(true)}>
              <Plus className="mr-1.5 h-4 w-4" />{t("consent.newTemplate")}
            </Button>
          )}
          {canWrite && (
            <Button size="sm" className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setRecording(true)}>
              <ShieldCheck className="mr-1.5 h-4 w-4" />{t("consent.record")}
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
          <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t("consent.none")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("consent.noneHint")}</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((rec) => {
            const tpl = tplById.get(rec.templateId);
            return (
              <div key={rec.id} className="flex items-start justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {tpl?.title ?? t("consent.unknownTemplate")}
                    {/* The VERSION is what was agreed to, so it is shown, a template
                        can be edited later and this record must not appear to follow it. */}
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                      v{rec.templateVersion}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {rec.consentedBy} · {t(`method.${rec.method}`)} · {fmtShortDate(lang, rec.consentedAt)}
                  </p>
                  {rec.notes && <p className="mt-0.5 text-xs text-muted-foreground">{rec.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Immutability stated where a reader would look for an edit button. */}
                  <span className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex">
                    <Lock className="h-3 w-3" />{t("consent.immutable")}
                  </span>
                  <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={() => print(rec)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />{t("consent.print")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- record dialog ---- */}
      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("consent.record")}</DialogTitle>
            <DialogDescription>{t("consent.recordHint")}</DialogDescription>
          </DialogHeader>
          <RecordForm
            templates={templates.data ?? []}
            saving={create.isPending}
            onSubmit={(b) => create.mutate(b)}
            t={t}
          />
        </DialogContent>
      </Dialog>

      {/* ---- new template dialog ---- */}
      <Dialog open={newTemplate} onOpenChange={setNewTemplate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("consent.newTemplate")}</DialogTitle>
            <DialogDescription>{t("consent.newTemplateHint")}</DialogDescription>
          </DialogHeader>
          <TemplateForm saving={addTemplate.isPending} onSubmit={(b) => addTemplate.mutate(b)} t={t} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

function RecordForm({
  templates, saving, onSubmit, t,
}: {
  templates: ConsentTemplate[]; saving: boolean; t: (k: string) => string;
  onSubmit: (b: { templateId: string; method: string; consentedBy: string; notes: string | null }) => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [method, setMethod] = useState<"verbal" | "written" | "electronic">("written");
  const [consentedBy, setConsentedBy] = useState("");
  const [notes, setNotes] = useState("");

  /* The wording the patient is agreeing to, shown BEFORE saving. A form that records
   * consent to unread text is a signature on a blank page. */
  const chosen = templates.find((x) => x.id === templateId);
  const blocked = saving || !templateId || consentedBy.trim().length < 2;

  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <Label className="mb-1.5 block">{t("consent.fieldTemplate")}</Label>
          <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
            {templates.map((tpl) => (
              <button key={tpl.id} type="button" onClick={() => setTemplateId(tpl.id)}
                className={`block w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  templateId === tpl.id ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-accent"
                }`}>
                <span className="font-medium">{tpl.title}</span>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">v{tpl.version}</span>
              </button>
            ))}
            {templates.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t("consent.noTemplates")}</p>
            )}
          </div>
        </div>

        {chosen && (
          <div>
            <Label className="mb-1.5 block">{t("consent.fieldWording")}</Label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-muted p-2.5 text-xs leading-relaxed text-foreground">
              {chosen.body}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block">{t("consent.fieldMethod")}</Label>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(["written", "verbal", "electronic"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                    method === m ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent"
                  }`}>
                  {t(`method.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="cby">{t("consent.fieldConsentedBy")}</Label>
            <Input id="cby" value={consentedBy} onChange={(e) => setConsentedBy(e.target.value)}
              placeholder={t("consent.fieldConsentedByPh")} className="mt-1.5" />
          </div>
        </div>

        <div>
          <Label htmlFor="cnotes">{t("consent.fieldNotes")}</Label>
          <Textarea id="cnotes" value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} placeholder={t("consent.fieldNotesPh")} className="mt-1.5" />
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={blocked}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit({
            templateId, method, consentedBy: consentedBy.trim(), notes: notes.trim() || null,
          })}>
          {saving ? "…" : t("consent.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function TemplateForm({
  saving, onSubmit, t,
}: { saving: boolean; t: (k: string) => string; onSubmit: (b: { title: string; body: string }) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  /* Mirrors the server rule (`body` min 10) so the form refuses before a round trip.
   * The server stays the authority. */
  const blocked = saving || title.trim().length < 2 || body.trim().length < 10;

  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <Label htmlFor="ttitle">{t("consent.fieldTitle")}</Label>
          <Input id="ttitle" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t("consent.fieldTitlePh")} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="tbody">{t("consent.fieldBody")}</Label>
          <Textarea id="tbody" value={body} onChange={(e) => setBody(e.target.value)}
            rows={6} placeholder={t("consent.fieldBodyPh")} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{t("consent.fieldBodyHint")}</p>
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={blocked}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit({ title: title.trim(), body: body.trim() })}>
          {saving ? "…" : t("consent.saveTemplate")}
        </Button>
      </DialogFooter>
    </>
  );
}
