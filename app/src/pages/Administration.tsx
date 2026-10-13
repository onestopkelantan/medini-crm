import { usePrefs } from "@/hooks/usePrefs";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PageHeader, Panel, EmptyState } from "@/components/shared";
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
import { ShieldCheck, Users as UsersIcon, UserPlus, Copy, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DoctorRegisterDialog } from "@/components/DoctorRegisterDialog";
import { useAuth } from "@/hooks/useAuth";

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
interface Branch { id: string; shortName: string; code: string }

/* ---------- Invite Staff dialog (HQ sets org/branch/role —> generate single-use link) ---------- */
function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
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
      toast.success(t("msg.inviteGenerated"));
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.inviteFailed"))),
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
                  <Label>{t("adm.branchReq")}</Label>
                  <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("adm.select")} /></SelectTrigger>
                    <SelectContent>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.shortName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5"><Label>{t("adm.emailOpt")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={reset}>{t("common.cancel")}</Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={inviteStaff.isPending}>{t("adm.generateInvite")}</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-700 mb-1.5">Single-use invitation link (expires {new Date(invite.expiresAt).toLocaleString()})</p>
              <p className="text-xs font-mono break-all text-foreground">{invite.link}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(invite.link); toast.success(t("msg.linkCopied")); }}>
                <Copy className="h-4 w-4 mr-1.5" /> Copy Link
              </Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={reset}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Pending Applications (approve / reject) ---------- */
