import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { ShieldCheck, Users as UsersIcon, UserPlus, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";

const roleLabels: Record<string, string> = { hq: "HQ Super Admin", branch_manager: "Branch Manager", branch_admin: "Branch Admin", doctor: "Doctor" };
const roleColors: Record<string, string> = { hq: "bg-emerald-100 text-emerald-700", branch_manager: "bg-blue-100 text-blue-700", branch_admin: "bg-amber-100 text-amber-700", doctor: "bg-violet-100 text-violet-700" };

interface Staff {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: string;
  status: string;
  branchId: string | null;
}
interface Branch { id: string; name: string; code: string }

/* ---------- Invite Staff dialog (HQ sets org/branch/role → generate single-use link) ---------- */
function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ["admin", "branches"], queryFn: () => api.get<Branch[]>("/admin/branches") });
  const [form, setForm] = useState({ name: "", username: "", role: "doctor", branchId: "", email: "" });
  const [invite, setInvite] = useState<{ link: string; expiresAt: string } | null>(null);

  const inviteStaff = useMutation({
    mutationFn: async () => {
      const created = await api.post<Staff>("/admin/staff", {
        name: form.name, username: form.username, role: form.role,
        branchId: form.role === "hq" ? null : form.branchId || null,
        email: form.email || null,
      });
      const baseUrl = window.location.origin;
      const link = await api.post<{ inviteLink: string; expiresAt: string }>(`/admin/staff/${created.id}/invite-link`, { baseUrl });
      return link;
    },
    onSuccess: (data) => {
      setInvite({ link: data.inviteLink, expiresAt: data.expiresAt });
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
      toast.success("Invitation link generated");
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Invite failed")),
  });

  const reset = () => { setInvite(null); setForm({ name: "", username: "", role: "doctor", branchId: "", email: "" }); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite Staff</DialogTitle>
          <DialogDescription>HQ assigns the role & branch. The system generates a single-use invitation link — copy and send it to the staff member.</DialogDescription>
        </DialogHeader>
        {!invite ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); inviteStaff.mutate(); }}>
            <div className="space-y-1.5"><Label>Full Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Username *</Label><Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="lowercase only" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(roleLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.role !== "hq" && (
                <div className="space-y-1.5">
                  <Label>Branch *</Label>
                  <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5"><Label>Email (optional)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={reset}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={inviteStaff.isPending}>Generate Invitation Link</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-700 mb-1.5">Single-use invitation link (expires {new Date(invite.expiresAt).toLocaleString()})</p>
              <p className="text-xs font-mono break-all text-slate-700">{invite.link}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(invite.link); toast.success("Link copied"); }}>
                <Copy className="h-4 w-4 mr-1.5" /> Copy Link
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={reset}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Pending Applications (approve / reject) ---------- */
function Applications() {
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["admin", "staff", "pending"],
    queryFn: () => api.get<Staff[]>("/admin/staff?status=Pending"),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api.post(`/admin/staff/${id}/${action}`, { reason: `HQ ${action}` }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "approve" ? "Application approved — user is now Active" : "Application rejected");
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Action failed")),
  });

  if (pending.isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = (pending.data ?? []);
  if (!rows.length) return <EmptyState title="No pending applications" />;

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <Table>
        <TableHeader><TableRow className="bg-slate-50">
          <TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-7 w-7"><AvatarFallback className="bg-amber-100 text-amber-700 text-[10px]">{initials(u.name)}</AvatarFallback></Avatar>
                  <p className="text-sm font-medium">{u.name}</p>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{u.username}</TableCell>
              <TableCell><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColors[u.role]}`}>{roleLabels[u.role]}</span></TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => act.mutate({ id: u.id, action: "approve" })} disabled={act.isPending}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => act.mutate({ id: u.id, action: "reject" })} disabled={act.isPending}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---------- User directory (activate / deactivate) ---------- */
function Users() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ["admin", "staff"], queryFn: () => api.get<Staff[]>("/admin/staff") });
  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "deactivate" | "reactivate" | "suspend" }) =>
      api.post(`/admin/staff/${id}/${action}`, { reason: `HQ ${action}` }),
    onSuccess: (_d, v) => { toast.success(`User ${v.action}d`); qc.invalidateQueries({ queryKey: ["admin", "staff"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Action failed")),
  });

  if (staff.isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = (staff.data ?? []).filter((u) => u.status !== "Pending");

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <Table>
        <TableHeader><TableRow className="bg-slate-50">
          <TableHead>User</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-7 w-7"><AvatarFallback className="bg-emerald-100 text-emerald-700 text-[10px]">{initials(u.name)}</AvatarFallback></Avatar>
                  <div><p className="text-sm font-medium">{u.name}</p><p className="text-xs text-slate-400">{u.email ?? "—"}</p></div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{u.username}</TableCell>
              <TableCell><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColors[u.role]}`}>{roleLabels[u.role]}</span></TableCell>
              <TableCell><StatusBadge status={u.status === "Active" ? "completed" : u.status === "Invited" ? "booked" : "cancelled"} /></TableCell>
              <TableCell className="text-right">
                {u.status === "Active" && (
                  <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => transition.mutate({ id: u.id, action: "deactivate" })} disabled={transition.isPending}>Deactivate</Button>
                )}
                {u.status === "Deactivated" && (
                  <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => transition.mutate({ id: u.id, action: "reactivate" })} disabled={transition.isPending}>Reactivate</Button>
                )}
                {(u.status === "Invited" || u.status === "Rejected") && <span className="text-xs text-slate-400">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Administration() {
  const [showInvite, setShowInvite] = useState(false);
  return (
    <div className="space-y-5 -mt-6">
      <PageHeader title="Administration" description="User lifecycle — invite, approve, deactivate (HQ only)" />
      <Tabs defaultValue="users">
        <TabsList className="bg-white border">
          <TabsTrigger value="users"><UsersIcon className="h-3.5 w-3.5 mr-1.5" />Users</TabsTrigger>
          <TabsTrigger value="applications"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Applications</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowInvite(true)}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Invite Staff
            </Button>
          </div>
          <Users />
        </TabsContent>
        <TabsContent value="applications" className="mt-4">
          <Panel title="Pending Applications" subtitle="HQ review — approve to activate, reject to decline">
            <Applications />
          </Panel>
        </TabsContent>
      </Tabs>
      <InviteDialog open={showInvite} onClose={() => setShowInvite(false)} />
    </div>
  );
}
