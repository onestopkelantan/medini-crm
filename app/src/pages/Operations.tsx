import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
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
import { fmtDate } from "@/lib/format";
import { CheckSquare, ClipboardList, AlertOctagon, FlaskConical, Stethoscope, Plus } from "lucide-react";
import { toast } from "sonner";

interface DoctorStatus { id: string; doctorId: string; status: string; note?: string; effectiveAt?: string }
interface Checklist { id: string; title: string; checklistDate?: string; shift?: string; status: string; items?: Array<{ label: string; done: boolean }> }
interface Task { id: string; title: string; description?: string; priority: string; status: string; dueDate?: string }
interface Incident { id: string; title: string; description?: string; severity: string; status: string }
interface LabCase { id: string; labVendor: string; workDescription: string; dueDate?: string; status: string }

const taskFlow: Record<string, string[]> = { open: ["in_progress", "cancelled"], in_progress: ["done", "cancelled"], done: [], cancelled: [] };
const incidentFlow: Record<string, string[]> = { open: ["acknowledged", "resolved"], acknowledged: ["resolved", "closed"], resolved: ["closed"], closed: [] };

function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", priority: "normal", dueDate: "" });
  const create = useMutation({
    mutationFn: () => api.post<Task>("/operations/tasks", {
      branchId, title: form.title, description: form.description || null,
      priority: form.priority, dueDate: form.dueDate || null,
      idempotencyKey: `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
    onSuccess: () => { toast.success("Task created"); qc.invalidateQueries({ queryKey: ["operations"] }); onClose(); setForm({ title: "", description: "", priority: "normal", dueDate: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to create task")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Task</DialogTitle><DialogDescription>Create an operational task for the branch team.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Title *</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["urgent", "high", "normal", "low"].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Due date</Label><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create Task"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewIncidentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", severity: "medium" });
  const create = useMutation({
    mutationFn: () => api.post<Incident>("/operations/incidents", {
      branchId, title: form.title, description: form.description || null, severity: form.severity,
      idempotencyKey: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
    onSuccess: () => { toast.success("Incident reported"); qc.invalidateQueries({ queryKey: ["operations"] }); onClose(); setForm({ title: "", description: "", severity: "medium" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to report incident")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Report Incident</DialogTitle><DialogDescription>Log an operational incident for tracking and resolution.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Title *</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
          <div className="space-y-1.5"><Label>Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["critical", "high", "medium", "low"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Reporting…" : "Report Incident"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Operations() {
  const qc = useQueryClient();
  const doctorStatus = useQuery({ queryKey: ["operations", "doctor-status"], queryFn: () => api.get<DoctorStatus[]>("/operations/doctor-status") });
  const checklists = useQuery({ queryKey: ["operations", "checklists"], queryFn: () => api.get<Checklist[]>("/operations/checklists") });
  const tasks = useQuery({ queryKey: ["operations", "tasks"], queryFn: () => api.get<Task[]>("/operations/tasks") });
  const incidents = useQuery({ queryKey: ["operations", "incidents"], queryFn: () => api.get<Incident[]>("/operations/incidents") });
  const labCases = useQuery({ queryKey: ["operations", "lab-cases"], queryFn: () => api.get<LabCase[]>("/operations/lab-cases") });

  const [showTask, setShowTask] = useState(false);
  const [showIncident, setShowIncident] = useState(false);

  const taskStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/operations/tasks/${id}/status`, { status }),
    onSuccess: () => { toast.success("Task updated"); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Update failed")),
  });
  const incidentStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/operations/incidents/${id}/status`, { status }),
    onSuccess: () => { toast.success("Incident updated"); qc.invalidateQueries({ queryKey: ["operations"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Update failed")),
  });

  const taskRows = tasks.data ?? [];
  const incidentRows = incidents.data ?? [];
  const openTasks = taskRows.filter((t) => t.status !== "done" && t.status !== "cancelled").length;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="Operations"
        description="Tasks, checklists, incidents, lab cases and doctor availability"
        actions={<div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowIncident(true)}><AlertOctagon className="h-4 w-4 mr-1.5" /> Report Incident</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowTask(true)}><Plus className="h-4 w-4 mr-1.5" /> New Task</Button>
        </div>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Open Tasks", value: openTasks, icon: <CheckSquare className="h-4 w-4" /> },
          { label: "Checklists", value: (checklists.data ?? []).length, icon: <ClipboardList className="h-4 w-4" /> },
          { label: "Incidents", value: incidentRows.length, icon: <AlertOctagon className="h-4 w-4" /> },
          { label: "Lab Cases", value: (labCases.data ?? []).length, icon: <FlaskConical className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium">{k.label}<span className="text-emerald-600 bg-emerald-50 rounded-lg p-1.5">{k.icon}</span></div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="tasks">
        <TabsList className="bg-white border">
          <TabsTrigger value="tasks"><CheckSquare className="h-3.5 w-3.5 mr-1.5" />Tasks</TabsTrigger>
          <TabsTrigger value="checklists"><ClipboardList className="h-3.5 w-3.5 mr-1.5" />Checklists</TabsTrigger>
          <TabsTrigger value="incidents"><AlertOctagon className="h-3.5 w-3.5 mr-1.5" />Incidents</TabsTrigger>
          <TabsTrigger value="lab"><FlaskConical className="h-3.5 w-3.5 mr-1.5" />Lab Cases</TabsTrigger>
          <TabsTrigger value="doctor"><Stethoscope className="h-3.5 w-3.5 mr-1.5" />Doctor Status</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <Panel>
            {tasks.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {taskRows.map((t) => (
                <div key={t.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{t.title}</p>
                    <p className="text-xs text-slate-400 capitalize">{t.priority}{t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={t.status} />
                    {(taskFlow[t.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs" disabled={taskStatus.isPending} onClick={() => taskStatus.mutate({ id: t.id, status: next })}>{next.replace(/_/g, " ")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!tasks.isLoading && !taskRows.length && <EmptyState title="No tasks" description="Create the first operational task for the team." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="checklists" className="mt-4">
          <Panel>
            {checklists.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(checklists.data ?? []).map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.title}</p>
                    <p className="text-xs text-slate-400">{fmtDate(c.checklistDate)}{c.shift ? ` · ${c.shift}` : ""}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
              {!checklists.isLoading && !(checklists.data ?? []).length && <EmptyState title="No checklists" description="Daily opening/closing checklists will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          <Panel>
            {incidents.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {incidentRows.map((i) => (
                <div key={i.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{i.title}</p>
                    <p className="text-xs text-slate-400 capitalize">severity: {i.severity}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={i.status} />
                    {(incidentFlow[i.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs" disabled={incidentStatus.isPending} onClick={() => incidentStatus.mutate({ id: i.id, status: next })}>{next}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!incidents.isLoading && !incidentRows.length && <EmptyState title="No incidents" description="Reported operational incidents will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="lab" className="mt-4">
          <Panel>
            {labCases.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(labCases.data ?? []).map((l) => (
                <div key={l.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{l.labVendor}</p>
                    <p className="text-xs text-slate-400 truncate">{l.workDescription}{l.dueDate ? ` · due ${fmtDate(l.dueDate)}` : ""}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
              ))}
              {!labCases.isLoading && !(labCases.data ?? []).length && <EmptyState title="No lab cases" description="Dental lab work orders will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="doctor" className="mt-4">
          <Panel>
            {doctorStatus.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(doctorStatus.data ?? []).map((d) => (
                <div key={d.id} className="py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">Dr. {d.doctorId.slice(0, 8)}…</p>
                  <StatusBadge status={d.status} />
                </div>
              ))}
              {!doctorStatus.isLoading && !(doctorStatus.data ?? []).length && <EmptyState title="No doctor status" description="Doctor availability statuses will appear here." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewTaskDialog open={showTask} onClose={() => setShowTask(false)} />
      <NewIncidentDialog open={showIncident} onClose={() => setShowIncident(false)} />
    </div>
  );
}
