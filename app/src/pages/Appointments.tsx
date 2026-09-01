import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface Appointment {
  id: string;
  code: string;
  patientName: string;
  doctorId: string | null;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  branchId: string;
}

interface Staff {
  id: string;
  name: string;
  role: string;
}

interface Patient {
  id: string;
  name: string;
  mrn: string;
}

const GRAD = "linear-gradient(135deg, #0DC9B7, #12B5E5)";

const statusFlow: Record<string, string[]> = {
  booked: ["confirmed", "cancelled", "no-show"],
  confirmed: ["checked-in", "cancelled", "no-show"],
  "checked-in": ["waiting", "cancelled"],
  "in-progress": ["completed"],
  completed: [],
  cancelled: [],
  "no-show": [],
};

const statusStyle: Record<string, { bg: string; color: string; label: string }> = {
  booked: { bg: "#f8fafc", color: "#64748b", label: "Ditempah" },
  confirmed: { bg: "#f0fdfa", color: "#0d9488", label: "Disahkan" },
  "checked-in": { bg: "#eff6ff", color: "#2563eb", label: "Daftar Masuk" },
  "in-progress": { bg: "#f5f3ff", color: "#7c3aed", label: "Sedang Rawat" },
  completed: { bg: "#f0fdfa", color: "#0d9488", label: "Selesai" },
  cancelled: { bg: "#fff1f2", color: "#e11d48", label: "Dibatal" },
  "no-show": { bg: "#fffbeb", color: "#d97706", label: "Tak Hadir" },
};

const statusLabel: Record<string, string> = {
  confirmed: "Sahkan",
  waiting: "Mula Rawat",
  cancelled: "Batal",
  "no-show": "Tak Hadir",
  "checked-in": "Daftar Masuk",
  "in-progress": "Mula Rawat",
  completed: "Selesai",
};

function getBookingSlots(date: string): string[] {
  if (!date) return [];

  const day = new Date(`${date}T00:00:00`).getDay();
  const closingHour = day === 5 || day === 6 ? 17 : 21;
  const slots: string[] = [];

  for (let minutes = 10 * 60; minutes < closingHour * 60; minutes += 30) {
    if (minutes >= 13 * 60 && minutes < 14 * 60) continue;

    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    slots.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  }

  return slots;
}

function BookingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const patients = useQuery({
    queryKey: ["patients", "all"],
    queryFn: () => api.get<Patient[]>("/patients?limit=100"),
  });

  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: async () =>
      (await api.get<Staff[]>("/admin/staff?role=doctor")).filter(
        (s) => s.role === "doctor",
      ),
    enabled: user?.role === "hq",
  });

  const [form, setForm] = useState({
    patientId: "",
    doctorId: "",
    scheduledDate: "",
    scheduledTime: "",
    notes: "",
  });

  const slots = getBookingSlots(form.scheduledDate);

  const dayAppointments = useQuery({
    queryKey: ["appointments", "slots", form.scheduledDate],
    queryFn: () =>
      api.get<Appointment[]>(
        `/appointments?dateFrom=${form.scheduledDate}&dateTo=${form.scheduledDate}&limit=100`,
      ),
    enabled: Boolean(form.scheduledDate),
  });

  const occupiedSlots = new Set(
    (dayAppointments.data ?? [])
      .filter((appointment) =>
        !["cancelled", "no-show"].includes(appointment.status),
      )
      .map((appointment) => appointment.scheduledTime.slice(0, 5)),
  );

  const book = useMutation({
    mutationFn: () => {
      const patient = (patients.data ?? []).find(
        (p) => p.id === form.patientId,
      );

      return api.post<Appointment>("/appointments", {
        patientId: form.patientId,
        patientName: patient?.name ?? "",
        doctorId: form.doctorId || null,
        scheduledDate: form.scheduledDate,
        scheduledTime: form.scheduledTime,
        notes: form.notes || null,
      });
    },
    onSuccess: () => {
      toast.success("Appointment ditempah");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(errorMessage(e, "Tempahan gagal")),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tempah Appointment</DialogTitle>
          <DialogDescription>
            Pilih tarikh dan slot masa yang tersedia.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            book.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>Pesakit *</Label>
            <Select
              value={form.patientId}
              onValueChange={(v) => setForm({ ...form, patientId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih pesakit" />
              </SelectTrigger>
              <SelectContent>
                {(patients.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.mrn})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Doktor</Label>
            <Select
              value={form.doctorId}
              onValueChange={(v) => setForm({ ...form, doctorId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tetapkan doktor (pilihan)" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tarikh *</Label>
              <Input
                required
                type="date"
                value={form.scheduledDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scheduledDate: e.target.value,
                    scheduledTime: "",
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Masa *</Label>
              <Select
                value={form.scheduledTime}
                onValueChange={(v) =>
                  setForm({ ...form, scheduledTime: v })
                }
                disabled={!form.scheduledDate}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      form.scheduledDate
                        ? "Pilih slot masa"
                        : "Pilih tarikh dahulu"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((slot) => (
                    <SelectItem
                      key={slot}
                      value={slot}
                      disabled={occupiedSlots.has(slot)}
                    >
                      {slot}{occupiedSlots.has(slot) ? " — Penuh" : " — Tersedia"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Ahad–Khamis: 10:00–21:00 · Jumaat–Sabtu: 10:00–17:00 · Rehat:
            13:00–14:00
          </p>

          <div className="space-y-1.5">
            <Label>Nota</Label>
            <Input
              value={form.notes}
              onChange={(e) =>
                setForm({ ...form, notes: e.target.value })
              }
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>

            <Button
              type="submit"
              style={{ background: GRAD }}
              className="text-white"
              disabled={
                book.isPending ||
                !form.patientId ||
                !form.scheduledDate ||
                !form.scheduledTime
              }
            >
              Tempah
            </Button>
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
  const [view, setView] = useState<'day' | 'week' | 'month' | 'list' | 'queue'>('day');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const pageSize = 20;

  const list = useQuery({
    queryKey: ["appointments", "list", page],
    queryFn: () =>
      api.get<Appointment[]>(
        `/appointments?limit=${pageSize}&offset=${(page - 1) * pageSize}`,
      ),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/appointments/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Status dikemaskini");
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (e: unknown) =>
      toast.error(errorMessage(e, "Kemaskini gagal")),
  });

  const rows = list.data ?? [];
  const displayRows = view === 'day'
    ? rows.filter((appointment) => appointment.scheduledDate.slice(0, 10) === selectedDate)
    : rows;
  const hasMore = rows.length === pageSize;
  const canBook = [
    "hq",
    "branch_manager",
    "branch_admin",
    "receptionist",
  ].includes(user?.role ?? "");

  return (
    <div className="space-y-6" style={{ animation: "fadeIn .25s ease" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            className="text-[24px] font-bold"
            style={{
              color: "#0B132B",
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            Appointments
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {displayRows.length} appointments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600">
            Export
          </button>
        {canBook && (
          <button
            onClick={() => setShowBook(true)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition"
            style={{
              background: GRAD,
              boxShadow: "0 6px 16px -4px rgba(13,201,183,.4)",
            }}
          >
            <CalendarPlus className="h-4 w-4" />
            Tempah Appointment
          </button>
        )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['day', 'week', 'month', 'list', 'queue'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setView(item)}
                className="rounded-full border px-4 py-2 text-[13px] font-semibold capitalize transition"
                style={view === item
                  ? { background: GRAD, borderColor: 'transparent', color: 'white', boxShadow: '0 6px 16px -4px rgba(13,201,183,.35)' }
                  : { background: 'white', borderColor: '#e2e8f0', color: '#64748b' }}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-500" onClick={() => setSelectedDate(new Date(new Date(selectedDate).setDate(new Date(selectedDate).getDate() - 1)).toISOString().slice(0, 10))}>‹</button>
            <span className="min-w-[120px] text-center text-sm font-semibold text-slate-600">{selectedDate}</span>
            <button className="rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-500" onClick={() => setSelectedDate(new Date(new Date(selectedDate).setDate(new Date(selectedDate).getDate() + 1)).toISOString().slice(0, 10))}>›</button>
            <button className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600" onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}>Today</button>
          </div>
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : displayRows.length === 0 ? (
        <div
          className="rounded-2xl border border-slate-100 bg-white/80 p-12 text-center"
          style={{ backdropFilter: "blur(12px)" }}
        >
          <p className="font-semibold text-slate-700">
            Tiada appointment
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Tempah appointment pertama untuk mula.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayRows.map((a) => {
            const st = statusStyle[a.status] ?? {
              bg: "#f8fafc",
              color: "#64748b",
              label: a.status,
            };

            return (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-100 p-4"
                style={{
                  background: "rgba(255,255,255,0.85)",
                  backdropFilter: "blur(12px)",
                  boxShadow:
                    "0 4px 24px -6px rgba(15,23,42,0.08)",
                }}
              >
                <div
                  className="shrink-0 rounded-xl px-3 py-2 text-center"
                  style={{ background: "#f0fdfa" }}
                >
                  <p
                    className="text-[13px] font-bold"
                    style={{ color: "#0d9488" }}
                  >
                    {a.scheduledDate}
                  </p>
                  <p
                    className="text-[11px]"
                    style={{ color: "#0d9488" }}
                  >
                    {a.scheduledTime}
                  </p>
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[14px] font-bold"
                    style={{ color: "#0B132B" }}
                  >
                    {a.patientName}
                  </p>
                  <p className="font-mono text-xs text-slate-400">
                    {a.code}
                  </p>
                </div>

                <span
                  className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: st.bg,
                    color: st.color,
                  }}
                >
                  {st.label}
                </span>

                <div className="flex flex-wrap gap-1.5">
                  {(statusFlow[a.status] ?? []).map((next) => (
                    <button
                      key={next}
                      onClick={() =>
                        changeStatus.mutate({
                          id: a.id,
                          status: next,
                        })
                      }
                      disabled={changeStatus.isPending}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {statusLabel[next] ?? next}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Halaman {page}</p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Sebelum
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => setPage(page + 1)}
          >
            Seterusnya
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <BookingDialog
        open={showBook}
        onClose={() => setShowBook(false)}
      />
    </div>
  );
}
