/**
 * Waitlist — FASA E (0027). "Senarai Menunggu".
 *
 * THE SCREEN IN ONE LINE
 * A registered patient who could not get a slot tells us WHEN they would
 * come; this screen records and manages those wishes. When a cancellation
 * frees a slot (E6), Booking AI offers it to the best match here.
 *
 * SHAPE FOLLOWS THE REFERENCE (dental-erp /appointments/waitlist, 515 lines):
 * three stat cards on top (active / notified / booked), a filterable table
 * under, an "add" dialog that searches a registered patient (patientId is
 * REQUIRED — the reference takes no walk-ins), day chips, a time band and an
 * optional preferred doctor. Delete is a confirm dialog, not a bare button.
 *
 * WHY A SEPARATE PAGE AND NOT A TAB IN APPOINTMENTS
 * The owner picked the reference's shape (its own nav entry), and
 * Appointments.tsx is already 1.5k lines — a fifth panel there would bury
 * the queue.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useBranch } from "@/hooks/useBranch";
import { useScope } from "@/hooks/useScope";
import { PageHeader, StatCard, Panel, EmptyState, StatusBadge , BackLink } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hourglass, Plus, Users, Bell, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface WaitlistEntry {
  id: string;
  branchId: string;
  patientId: string | null;
  doctorId: string | null;
  preferredDays: string[] | null;
  preferredTime: "morning" | "afternoon" | "evening" | null;
  notes: string | null;
  status: "active" | "notified" | "booked" | "cancelled" | "expired";
  notifiedAt: string | null;
  bookedAt: string | null;
  createdAt: string;
}

interface WaitlistResponse {
  entries: WaitlistEntry[];
  stats: { active: number; notified: number; booked: number };
}

interface PatientRow {
  id: string; mrn: string; name: string; dob: string | null;
}

interface DoctorRow {
  id: string; name: string | null;
}

const DAY_KEYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const TIME_KEYS = ["morning", "afternoon", "evening"] as const;

/* Nama hari boleh sampai sebagai enum Inggeris (SATURDAY) ATAU teks BM
 * ("Sabtu") dari data luar/demo — normalisasikan ke kunci i18n supaya
 * label tidak bocor sebagai "wl.day.Sabtu". */
const DAY_ALIAS: Record<string, string> = {
  monday: "MONDAY", isnin: "MONDAY", selasa: "TUESDAY", tuesday: "TUESDAY",
  wednesday: "WEDNESDAY", rabu: "WEDNESDAY", thursday: "THURSDAY", khamis: "THURSDAY",
  friday: "FRIDAY", jumaat: "FRIDAY", saturday: "SATURDAY", sabtu: "SATURDAY",
  sunday: "SUNDAY", ahad: "SUNDAY",
};
function dayKey(d: string): string {
  const up = d.toUpperCase();
  if (DAY_KEYS.includes(up as (typeof DAY_KEYS)[number])) return up;
  return DAY_ALIAS[d.trim().toLowerCase()] ?? up;
}

