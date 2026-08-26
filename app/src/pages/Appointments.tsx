import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader, StatusBadge, Panel, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface Appointment {
  id: string; code: string; patientName: string; doctorId: string | null;
  scheduledDate: string; scheduledTime: string; status: string; branchId: string;
}
interface Staff { id: string; name: string; role: string }
interface Patient { id: string; name: string; mrn: string }

const statusFlow: Record<string, string[]> = {
  booked: ["confirmed", "cancelled", "no-show"],
  confirmed: ["checked-in", "cancelled", "no-show"],
  "checked-in": ["in-progress", "cancelled"],
  "in-progress": ["completed"],
  completed: [], cancelled: [], "no-show": [],
};

function BookingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const patients = useQuery({ queryKey: ["patients", "all"], queryFn: () => api.get<Patient[]>("/patients?limit=100") });
  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: async () => (await api.get<Staff[]>("/admin/staff?role=doctor")).filter((s) => s.role === "doctor"),
  });
  const [form, setForm] = useState({ patientId: "", doctorId: "", scheduledDate: "", scheduledTime: "", notes: "" });

  const book = useMutation({
    mutationFn: () => {
      const patient = (patients.data ?? []).find((p) => p.id === form.patientId);
      return api.post<Appointment>("/appointments", {
        patientId: form.patientId, patientName: patient?.name ?? "",
        doctorId: form.doctorId || null,
        scheduledDate: form.scheduledDate, scheduledTime: form.scheduledTime,
        notes: form.notes || null,
      });
    },
    onSuccess: () => { toast.success("Appointment booked"); qc.invalidateQueries({ queryKey: ["appointments"] }); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Booking failed")),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Book Appointment</DialogTitle><DialogDescription>Create a new appointment.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); book.mutate(); }}>
          <div className="space-y-1.5">
            <Label>Patient *</Label>
            <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
              <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
              <SelectContent>{(patients.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.mrn})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Doctor</Label>
            <Select value={form.doctorId} onValueChange={(v) => setForm({ ...form, doctorId: v })}>
              <SelectTrigger><SelectValue placeholder="Assign doctor (optional)" /></SelectTrigger>
              <SelectContent>{(doctors.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date *</Label><Input required type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Time *</Label><Input required type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={book.isPending || !form.patientId}>Book</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Appointments() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showBook, setShowBook] = useState(false);
  const pageSize = 20;

  const list = useQuery({
    queryKey: ["appointments", "list", page],
    queryFn: () => api.get<Appointment[]>(`/appointments?limit=${pageSize}&offset=${(page - 1) * pageSize}`),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/appointments/${id}/status`, { status }),
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["appointments"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Update failed")),
  });

  const rows = list.data ?? [];
  const hasMore = rows.length === pageSize;
  const canBook = ["hq", "branch_manager", "branch_admin", "receptionist"].includes(user?.role ?? "");

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="Appointments"
        description="Production appointment schedule"
        actions={canBook && (
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowBook(true)}>
            <CalendarPlus className="h-4 w-4 mr-1.5" /> Book Appointment
          </Button>
        )}
      />

      <Panel>
        <div className="divide-y divide-slate-100">
          {list.isLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full my-2" />)}
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-4 py-3">
              <div className="w-32">
                <p className="text-sm font-semibold text-slate-800">{a.scheduledDate}</p>
                <p className="text-xs text-slate-400">{a.scheduledTime}</p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">{a.patientName}</p>
                <p className="text-xs text-slate-400 font-mono">{a.code}</p>
              </div>
              <StatusBadge status={a.status} />
              <div className="flex gap-1">
                {(statusFlow[a.status] ?? []).map((next) => (
                  <Button key={next} size="sm" variant="outline" className="text-xs"
                    onClick={() => changeStatus.mutate({ id: a.id, status: next })} disabled={changeStatus.isPending}>
                    {next}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {!list.isLoading && !rows.length && <EmptyState title="No appointments" description="Book the first appointment to get started." />}
        </div>
      </Panel>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Page {page}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /> Prev</Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <BookingDialog open={showBook} onClose={() => setShowBook(false)} />
    </div>
  );
}
