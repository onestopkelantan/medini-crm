import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { age, initials } from "@/lib/format";
import { UserPlus, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface Branch { id: string; name: string; code: string }
interface Patient {
  id: string; mrn: string; name: string; phone: string | null; email: string | null;
  dob: string | null; gender: string | null; branchId: string;
}

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
      toast.success(`Patient registered — MRN ${r.patient.mrn}`);
      qc.invalidateQueries({ queryKey: ["patients"] });
      onCreated(r.patient.id);
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Registration failed")),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register New Patient</DialogTitle>
          <DialogDescription>Add a patient. Required: name.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          {user?.role === "hq" && (
            <div className="col-span-2 space-y-1.5">
              <Label>Branch *</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2 space-y-1.5"><Label>Full Name *</Label><Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6012-345 6789" /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>IC Number</Label><Input value={form.ic} onChange={(e) => setForm({ ...form, ic: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Date of Birth</Label><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Register Patient"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Patients() {
  const { branchId } = useBranch();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const pageSize = 15;

  const list = useQuery({
    queryKey: ["patients", "list", branchId, search, page],
    queryFn: () => api.get<Patient[]>(`/patients?q=${encodeURIComponent(search)}&limit=${pageSize}&offset=${(page - 1) * pageSize}${branchId ? `&branchId=${branchId}` : ""}`),
  });

  const canCreate = ["hq", "branch_manager", "branch_admin", "receptionist"].includes(user?.role ?? "");
  const rows = list.data ?? [];
  const hasMore = rows.length === pageSize;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={user?.role === "doctor" ? "Patient 360" : "Patients"}
        description="Production patient registry"
        actions={canCreate && (
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowNew(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" /> New Patient
          </Button>
        )}
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, phone, MRN…" className="pl-9 bg-white" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Patient</TableHead><TableHead>MRN</TableHead><TableHead>Contact</TableHead><TableHead>Age / Gender</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 4 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              : rows.map((p) => (
                  <TableRow key={p.id} className="hover:bg-emerald-50/40 cursor-pointer">
                    <TableCell>
                      <Link to={`/patients/${p.id}`} className="flex items-center gap-2.5 group">
                        <Avatar className="h-8 w-8"><AvatarFallback className="bg-emerald-100 text-emerald-700 text-[10px]">{initials(p.name)}</AvatarFallback></Avatar>
                        <span className="font-medium text-slate-800 group-hover:text-emerald-700">{p.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{p.mrn}</TableCell>
                    <TableCell className="text-xs text-slate-500">{p.phone ?? "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">{age(p.dob)} · {p.gender === "male" ? "M" : "F"}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!list.isLoading && !rows.length && <EmptyState title="No patients found" description="Try a different search or register a new patient." />}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Page {page}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /> Prev</Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <NewPatientDialog open={showNew} onClose={() => { setShowNew(false); setParams({}); }} onCreated={() => {}} />
    </div>
  );
}