function Applications() {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["admin", "staff", "pending"],
    queryFn: () => api.get<Staff[]>("/admin/staff?status=Pending"),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api.post(`/admin/staff/${id}/${action}`, { reason: `HQ ${action}` }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "approve" ? t("adm.approved") : t("adm.rejected"));
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("adm.actionFailed"))),
  });

  if (pending.isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = (pending.data ?? []);
  if (!rows.length) return <EmptyState title={t("adm.noPending")} />;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm shadow-slate-900/5">
      <Table>
        <TableHeader><TableRow className="border-border bg-muted/70">
          <TableHead>{t("adm.colName")}</TableHead><TableHead>{t("adm.colUsername")}</TableHead><TableHead>{t("adm.colRole")}</TableHead><TableHead className="text-right">{t("adm.colActions")}</TableHead>
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
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => act.mutate({ id: u.id, action: "approve" })} disabled={act.isPending}>
                  <Check className="h-3.5 w-3.5 mr-1" /> {t("adm.approve")}
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => act.mutate({ id: u.id, action: "reject" })} disabled={act.isPending}>
                  <X className="h-3.5 w-3.5 mr-1" /> {t("adm.reject")}
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
  const { user } = useAuth();
  const { t } = usePrefs();
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ["admin", "staff", user?.role], queryFn: () => api.get<Staff[]>(user?.role === "branch_manager" ? "/doctor-registration/doctors/list" : "/admin/staff") });
  /* #1 (pemilik 10 Okt): nama cawangan utk lajur Cabang jadual staf. */
  const branches = useQuery({ queryKey: ["admin", "branches"], queryFn: () => api.get<Branch[]>("/admin/branches") });
  /* Time-off forms (P4 forms gap): issued FROM the staff row. The backend takes
   * the operator's own branch, and HQ has none — so HQ can see the list but not
   * issue; branch roles issue for their own branch. */
  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "deactivate" | "reactivate" | "suspend" }) =>
      api.post(`/admin/staff/${id}/${action}`, { reason: `HQ ${action}` }),
    onSuccess: (_d, v) => { toast.success(`User ${v.action}d`); qc.invalidateQueries({ queryKey: ["admin", "staff"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("adm.actionFailed"))),
  });

  /* Option B (owner 12 Okt): guarded DELETE. Backend refuses when the staff
   * member has operational records (appointments/encounters/notes/scripts);
   * the typed-username confirmation makes the destructive action deliberate.
   * Non-HQ never sees the button. */
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const del = useMutation({
    mutationFn: (id: string) => api.del<{ id: string; deleted: boolean }>(`/admin/staff/${id}`),
    onSuccess: () => {
      toast.success(t("adm.deleteSuccess"));
      setDeleteTarget(null);
      setDeleteConfirmText("");
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("adm.deleteFailed"))),
  });

  if (staff.isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = (staff.data ?? []).filter((u) => u.status !== "Pending");

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm shadow-slate-900/5">
      <Table>
        <TableHeader><TableRow className="border-border bg-muted/70">
          <TableHead>{t("adm.colUser")}</TableHead><TableHead>{t("adm.colUsername")}</TableHead><TableHead>{t("adm.colRole")}</TableHead><TableHead>{t("adm.colBranch")}</TableHead><TableHead>{t("adm.colStatus")}</TableHead><TableHead className="text-right">{t("adm.colActions")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-7 w-7"><AvatarFallback className="bg-emerald-100 text-emerald-700 text-[10px]">{initials(u.name)}</AvatarFallback></Avatar>
                  <div><p className="text-sm font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email ?? "—"}</p></div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{u.username}</TableCell>
              <TableCell><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColors[u.role]}`}>{roleLabels[u.role]}</span></TableCell>
              <TableCell>
                {/* #1 (pemilik 10 Okt): akun harus kelihatan cabangnya. Staff
                    API sudah pulangkan branchId; nama dipetakan dari senarai
                    branches. HQ = "Semua cawangan" (tiada branchId). */}
                <span className="text-xs text-foreground">
                  {u.role === "hq" ? t("adm.allBranches") : (branches.data ?? []).find((b) => b.id === u.branchId)?.shortName ?? t("adm.noBranch")}
                </span>
              </TableCell>
              <TableCell><span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-foreground">{u.status}</span></TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  {u.status === "Active" && (
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => transition.mutate({ id: u.id, action: "deactivate" })} disabled={transition.isPending}>{t("adm.deactivate")}</Button>
                  )}
                  {u.status === "Deactivated" && (
                    <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => transition.mutate({ id: u.id, action: "reactivate" })} disabled={transition.isPending}>{t("adm.reactivate")}</Button>
                  )}
                  {user?.role === "hq" && u.status !== "Active" && (
                    <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" title={t("adm.deleteHint")} onClick={() => { setDeleteTarget(u); setDeleteConfirmText(""); }} disabled={del.isPending}>{t("adm.delete")}</Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Option B delete confirmation — type the username to arm the button. */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirmText(""); } }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("adm.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("adm.deleteDesc")}</DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-semibold text-foreground">{deleteTarget.name}</p>
                <p className="text-xs text-muted-foreground font-mono">@{deleteTarget.username} · {roleLabels[deleteTarget.role]}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete-confirm" className="text-sm font-semibold">{t("adm.deleteType", { u: deleteTarget.username })}</Label>
                <Input id="delete-confirm" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={deleteTarget.username} autoComplete="off" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}>{t("common.cancel")}</Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  disabled={deleteConfirmText !== deleteTarget.username || del.isPending}
                  onClick={() => del.mutate(deleteTarget.id)}
                >
                  {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("adm.deleteConfirm")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

export default function Administration() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const [showInvite, setShowInvite] = useState(false);
  const [showDoctorRegister, setShowDoctorRegister] = useState(false);
  return (
    <div className="space-y-6 -mt-6">
      <PageHeader title={t("nav.administration")} description={t("adm.desc")} />
      <Tabs defaultValue="users">
        <TabsList className="h-auto gap-1 rounded-lg border border-border bg-card p-1.5 shadow-lg shadow-slate-900/5">
          <TabsTrigger className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="users"><UsersIcon className="h-3.5 w-3.5 mr-1.5" />{t("adm.tabUsers")}</TabsTrigger>
          <TabsTrigger className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" value="applications"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />{t("adm.tabApplications")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" className="btn-brand" onClick={() => user?.role === "branch_manager" ? setShowDoctorRegister(true) : setShowInvite(true)}>
              <UserPlus className="h-4 w-4 mr-1.5" /> {t("adm.invite")}
            </Button>
          </div>
          <Users />
        </TabsContent>
        <TabsContent value="applications" className="mt-4">
          <Panel title={t("adm.pendingTitle")} subtitle={t("adm.pendingSub")}>
            <Applications />
          </Panel>
        </TabsContent>
      </Tabs>
      <InviteDialog open={showInvite} onClose={() => setShowInvite(false)} />
      <DoctorRegisterDialog open={showDoctorRegister} onClose={() => setShowDoctorRegister(false)} />
    </div>
  );
}




