import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { age, initials } from "@/lib/format";
import { UserPlus, Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";

interface Branch { id: string; shortName: string; code: string }
interface Patient {
  id: string; mrn: string; name: string; phone: string | null; email: string | null;
  dob: string | null; gender: string | null; branchId: string; status?: string; createdAt?: string;
}
interface TimelineEvent { id: string; type: string; summary: string; createdAt: string; actorRole?: string }

const GRAD = "linear-gradient(135deg, #0DC9B7, #12B5E5)";

function NewPatientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ["admin", "branches"], queryFn: () => api.get<Branch[]>("/admin/branches"), enabled: user?.role === "hq" });
  const [form, setForm] = useState({ name: "", phone: "", email: "", ic: "", dob: "", gender: "female" });
  const [branch, setBranch] = useState<string>("");

  const create = useMutation({
    mutationFn: () => api.post<{ patient: Patient }>("/patients", {
      name: form.name, phone: form.phone || null, email: form.email || null,
      ic: form.ic || null, dob: form.dob || null, gender: form.gender,
      branchId: user?.role === "hq" ? (branch || branchId) : undefined,
    }),
    onSuccess: (r) => {
      toast.success(`Pesakit didaftar - MRN ${r.patient.mrn}`);
      qc.invalidateQueries({ queryKey: ["patients"] });
      onCreated(r.patient.id);
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Pendaftaran gagal")),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Daftar Pesakit Baru</DialogTitle>
          <DialogDescription>Tambah pesakit. Wajib: nama.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>Nama Penuh *</Label><Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6012-345 6789" /></div>
          <div className="space-y-1.5"><Label>Emel</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>No. IC</Label><Input value={form.ic} onChange={(e) => setForm({ ...form, ic: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Tarikh Lahir</Label><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Jantina</Label>
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="female">Perempuan</SelectItem><SelectItem value="male">Lelaki</SelectItem></SelectContent>
            </Select>
          </div>
          {user?.role === "hq" && (
            <div className="space-y-1.5"><Label>Cawangan</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger><SelectValue placeholder="Pilih cawangan" /></SelectTrigger>
                <SelectContent>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.shortName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button type="button" disabled={!form.name || create.isPending} onClick={() => create.mutate()} style={{ background: GRAD }} className="text-white">
            {create.isPending ? "Mendaftar..." : "Daftar Pesakit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Patient360Panel({ id, onClose }: { id: string; onClose: () => void }) {
  const patient = useQuery({ queryKey: ["patients", id], queryFn: () => api.get<Patient>(`/patients/${id}`), enabled: !!id });
  const timeline = useQuery({ queryKey: ["patients", id, "timeline"], queryFn: () => api.get<TimelineEvent[]>(`/patients/${id}/timeline`), enabled: !!id });
  const p = patient.data;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" style={{ backdropFilter: "blur(2px)" }} onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white z-50 shadow-2xl overflow-y-auto" style={{ animation: "slideIn .25s ease" }}>
        <div className="sticky top-0 bg-white/95 border-b border-slate-100 px-6 py-4 flex items-center justify-between" style={{ backdropFilter: "blur(12px)" }}>
          <h2 className="text-[17px] font-bold" style={{ color: "#0B132B", fontFamily: "'Outfit', sans-serif" }}>Patient 360</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition"><X className="h-4 w-4 text-slate-500" /></button>
        </div>

        <div className="p-6 space-y-6">
          {patient.isLoading ? (
            <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-20 w-full" /></div>
          ) : !p ? (
            <p className="text-sm text-slate-400">Pesakit tidak dijumpai.</p>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl flex items-center justify-center text-white text-xl font-bold shrink-0" style={{ background: GRAD, fontFamily: "'Outfit', sans-serif" }}>{initials(p.name)}</div>
                <div>
                  <p className="text-[18px] font-bold" style={{ color: "#0B132B" }}>{p.name}</p>
                  <p className="text-xs text-slate-400">{p.mrn}</p>
                  {p.status && <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold mt-1" style={{ background: "#f0fdfa", color: "#0d9488" }}>{p.status === "active" ? "Active" : p.status}</span>}
                </div>
              </div>

              {/* Info cards */}
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Telefon" value={p.phone ?? "-"} />
                <InfoCard label="Umur · Jantina" value={`${age(p.dob)} · ${p.gender === "male" ? "Lelaki" : "Perempuan"}`} />
                <InfoCard label="Emel" value={p.email ?? "-"} />
                <InfoCard label="Didaftar" value={p.createdAt ? new Date(p.createdAt).toLocaleDateString("ms-MY") : "-"} />
              </div>

              {/* Timeline */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">Perjalanan Pesakit</p>
                {timeline.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (timeline.data ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400 rounded-xl bg-slate-50 px-4 py-6 text-center">Tiada rekod perjalanan lagi.</p>
                ) : (
                  <div className="space-y-3">
                    {(timeline.data ?? []).map((ev) => (
                      <div key={ev.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="h-2.5 w-2.5 rounded-full mt-1.5" style={{ background: GRAD }} />
                          <div className="w-px flex-1 bg-slate-100" />
                        </div>
                        <div className="pb-3">
                          <p className="text-[13px] font-semibold text-slate-700 capitalize">{ev.type.replace(/[_-]/g, " ")}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{ev.summary}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{new Date(ev.createdAt).toLocaleString("ms-MY")}{ev.actorRole ? ` · ${ev.actorRole}` : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[13px] font-semibold text-slate-700 mt-0.5 truncate">{value}</p>
    </div>
  );
}

export default function Patients() {
  const { branchId } = useBranch();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 15;

  const list = useQuery({
    queryKey: ["patients", "list", branchId, search, page],
    queryFn: () => api.get<Patient[]>(`/patients?q=${encodeURIComponent(search)}&limit=${pageSize}&offset=${(page - 1) * pageSize}${branchId ? `&branchId=${branchId}` : ""}`),
  });

  const canCreate = ["hq", "branch_manager", "branch_admin", "receptionist"].includes(user?.role ?? "");
  const rows = list.data ?? [];
  const hasMore = rows.length === pageSize;

  return (
    <div className="space-y-6" style={{ animation: "fadeIn .25s ease" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "#0B132B", fontFamily: "'Outfit', sans-serif" }}>Pesakit</h1>
          <p className="text-sm text-slate-400 mt-0.5">Registri pesakit produksi</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition" style={{ background: GRAD, boxShadow: "0 6px 16px -4px rgba(13,201,183,.4)" }}>
            <UserPlus className="h-4 w-4" /> Pesakit Baru
          </button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cari nama, telefon, MRN..." className="w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100/60 transition" />
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white/80 p-12 text-center" style={{ backdropFilter: "blur(12px)" }}>
          <p className="font-semibold text-slate-700">Tiada pesakit dijumpai</p>
          <p className="text-xs text-slate-400 mt-1">Cuba carian lain atau daftar pesakit baru.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className="group text-left rounded-2xl border border-slate-100 p-4 flex items-center gap-3.5 transition hover:-translate-y-0.5" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-white font-bold shrink-0" style={{ background: GRAD, fontFamily: "'Outfit', sans-serif" }}>{initials(p.name)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[14px] truncate" style={{ color: "#0B132B" }}>{p.name}</p>
                <p className="text-xs text-slate-400 font-mono">{p.mrn}</p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                  <span>{p.phone ?? "-"}</span><span className="text-slate-300">·</span><span>{age(p.dob)} · {p.gender === "male" ? "L" : "P"}</span>
                </div>
              </div>
              <span className="text-slate-300 group-hover:text-teal-500 text-lg">›</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Halaman {page}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /> Sebelum</Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>Seterusnya <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <NewPatientDialog open={showNew} onClose={() => { setShowNew(false); setParams({}); }} onCreated={(newId) => setSelectedId(newId)} />
      {selectedId && <Patient360Panel id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
