import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { useScope, withScope } from "@/hooks/useScope";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate } from "@/lib/format";
import { CheckSquare, ClipboardList, AlertOctagon, FlaskConical, Stethoscope, Plus } from "lucide-react";
import { toast } from "sonner";

interface Branch { id: string; name?: string; shortName?: string; fullName?: string }
interface DoctorStatus { id: string; doctorId: string; status: string; note?: string; effectiveAt?: string }
interface Checklist { id: string; title: string; checklistDate?: string; shift?: string; status: string; items?: Array<{ label: string; done: boolean }> }
interface Task { id: string; title: string; description?: string; priority: string; status: string; dueDate?: string }
interface Incident { id: string; title: string; description?: string; severity: string; status: string }
interface LabCase { id: string; labVendor: string; workDescription: string; dueDate?: string; status: string }
interface Patient { id: string; fullName?: string; name?: string; mrn?: string }

/* Rantaian status MESTI padan backend operations-lifecycle.ts.
 * Bug yang dibetulkan di sini: taskFlow dahulunya guna "done", tetapi backend
 * memerlukan "completed" — jadi klik "done" memulangkan 409 Illegal transition. */
const taskFlow: Record<string, string[]> = { open: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: [], cancelled: [] };
const incidentFlow: Record<string, string[]> = { open: ["acknowledged", "resolved", "closed"], acknowledged: ["resolved", "closed"], resolved: ["closed"], closed: [] };
const checklistFlow: Record<string, string[]> = { open: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: [], cancelled: [] };
const labCaseFlow: Record<string, string[]> = { open: ["in_progress", "cancelled"], in_progress: ["ready_for_billing", "cancelled"], ready_for_billing: ["billing_submitted", "cancelled"], billing_submitted: ["completed"], completed: [], cancelled: [] };
const doctorStatusOptions = ["available", "busy", "break", "offline"];

/* Label status dwibahasa. Setiap keadaan dalam lifecycle ada kunci i18n. */
const STATUS_KEY: Record<string, string> = {
  open: "ops.st.open", in_progress: "ops.st.inProgress", completed: "ops.st.completed",
  cancelled: "ops.st.cancelled", acknowledged: "ops.st.acknowledged", resolved: "ops.st.resolved",
  closed: "ops.st.closed", ready_for_billing: "ops.st.readyForBilling",
  billing_submitted: "ops.st.billingSubmitted", available: "ops.st.available",
  busy: "ops.st.busy", break: "ops.st.onBreak", offline: "ops.st.offline",
};

/**
 * Pemilih cawangan dalaman.
 *
 * Skema Zod backend (operations.service.ts) MEWAJIBKAN `branchId` dalam body,
 * dan guard kebenaran menilai skop `branch` daripada medan itu. `useBranch()`
 * memulangkan null untuk HQ apabila "All Branches" dipilih — jadi HQ tersekat
 * tanpa sebab yang kelihatan. Dialog ASK, dan jawapannya jadi sasaran.
 *
 * Pengguna cawangan tidak pernah nampak pemilih ini: cawangan mereka sudah tetap.
 */
function BranchPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = usePrefs();
  const { branchId: own } = useBranch();
  const branches = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Branch[]>("/admin/branches"),
    enabled: !own,
    staleTime: 10 * 60_000,
  });
  if (own) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground font-medium">{t("ops.whichBranch")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm">
          <SelectValue placeholder={t("ops.pickBranch")} />
        </SelectTrigger>
        <SelectContent>
          {(branches.data ?? []).map((b) => (
            <SelectItem key={b.id} value={b.id}>{b.name ?? b.fullName ?? b.shortName ?? b.id.slice(0, 8)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId: own } = useBranch();
  const [pickedBranch, setPickedBranch] = useState("");
  const effectiveBranchId = own ?? pickedBranch;
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", priority: "normal", dueDate: "" });
  const create = useMutation({
    mutationFn: () => api.post<Task>("/operations/tasks", {
      branchId: effectiveBranchId, title: form.title, description: form.description || null,
      priority: form.priority, dueDate: form.dueDate || null,
      idempotencyKey: `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
    onSuccess: () => { toast.success(t("ops.taskCreated")); qc.invalidateQueries({ queryKey: ["operations"] }); onClose(); setForm({ title: "", description: "", priority: "normal", dueDate: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("ops.newTask")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("ops.newTaskHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <BranchPicker value={pickedBranch} onChange={setPickedBranch} />
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.title")} *</Label>
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.description")}</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="rounded-xl border-border bg-card p-3" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("ops.priority")}</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{["urgent", "high", "normal", "low"].map((p) => <SelectItem key={p} value={p}>{t(`ops.prio.${p}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("ops.dueDate")}</Label>
              <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || !effectiveBranchId}>{create.isPending ? t("ops.saving") : t("ops.createTask")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewIncidentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId: own } = useBranch();
  const [pickedBranch, setPickedBranch] = useState("");
  const effectiveBranchId = own ?? pickedBranch;
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", severity: "medium" });
  const create = useMutation({
    mutationFn: () => api.post<Incident>("/operations/incidents", {
      branchId: effectiveBranchId, title: form.title, description: form.description || null, severity: form.severity,
      idempotencyKey: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
    onSuccess: () => { toast.success(t("ops.incidentReported")); qc.invalidateQueries({ queryKey: ["operations"] }); onClose(); setForm({ title: "", description: "", severity: "medium" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("ops.reportIncident")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("ops.reportIncidentHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <BranchPicker value={pickedBranch} onChange={setPickedBranch} />
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.title")} *</Label>
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.description")}</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="rounded-xl border-border bg-card p-3" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.severity")}</Label>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
              <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{["critical", "high", "medium", "low"].map((s) => <SelectItem key={s} value={s}>{t(`ops.sev.${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || !effectiveBranchId}>{create.isPending ? t("ops.saving") : t("ops.reportIncident")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewChecklistDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId: own } = useBranch();
  const [pickedBranch, setPickedBranch] = useState("");
  const effectiveBranchId = own ?? pickedBranch;
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [shift, setShift] = useState("");
  const [items, setItems] = useState<string[]>([""]);
  const create = useMutation({
    mutationFn: () => api.post<Checklist>("/operations/checklists", {
      branchId: effectiveBranchId, checklistDate: new Date().toISOString().slice(0, 10),
      shift: shift || null, title,
      items: items.filter((i) => i.trim()).map((label) => ({ label, done: false })),
    }),
    onSuccess: () => { toast.success(t("ops.checklistCreated")); qc.invalidateQueries({ queryKey: ["operations"] }); onClose(); setTitle(""); setShift(""); setItems([""]); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("ops.newChecklist")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("ops.newChecklistHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <BranchPicker value={pickedBranch} onChange={setPickedBranch} />
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.title")} *</Label>
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.shift")}</Label>
            <Input value={shift} onChange={(e) => setShift(e.target.value)} placeholder={t("ops.shiftPlaceholder")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.items")} *</Label>
            {items.map((it, i) => (
              <Input key={i} required value={it} className="rounded-xl border-border bg-card px-4 py-2.5 mb-2"
                onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            <Button type="button" size="sm" variant="outline" className="rounded-xl border-border text-foreground" onClick={() => setItems([...items, ""])}>
              <Plus className="h-3.5 w-3.5 mr-1" />{t("ops.addItem")}
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || !effectiveBranchId}>{create.isPending ? t("ops.saving") : t("ops.createChecklist")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewLabCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId: own } = useBranch();
  const [pickedBranch, setPickedBranch] = useState("");
  const effectiveBranchId = own ?? pickedBranch;
  const qc = useQueryClient();
  const [form, setForm] = useState({ patientId: "", labVendor: "", workDescription: "", dueDate: "" });
  const patients = useQuery({
    queryKey: ["operations", "patients-for-lab"],
    queryFn: () => api.get<Patient[]>(`/patients?limit=50&branchId=${effectiveBranchId}`),
    enabled: !!effectiveBranchId,
  });
  const create = useMutation({
    mutationFn: () => api.post<LabCase>("/operations/lab-cases", {
      branchId: effectiveBranchId, patientId: form.patientId, labVendor: form.labVendor,
      workDescription: form.workDescription, dueDate: form.dueDate || null,
      idempotencyKey: `lab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
    onSuccess: () => { toast.success(t("ops.labCaseCreated")); qc.invalidateQueries({ queryKey: ["operations"] }); onClose(); setForm({ patientId: "", labVendor: "", workDescription: "", dueDate: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("ops.newLabCase")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("ops.newLabCaseHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <BranchPicker value={pickedBranch} onChange={setPickedBranch} />
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.patient")} *</Label>
            <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
              <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue placeholder={t("ops.pickPatient")} /></SelectTrigger>
              <SelectContent>
                {(patients.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.fullName ?? p.name ?? p.mrn ?? p.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.labVendor")} *</Label>
            <Input required value={form.labVendor} onChange={(e) => setForm({ ...form, labVendor: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.workDescription")} *</Label>
            <Textarea required value={form.workDescription} onChange={(e) => setForm({ ...form, workDescription: e.target.value })} rows={2} className="rounded-xl border-border bg-card p-3" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("ops.dueDate")}</Label>
            <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || !effectiveBranchId || !form.patientId}>{create.isPending ? t("ops.saving") : t("ops.createLabCase")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Operations() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const scope = useScope();
  /* Skop cawangan (pemilik 10 Okt): pemilih cabang header kini betul-betul
   * menapis halaman Operasi — HQ di All Branches nampak semua, pilih satu
   * cawangan nampak cawangan itu sahaja. Backend semuanya sudah terima
   * branchId; frontend tidak pernah menghantarnya. */
  const { branchId } = useBranch();
  const opsScope = branchId ? `?branchId=${branchId}` : "";
  const doctorStatuses = useQuery({ queryKey: ["operations", "doctor-status", branchId], queryFn: () => api.get<DoctorStatus[]>(`/operations/doctor-status${opsScope}`) });
  const checklists = useQuery({ queryKey: ["operations", "checklists", branchId], queryFn: () => api.get<Checklist[]>(`/operations/checklists${opsScope}`) });
  const tasks = useQuery({ queryKey: ["operations", "tasks", branchId], queryFn: () => api.get<Task[]>(`/operations/tasks${opsScope}`) });
  const incidents = useQuery({ queryKey: ["operations", "incidents", branchId], queryFn: () => api.get<Incident[]>(`/operations/incidents${opsScope}`) });
  const labCases = useQuery({ queryKey: ["operations", "lab-cases", branchId], queryFn: () => api.get<LabCase[]>(`/operations/lab-cases${opsScope}`) });
  const doctors = useQuery({
    queryKey: ["operations", "doctors"],
    queryFn: () => api.get<Array<{ id: string; name?: string }>>(`/doctor-registration/doctors/list?branchId=${scope.branchId}`),
    enabled: !!scope.branchId && user?.role === "branch_manager",
  });

  const [showTask, setShowTask] = useState(false);
  const [showIncident, setShowIncident] = useState(false);
  /* TOMBOL MENGIKUTI TAB AKTIF (audit UX, sama seperti Finance): tab tasks →
   * Tugasan Baharu; tab incidents → Lapor Insiden; tab lain tiada tombol tulis
   * (checklist/lab/doctor mempunyai kawalan sendiri di panelnya). */
  const [opsTab, setOpsTab] = useState("tasks");
  const [showChecklist, setShowChecklist] = useState(false);
  const [showLab, setShowLab] = useState(false);

  /* Setiap PATCH status MESTI menghantar skop. Skema Zod backend mewajibkan
     `branchId`, dan guard kebenaran menilai skop `branch` daripada medan itu.
     Tanpa ia: 422 (Zod) atau 403 (guard) dengan mesej yang menyalahkan PERANAN,
     bukan medan yang hilang. Guna withScope() supaya ia tak boleh tertinggal lagi. */
  const taskStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/operations/tasks/${id}/status`, withScope(scope, { status })),
    onSuccess: () => { toast.success(t("ops.taskUpdated")); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.updateFailed"))),
  });
  const incidentStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/operations/incidents/${id}/status`, withScope(scope, { status })),
    onSuccess: () => { toast.success(t("ops.incidentUpdated")); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.updateFailed"))),
  });
  const checklistStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/operations/checklists/${id}/status`, withScope(scope, { status })),
    onSuccess: () => { toast.success(t("ops.checklistUpdated")); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.updateFailed"))),
  });
  const labCaseStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/operations/lab-cases/${id}/status`, withScope(scope, { status })),
    onSuccess: () => { toast.success(t("ops.labCaseUpdated")); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.updateFailed"))),
  });
  const doctorStatusUpdate = useMutation({
    mutationFn: ({ doctorId, status }: { doctorId: string; status: string }) => api.post(`/operations/doctor-status`, withScope(scope, { doctorId, status })),
    onSuccess: () => { toast.success(t("ops.doctorStatusUpdated")); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ops.updateFailed"))),
  });

  const taskRows = tasks.data ?? [];
  const incidentRows = incidents.data ?? [];
  const checklistRows = checklists.data ?? [];
  const labRows = labCases.data ?? [];
  const openTasks = taskRows.filter((x) => x.status !== "completed" && x.status !== "cancelled").length;

  /** Nama doktor: padan doctorId dengan senarai staf cawangan bila ada. */
  const doctorName = (id: string) => {
    const found = (doctors.data ?? []).find((d) => d.id === id);
    return found?.name ?? `${id.slice(0, 8)}…`;
  };

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("ops.title.page")}
        description={t("ops.desc")}
        actions={
          <div className="flex gap-2">
            {opsTab === "incidents" ? (
              <Button size="sm" variant="outline" className="rounded-xl border-border bg-card shadow-md text-foreground hover:bg-card" onClick={() => setShowIncident(true)}>
                <AlertOctagon className="h-4 w-4 mr-1.5" />{t("ops.reportIncident")}
              </Button>
            ) : opsTab === "tasks" ? (
              <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowTask(true)}>
                <Plus className="h-4 w-4 mr-1.5" />{t("ops.newTask")}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: t("ops.metric.openTasks"), value: openTasks, icon: <CheckSquare className="h-4 w-4" /> },
          { label: t("ops.metric.checklists"), value: checklistRows.length, icon: <ClipboardList className="h-4 w-4" /> },
          { label: t("ops.metric.incidents"), value: incidentRows.length, icon: <AlertOctagon className="h-4 w-4" /> },
          { label: t("ops.metric.labCases"), value: labRows.length, icon: <FlaskConical className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              {k.label}
              <span className="text-foreground bg-accent rounded-xl p-1.5 ring-1 ring-teal-200">{k.icon}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs value={opsTab} onValueChange={setOpsTab}>
        <TabsList className="bg-card border border-border rounded-lg p-1 shadow-md flex flex-wrap gap-1">
          <TabsTrigger value="tasks" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <CheckSquare className="h-3.5 w-3.5 mr-1.5" />{t("ops.tab.tasks")}
          </TabsTrigger>
          <TabsTrigger value="checklists" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" />{t("ops.tab.checklists")}
          </TabsTrigger>
          <TabsTrigger value="incidents" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <AlertOctagon className="h-3.5 w-3.5 mr-1.5" />{t("ops.tab.incidents")}
          </TabsTrigger>
          <TabsTrigger value="lab" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />{t("ops.tab.lab")}
          </TabsTrigger>
          <TabsTrigger value="doctor" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Stethoscope className="h-3.5 w-3.5 mr-1.5" />{t("ops.tab.doctor")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4"><p className="text-xs text-muted-foreground -mt-1 mb-2">{t("ops.tasksSub")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {tasks.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {taskRows.map((x) => (
                <div key={x.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{x.title}</p>
                    <p className="text-xs text-muted-foreground">{t(`ops.prio.${x.priority}`)}{x.dueDate ? ` · ${t("ops.due")} ${fmtDate(x.dueDate)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={x.status} statusText={t(STATUS_KEY[x.status] ?? "ops.st.open")} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    {(taskFlow[x.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={taskStatus.isPending} onClick={() => taskStatus.mutate({ id: x.id, status: next })}>{t(STATUS_KEY[next] ?? "ops.st.open")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!tasks.isLoading && !taskRows.length && <EmptyState title={t("ops.empty.tasks")} description={t("ops.empty.tasksHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="checklists" className="mt-4"><p className="text-xs text-muted-foreground -mt-1 mb-2">{t("ops.checklistsSub")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            <div className="flex justify-end mb-3">
              <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowChecklist(true)}>
                <Plus className="h-4 w-4 mr-1.5" />{t("ops.newChecklist")}
              </Button>
            </div>
            {checklists.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {checklistRows.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(c.checklistDate)}{c.shift ? ` · ${c.shift}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} statusText={t(STATUS_KEY[c.status] ?? "ops.st.open")} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    {(checklistFlow[c.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={checklistStatus.isPending} onClick={() => checklistStatus.mutate({ id: c.id, status: next })}>{t(STATUS_KEY[next] ?? "ops.st.open")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!checklists.isLoading && !checklistRows.length && <EmptyState title={t("ops.empty.checklists")} description={t("ops.empty.checklistsHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="incidents" className="mt-4"><p className="text-xs text-muted-foreground -mt-1 mb-2">{t("ops.incidentsSub")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {incidents.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {incidentRows.map((i) => (
                <div key={i.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{i.title}</p>
                    <p className="text-xs text-muted-foreground">{t("ops.severity")}: {t(`ops.sev.${i.severity}`)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={i.status} statusText={t(STATUS_KEY[i.status] ?? "ops.st.open")} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    {(incidentFlow[i.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={incidentStatus.isPending} onClick={() => incidentStatus.mutate({ id: i.id, status: next })}>{t(STATUS_KEY[next] ?? "ops.st.open")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!incidents.isLoading && !incidentRows.length && <EmptyState title={t("ops.empty.incidents")} description={t("ops.empty.incidentsHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="lab" className="mt-4"><p className="text-xs text-muted-foreground -mt-1 mb-2">{t("ops.labSub")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            <div className="flex justify-end mb-3">
              <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowLab(true)}>
                <Plus className="h-4 w-4 mr-1.5" />{t("ops.newLabCase")}
              </Button>
            </div>
            {labCases.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {labRows.map((l) => (
                <div key={l.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{l.labVendor}</p>
                    <p className="text-xs text-muted-foreground truncate">{l.workDescription}{l.dueDate ? ` · ${t("ops.due")} ${fmtDate(l.dueDate)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={l.status} statusText={t(STATUS_KEY[l.status] ?? "ops.st.open")} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    {(labCaseFlow[l.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={labCaseStatus.isPending} onClick={() => labCaseStatus.mutate({ id: l.id, status: next })}>{t(STATUS_KEY[next] ?? "ops.st.open")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!labCases.isLoading && !labRows.length && <EmptyState title={t("ops.empty.lab")} description={t("ops.empty.labHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="doctor" className="mt-4"><p className="text-xs text-muted-foreground -mt-1 mb-2">{t("ops.doctorSub")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {doctorStatuses.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(doctorStatuses.data ?? []).map((d) => (
                <div key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{doctorName(d.doctorId)}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={d.status} statusText={t(STATUS_KEY[d.status] ?? "ops.st.available")} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    <Select value={d.status} onValueChange={(v) => doctorStatusUpdate.mutate({ doctorId: d.doctorId, status: v })}>
                      <SelectTrigger className="w-40 h-8 rounded-xl border-border bg-card text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{doctorStatusOptions.map((s) => <SelectItem key={s} value={s} className="text-xs">{t(STATUS_KEY[s] ?? "ops.st.available")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
              {!doctorStatuses.isLoading && !(doctorStatuses.data ?? []).length && <EmptyState title={t("ops.empty.doctor")} description={t("ops.empty.doctorHint")} />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewTaskDialog open={showTask} onClose={() => setShowTask(false)} />
      <NewIncidentDialog open={showIncident} onClose={() => setShowIncident(false)} />
      <NewChecklistDialog open={showChecklist} onClose={() => setShowChecklist(false)} />
      <NewLabCaseDialog open={showLab} onClose={() => setShowLab(false)} />
    </div>
  );
}