export default function Waitlist() {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const scope = useScope();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<WaitlistEntry | null>(null);

  const list = useQuery({
    queryKey: ["waitlist", branchId, statusFilter],
    queryFn: () => api.get<WaitlistResponse>(
      `/appointments/waitlist?${statusFilter !== "all" ? `status=${statusFilter}` : ""}${branchId ? `&branchId=${branchId}` : ""}`,
    ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => {
      /* DELETE carries no body; the scope guard only needs it on create/edit,
       * and a doctor's delete of their own branch row is permitted by the
       * appointments matrix without an explicit doctorId. */
      return api.del(`/appointments/waitlist/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waitlist"] });
      setConfirmRemove(null);
      toast.success(t("wl.removed"));
    },
    onError: () => toast.error(t("wl.removeFailed")),
  });

  const notify = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/waitlist/${id}/status`, { ...scope, status: "notified" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waitlist"] });
      toast.success(t("wl.notifiedDone"));
    },
    onError: () => toast.error(t("wl.actionFailed")),
  });

  const markBooked = useMutation({
    mutationFn: (id: string) => api.patch(`/appointments/waitlist/${id}/status`, { ...scope, status: "booked" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waitlist"] });
      toast.success(t("wl.bookedDone"));
    },
    onError: () => toast.error(t("wl.actionFailed")),
  });

  const entries = list.data?.entries ?? [];

  /* Nama pesakit untuk baris senarai tunggu — API hanya pulangkan
   * patientId; paparkan nama manusia, bukan UUID (bug dilihat pemilik
   * semasa demo: "Patient de000001…"). Satu query senarai pesakit
   * dipeta kepada id->nama. */
  const patientDirectory = useQuery({
    queryKey: ["patients", "directory"],
    queryFn: () => api.get<{ id: string; name: string | null; mrn?: string }[]>("/patients?limit=500"),
    staleTime: 5 * 60 * 1000,
  });
  const patientNameById = new Map(
    (patientDirectory.data ?? []).map((p) => [p.id, p.name ?? "—"]),
  );
  const stats = list.data?.stats ?? { active: 0, notified: 0, booked: 0 };

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("wl.title")}
        description={t("wl.desc")}
        actions={
          <div className="flex items-center gap-3">
          <BackLink to="/appointments" />
          <Button
            size="sm"
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" /> {t("wl.add")}
          </Button>
          </div>
        }
      />

      {/* ---- stat cards (the three numbers the reference screen leads with) ---- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title={t("wl.statActive")} value={stats.active} icon={<Hourglass className="h-4 w-4" />} loading={list.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
        <StatCard title={t("wl.statNotified")} value={stats.notified} icon={<Bell className="h-4 w-4" />} loading={list.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
        <StatCard title={t("wl.statBooked")} value={stats.booked} icon={<CheckCircle2 className="h-4 w-4" />} loading={list.isLoading} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4" />
      </div>

      {/* ---- the table ---- */}
      <Panel title={t("wl.title")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
        action={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 rounded-xl border-border bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("wl.filterAll")}</SelectItem>
              <SelectItem value="active">{t("wl.stActive")}</SelectItem>
              <SelectItem value="notified">{t("wl.stNotified")}</SelectItem>
              <SelectItem value="booked">{t("wl.stBooked")}</SelectItem>
              <SelectItem value="cancelled">{t("wl.stCancelled")}</SelectItem>
              <SelectItem value="expired">{t("wl.stExpired")}</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        {list.isLoading && <Skeleton className="h-40 w-full" />}
        <div className="divide-y divide-border">
          {entries.map((e) => (
            <div key={e.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-sm font-semibold text-foreground truncate">
                    {patientNameById.get(e.patientId ?? "") ?? `${t("wl.patient")} ${e.patientId?.slice(0, 8) ?? "—"}…`}
                  </p>
                  <StatusBadge status={e.status} className="rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-accent text-foreground ring-1 ring-border" />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(e.preferredDays?.length ? e.preferredDays.map((d) => t(`wl.day.${dayKey(d)}`)).join(", ") : t("wl.anyDay"))}
                  {e.preferredTime ? ` · ${t(`wl.time.${e.preferredTime}`)}` : ` · ${t("wl.anyTime")}`}
                  {e.notifiedAt ? ` · ${t("wl.notifiedAt")} ${new Date(e.notifiedAt).toLocaleDateString()}` : ""}
                </p>
                {e.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.notes}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {e.status === "active" && (
                  <Button size="sm" variant="outline" className="text-xs rounded-xl border-border" disabled={notify.isPending} onClick={() => notify.mutate(e.id)}>
                    {t("wl.markNotified")}
                  </Button>
                )}
                {(e.status === "active" || e.status === "notified") && (
                  <Button size="sm" variant="outline" className="text-xs rounded-xl border-border" disabled={markBooked.isPending} onClick={() => markBooked.mutate(e.id)}>
                    {t("wl.markBooked")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-xs rounded-xl text-red-600 hover:text-red-700" onClick={() => setConfirmRemove(e)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {!list.isLoading && !entries.length && (
            <EmptyState title={t("wl.empty")} description={t("wl.emptyHint")} />
          )}
        </div>
      </Panel>

      <AddDialog open={showAdd} onClose={() => setShowAdd(false)} onAdded={() => qc.invalidateQueries({ queryKey: ["waitlist"] })} />

      {/* ---- remove confirm (not a bare button: the row disappears forever from the queue) ---- */}
      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wl.removeTitle")}</DialogTitle>
            <DialogDescription>{t("wl.removeDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setConfirmRemove(null)}>{t("wl.cancel")}</Button>
            <Button size="sm" className="rounded-xl bg-red-600 text-white hover:bg-red-700" disabled={remove.isPending} onClick={() => confirmRemove && remove.mutate(confirmRemove.id)}>
              {t("wl.confirmRemove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------- the dialog */

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = usePrefs();
  const scope = useScope();
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");

  /* Patient search — same endpoint Patients.tsx uses; a registered patient
   * is REQUIRED (no walk-ins on the waitlist, matching the reference). */
  const patients = useQuery({
    queryKey: ["patients", "waitlist-search", search],
    queryFn: () => api.get<PatientRow[]>(`/patients?search=${encodeURIComponent(search)}&limit=10`),
    enabled: open && !!search,
  });

  const doctors = useQuery({
    queryKey: ["staff", "doctors"],
    queryFn: () => api.get<DoctorRow[]>("/users?role=doctor&limit=50"),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: () => api.post("/appointments/waitlist", {
      ...scope,
      patientId,
      doctorId: doctorId || null,
      preferredDays: days.length ? days : null,
      preferredTime: time || null,
      notes: notes || null,
    }),
    onSuccess: () => {
      onAdded();
      onClose();
      /* Reset for the next open — a dialog that remembers yesterday's patient
       * is how the wrong person ends up on the list. */
      setPatientId(""); setPatientName(""); setDoctorId(""); setDays([]); setTime(""); setNotes(""); setSearch("");
      toast.success(t("wl.added"));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t("wl.addFailed")),
  });

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("wl.addTitle")}</DialogTitle>
          <DialogDescription>{t("wl.addDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* patient, search then pick */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("wl.patient")} *</p>
            {patientId ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{patientName}</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setPatientId(""); setPatientName(""); }}>{t("wl.change")}</Button>
              </div>
            ) : (
              <>
                <Input
                  placeholder={t("wl.searchPh")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-xl border-border bg-card"
                />
                {search && (
                  <div className="mt-1.5 max-h-40 overflow-y-auto rounded-xl border border-border">
                    {patients.isLoading && <p className="p-2 text-xs text-muted-foreground">…</p>}
                    {(patients.data ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => { setPatientId(p.id); setPatientName(`${p.name} (${p.mrn})`); setSearch(""); }}
                      >
                        {p.name} <span className="text-muted-foreground">· {p.mrn}</span>
                      </button>
                    ))}
                    {!patients.isLoading && !(patients.data ?? []).length && (
                      <p className="p-2 text-xs text-muted-foreground">{t("wl.noPatients")}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* preferred doctor, optional */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("wl.doctor")}</p>
            <Select value={doctorId || "any"} onValueChange={(v) => setDoctorId(v === "any" ? "" : v)}>
              <SelectTrigger className="rounded-xl border-border bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("wl.anyDoctor")}</SelectItem>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name ?? d.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* day chips, optional = any day */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("wl.days")}</p>
            <div className="flex flex-wrap gap-1.5">
              {DAY_KEYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    days.includes(d) ? "border-border bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t(`wl.day.${d}`)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("wl.daysHint")}</p>
          </div>

          {/* time band, optional = any time */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("wl.time")}</p>
            <div className="flex gap-1.5">
              {TIME_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTime(time === k ? "" : k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    time === k ? "border-border bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t(`wl.time.${k}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("wl.notes")}</p>
            <Input placeholder={t("wl.notesPh")} value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl border-border bg-card" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={onClose}>{t("wl.cancel")}</Button>
          <Button
            size="sm"
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={!patientId || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "…" : t("wl.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
