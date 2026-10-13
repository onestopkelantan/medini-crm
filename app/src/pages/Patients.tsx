import { usePrefs } from "@/hooks/usePrefs";
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
import { PatientEditDialog } from "@/components/patients/PatientEditDialog";
import { age, initials } from "@/lib/format";
import { UserPlus, Search, ChevronLeft, ChevronRight, X, Pencil } from "lucide-react";
import { toast } from "sonner";

interface Branch { id: string; shortName: string; code: string }
interface Patient {
  id: string; mrn: string; name: string; phone: string | null; email: string | null;
  dob: string | null; gender: string | null; branchId: string; status?: string; createdAt?: string;
  /* Fasa 1b — the server has always returned these; the type simply omitted them,
   * which is why the edit form could not be seeded from the fetched record. */
  ic?: string | null; whatsapp?: string | null;
}
interface TimelineEvent { id: string; type: string; summary: string; createdAt: string; actorRole?: string }

const GRAD = "#54b648";

function NewPatientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = usePrefs();
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
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.registerFailed"))),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pt.new")}</DialogTitle>
          <DialogDescription>{t("pt.newDesc")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>{t("pt.fullName")}</Label><Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("pt.phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6012-345 6789" /></div>
          <div className="space-y-1.5"><Label>{t("pt.email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("pt.ic")}</Label><Input value={form.ic} onChange={(e) => setForm({ ...form, ic: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("pt.dob")}</Label><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Jantina</Label>
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="female">{t("pt.female")}</SelectItem><SelectItem value="male">{t("pt.male")}</SelectItem></SelectContent>
            </Select>
          </div>
          {user?.role === "hq" && (
            <div className="space-y-1.5"><Label>{t("pt.branch")}</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger><SelectValue placeholder={t("pt.pickBranch")} /></SelectTrigger>
                <SelectContent>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.shortName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" disabled={!form.name || create.isPending} onClick={() => create.mutate()} style={{ background: GRAD }} className="text-white">
            {create.isPending ? t("pt.registering") : t("pt.register")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Patient360Panel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = usePrefs();
  const patient = useQuery({ queryKey: ["patients", id], queryFn: () => api.get<Patient>(`/patients/${id}`), enabled: !!id });
  const timeline = useQuery({ queryKey: ["patients", id, "timeline"], queryFn: () => api.get<TimelineEvent[]>(`/patients/${id}/timeline`), enabled: !!id });
  const p = patient.data;
  /* Fasa 1b — PATCH /patients/:id finally has a caller. The panel was read-only,
   * so a phone number typed wrong at registration could never be corrected. */
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" style={{ backdropFilter: "blur(2px)" }} onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-card z-50 shadow-sm overflow-y-auto" style={{ animation: "slideIn .25s ease" }}>
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between" style={{ backdropFilter: "blur(12px)" }}>
          <h2 className="text-[17px] font-bold" style={{ color: "hsl(var(--foreground))", fontFamily: "'Outfit', sans-serif" }}>{t("pt.patient360")}</h2>
          <div className="flex items-center gap-1">
            {p && (
              <button onClick={() => setEditing(true)} title={t("ptedit.edit")} className="h-8 px-3 rounded-full flex items-center gap-1.5 hover:bg-muted transition text-xs font-medium text-foreground"><Pencil className="h-3.5 w-3.5" />{t("ptedit.edit")}</button>
            )}
            <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted transition"><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>

            {/* Fasa 1b, the edit dialog lives INSIDE Patient360Panel so it can use the
              patient record the panel already fetched: no second request, and no
              window where the form is seeded from a stale copy. */}
            <PatientEditDialog
            open={editing}
            onClose={() => setEditing(false)}
            patient={p ? {
              id: p.id, mrn: p.mrn, name: p.name, ic: p.ic, dob: p.dob,
              gender: p.gender, phone: p.phone, whatsapp: p.whatsapp, email: p.email,
            } : null}
            />
        </div>

        <div className="p-6 space-y-6">
          {patient.isLoading ? (
            <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-20 w-full" /></div>
          ) : !p ? (
            <p className="text-sm text-muted-foreground">{t("pt.notFound")}</p>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-lg flex items-center justify-center text-white text-xl font-bold shrink-0" style={{ background: GRAD, fontFamily: "'Outfit', sans-serif" }}>{initials(p.name)}</div>
                <div>
                  <p className="text-[18px] font-bold" style={{ color: "hsl(var(--foreground))" }}>{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.mrn}</p>
                  {p.status && <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold mt-1" style={{ background: "#f0fdfa", color: "#0d9488" }}>{p.status === "active" ? "Active" : p.status}</span>}
                </div>
              </div>

              {/* Info cards */}
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Telefon" value={p.phone ?? "-"} />
                <InfoCard label="Umur · Jantina" value={`${age(p.dob)} · ${p.gender === "male" ? "Lelaki" : "Perempuan"}`} />
                <InfoCard label="Emel" value={p.email ?? "-"} />
                <InfoCard label={t("pt.registered")} value={p.createdAt ? new Date(p.createdAt).toLocaleDateString("ms-MY") : "-"} />
              </div>

              {/* Timeline */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("pt.journey")}</p>
                {timeline.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (timeline.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-xl bg-muted px-4 py-6 text-center">{t("pt.noJourney")}</p>
                ) : (
                  <div className="space-y-3">
                    {(timeline.data ?? []).map((ev) => (
                      <div key={ev.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="h-2.5 w-2.5 rounded-full mt-1.5" style={{ background: GRAD }} />
                          <div className="w-px flex-1 bg-muted" />
                        </div>
                        <div className="pb-3">
                          <p className="text-[13px] font-semibold text-foreground">{t(`evt.${ev.type ?? "event"}`)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{ev.summary}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{new Date(ev.createdAt).toLocaleString("ms-MY")}{ev.actorRole ? ` · ${ev.actorRole}` : ""}</p>
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
    <div className="rounded-xl border border-border bg-muted/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[13px] font-semibold text-foreground mt-0.5 truncate">{value}</p>
    </div>
  );
}

export default function Patients() {
  const { t } = usePrefs();
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
          <h1 className="text-[24px] font-bold" style={{ color: "hsl(var(--foreground))", fontFamily: "'Outfit', sans-serif" }}>{t("pt.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("pt.registrySubtitle")}</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition" style={{ background: GRAD, boxShadow: "0 6px 16px -4px rgba(13,201,183,.4)" }}>
            <UserPlus className="h-4 w-4" /> {t("pt.new")}
          </button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={t("pt.searchPh")} className="w-full rounded-full border border-border bg-card pl-10 pr-4 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-primary/60 transition" />
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center" style={{ backdropFilter: "blur(12px)" }}>
          <p className="font-semibold text-foreground">{t("pt.noneFound")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("pt.noResultsHint")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className="group text-left rounded-lg border border-border p-4 flex items-center gap-3.5 transition hover:-translate-y-0.5" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
              <div className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold shrink-0" style={{ background: GRAD, fontFamily: "'Outfit', sans-serif" }}>{initials(p.name)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[14px] truncate" style={{ color: "hsl(var(--foreground))" }}>{p.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{p.mrn}</p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                  <span>{p.phone ?? "-"}</span><span className="text-muted-foreground">·</span><span>{age(p.dob)} · {p.gender === "male" ? "L" : "P"}</span>
                </div>
              </div>
              <span className="text-muted-foreground group-hover:text-foreground text-lg">›</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Halaman {page}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" />{t("pt.previous")}</Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>{t("pt.next")}<ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <NewPatientDialog open={showNew} onClose={() => { setShowNew(false); setParams({}); }} onCreated={(newId) => setSelectedId(newId)} />
      {selectedId && <Patient360Panel id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
