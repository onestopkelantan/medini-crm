import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { Stethoscope, Pill, AlertTriangle, Share2, Plus, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/* ---------- Types (backend contracts) ---------- */
interface Encounter {
  id: string; encounterCode?: string; encounter_code?: string;
  patientId?: string; patient_id?: string; patientName?: string;
  status: string; chiefComplaint?: string; chief_complaint?: string;
  startedAt?: string; started_at?: string; appointmentId?: string; appointment_id?: string;
}
interface Appointment { id: string; code: string; patientName: string; patientId?: string; patient_id?: string; status: string; scheduledDate: string; scheduledTime: string }
interface Treatment { id: string; name?: string; status: string; createdAt?: string }
interface Prescription { id: string; medication?: string; status?: string; createdAt?: string }
interface AdverseEvent { id: string; description?: string; createdAt?: string }
interface Referral { id: string; status: string; createdAt?: string }
interface ClinicalNote { id: string; soapSubjective?: string; soap_subjective?: string; signedAt?: string; signed_at?: string; createdAt?: string }

function useClinical<T>(key: string, path: string, enabled = true) {
  return useQuery({ queryKey: ["clinical", key], queryFn: () => api.get<T[]>(path), enabled });
}

/* ---------- New Encounter dialog (from an in-progress appointment) ---------- */
function NewEncounterDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { branchId } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const queue = useQuery({
    queryKey: ["appointments", "queue", today],
    queryFn: () => api.get<Appointment[]>(`/appointments?limit=50`),
    enabled: open,
  });
  const [apptId, setApptId] = useState("");
  const [complaint, setComplaint] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const appt = (queue.data ?? []).find((a) => a.id === apptId);
      const patientId = appt?.patientId ?? appt?.patient_id;
      return api.post<Encounter>("/clinical/encounters", {
        patientId, appointmentId: apptId || null, branchId, doctorId: user?.doctorId,
        chiefComplaint: complaint || null,
      });
    },
    onSuccess: (r) => {
      toast.success(`Encounter ${r.encounterCode ?? r.encounter_code ?? ""} opened`);
      qc.invalidateQueries({ queryKey: ["clinical"] });
      onCreated(r.id);
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to open encounter")),
  });

  const candidates = (queue.data ?? []).filter((a) => ["in-progress", "waiting", "checked-in", "confirmed"].includes(a.status));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Open Encounter</DialogTitle><DialogDescription>Start a clinical encounter from a queued appointment.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label>Appointment *</Label>
            <Select value={apptId} onValueChange={setApptId}>
              <SelectTrigger><SelectValue placeholder="Select queued appointment" /></SelectTrigger>
              <SelectContent>
                {candidates.map((a) => <SelectItem key={a.id} value={a.id}>{a.patientName} ({a.code}) — {a.status}</SelectItem>)}
                {!candidates.length && <SelectItem value="__none" disabled>No queued appointments today</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Chief complaint</Label>
            <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="e.g. Toothache lower left 3 days" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending || !apptId || apptId === "__none"}>
              {create.isPending ? "Opening…" : "Open Encounter"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- SOAP note dialog ---------- */
function SoapDialog({ open, onClose, encounter }: { open: boolean; onClose: () => void; encounter: Encounter | null }) {
  const { branchId } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [s, setS] = useState("");
  const [o, setO] = useState("");
  const [a, setA] = useState("");
  const [p, setP] = useState("");

  const notes = useQuery({
    queryKey: ["clinical", "notes", encounter?.id],
    queryFn: () => api.get<ClinicalNote[]>(`/clinical/notes?encounterId=${encounter!.id}`),
    enabled: open && !!encounter?.id,
  });

  const save = useMutation({
    mutationFn: () => api.post<ClinicalNote>("/clinical/notes", {
      encounterId: encounter!.id, branchId, doctorId: user?.doctorId,
      soapSubjective: s, soapObjective: o, soapAssessment: a, soapPlan: p,
    }),
    onSuccess: () => { toast.success("SOAP note saved"); qc.invalidateQueries({ queryKey: ["clinical"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Save failed")),
  });

  const sign = useMutation({
    mutationFn: (noteId: string) => api.post(`/clinical/notes/${noteId}/sign`, { branchId, doctorId: user?.doctorId }),
    onSuccess: () => { toast.success("Note signed"); qc.invalidateQueries({ queryKey: ["clinical"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Sign failed")),
  });

  const complete = useMutation({
    mutationFn: () => api.patch(`/clinical/encounters/${encounter!.id}/status`, { status: "completed", branchId, doctorId: user?.doctorId }),
    onSuccess: () => { toast.success("Encounter completed"); qc.invalidateQueries({ queryKey: ["clinical"] }); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Complete failed")),
  });

  if (!encounter) return null;
  const existing = (notes.data ?? [])[0];
  const signed = !!(existing?.signedAt ?? existing?.signed_at);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clinical Note — {encounter.patientName ?? "Patient"}</DialogTitle>
          <DialogDescription>{encounter.chiefComplaint ?? encounter.chief_complaint ?? "No complaint recorded"}</DialogDescription>
        </DialogHeader>

        {existing && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1">
            <p className="font-semibold text-emerald-700">Existing note {signed ? "(signed)" : "(draft)"}</p>
            <p><b>S:</b> {existing.soapSubjective ?? existing.soap_subjective}</p>
          </div>
        )}

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1.5"><Label>Subjective *</Label><Textarea required minLength={2} value={s} onChange={(e) => setS(e.target.value)} rows={2} placeholder="Patient's reported symptoms…" /></div>
          <div className="space-y-1.5"><Label>Objective *</Label><Textarea required minLength={2} value={o} onChange={(e) => setO(e.target.value)} rows={2} placeholder="Clinical findings on examination…" /></div>
          <div className="space-y-1.5"><Label>Assessment *</Label><Textarea required minLength={2} value={a} onChange={(e) => setA(e.target.value)} rows={2} placeholder="Diagnosis / assessment…" /></div>
          <div className="space-y-1.5"><Label>Plan *</Label><Textarea required minLength={2} value={p} onChange={(e) => setP(e.target.value)} rows={2} placeholder="Treatment plan, medication, review…" /></div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={save.isPending}>
              {save.isPending ? "Saving…" : existing ? "Save Amendment" : "Save Note"}
            </Button>
            {existing && !signed && (
              <Button type="button" className="bg-blue-600 hover:bg-blue-700" disabled={sign.isPending} onClick={() => sign.mutate(existing.id)}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Sign Note
              </Button>
            )}
            <Button type="button" className="bg-slate-700 hover:bg-slate-800" disabled={complete.isPending} onClick={() => complete.mutate()}>
              Complete Encounter
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Clinical page ---------- */
export default function Clinical() {
  const { user } = useAuth();
  const isDoctor = user?.role === "doctor";
  const encounters = useClinical<Encounter>("encounters", "/clinical/encounters?limit=50");
  const treatments = useClinical<Treatment>("treatments", "/clinical/treatments");
  const prescriptions = useClinical<Prescription>("prescriptions", "/clinical/prescriptions");
  const adverse = useClinical<AdverseEvent>("adverse", "/clinical/adverse-events");
  const referrals = useClinical<Referral>("referrals", "/clinical/referrals");

  const [showNew, setShowNew] = useState(false);
  const [activeEnc, setActiveEnc] = useState<Encounter | null>(null);
  const [soapOpen, setSoapOpen] = useState(false);

  const encRows = encounters.data ?? [];

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="Clinical"
        description={isDoctor ? "Encounters, SOAP notes, treatments, prescriptions" : "Treatments, prescriptions, adverse events, referrals"}
        actions={isDoctor && (
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Open Encounter
          </Button>
        )}
      />

      <Tabs defaultValue={isDoctor ? "encounters" : "treatments"}>
        <TabsList className="bg-white border">
          <TabsTrigger value="encounters"><FileText className="h-3.5 w-3.5 mr-1.5" />Encounters</TabsTrigger>
          <TabsTrigger value="treatments"><Stethoscope className="h-3.5 w-3.5 mr-1.5" />Treatments</TabsTrigger>
          <TabsTrigger value="prescriptions"><Pill className="h-3.5 w-3.5 mr-1.5" />Prescriptions</TabsTrigger>
          <TabsTrigger value="adverse"><AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Adverse Events</TabsTrigger>
          <TabsTrigger value="referrals"><Share2 className="h-3.5 w-3.5 mr-1.5" />Referrals</TabsTrigger>
        </TabsList>

        <TabsContent value="encounters" className="mt-4">
          <Panel>
            {encounters.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {encRows.map((e) => (
                <div key={e.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{e.patientName ?? "Patient"}</p>
                    <p className="text-xs text-slate-400">{e.encounterCode ?? e.encounter_code} · {fmtDateTime(e.startedAt ?? e.started_at)}</p>
                    {(e.chiefComplaint ?? e.chief_complaint) && <p className="text-xs text-slate-500 mt-0.5 truncate">{e.chiefComplaint ?? e.chief_complaint}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={e.status} />
                    {isDoctor && (
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => { setActiveEnc(e); setSoapOpen(true); }}>
                        SOAP / Complete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {!encounters.isLoading && !encRows.length && (
                <EmptyState title="No encounters" description={isDoctor ? "Open an encounter from today's queued appointments to begin." : "No clinical encounters recorded yet."} />
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="treatments" className="mt-4">
          <Panel>
            {treatments.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(treatments.data ?? []).map((t) => (
                <div key={t.id} className="py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{t.name ?? "Treatment"}</p>
                  <StatusBadge status={t.status} />
                </div>
              ))}
              {!treatments.isLoading && !(treatments.data ?? []).length && <EmptyState title="No treatments" description="Treatment catalog records will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="prescriptions" className="mt-4">
          <Panel>
            {prescriptions.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(prescriptions.data ?? []).map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{r.medication ?? "Prescription"}</p>
                  <span className="text-xs text-slate-400">{fmtDate(r.createdAt)}</span>
                </div>
              ))}
              {!prescriptions.isLoading && !(prescriptions.data ?? []).length && <EmptyState title="No prescriptions" description="Prescriptions created during encounters will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="adverse" className="mt-4">
          <Panel>
            {adverse.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(adverse.data ?? []).map((a) => (
                <div key={a.id} className="py-3">
                  <p className="text-sm text-slate-700">{a.description ?? "Adverse event"}</p>
                  <p className="text-xs text-slate-400">{fmtDate(a.createdAt)}</p>
                </div>
              ))}
              {!adverse.isLoading && !(adverse.data ?? []).length && <EmptyState title="No adverse events" description="Reported adverse events will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="referrals" className="mt-4">
          <Panel>
            {referrals.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(referrals.data ?? []).map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">Referral</p>
                  <StatusBadge status={r.status} />
                </div>
              ))}
              {!referrals.isLoading && !(referrals.data ?? []).length && <EmptyState title="No referrals" description="Patient referrals will appear here." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewEncounterDialog open={showNew} onClose={() => setShowNew(false)} onCreated={(id) => {
        const enc = (encounters.data ?? []).find((x) => x.id === id) ?? null;
        if (enc) { setActiveEnc(enc); setSoapOpen(true); }
      }} />
      <SoapDialog open={soapOpen} onClose={() => setSoapOpen(false)} encounter={activeEnc} />
    </div>
  );
}
