import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

export function DoctorRegisterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", role: "doctor" });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: () => api.post<{ inviteLink: string }>("/doctor-registration/doctors/register", {
      name: form.name,
      username: form.username.toLowerCase(),
      role: form.role,
      email: form.email || null,
      phone: form.phone || null,
    }),
    onSuccess: (data) => {
      toast.success("Invitation link berjaya dibuat");
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
      setInviteLink(data.inviteLink);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Gagal daftar doktor")),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Daftar Doktor</DialogTitle>
          <DialogDescription>Isi maklumat staff sahaja. Mereka akan menetapkan password sendiri melalui invitation link.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); register.mutate(); }}>
          <div className="space-y-1.5"><Label>Nama penuh *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Username *</Label><Input required minLength={3} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} /></div>
          <div className="space-y-1.5"><Label>Jawatan *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="doctor">Doctor</option><option value="branch_admin">Branch Admin</option></select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>No. telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <Button type="submit" disabled={register.isPending || !!inviteLink} className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white">
            <UserPlus className="mr-2 h-4 w-4" /> {register.isPending ? "Mendaftar..." : "Daftar Doktor"}
          </Button>
          {inviteLink && <div className="rounded-md bg-emerald-50 p-3 text-sm"><p className="font-medium text-emerald-700">Invitation link berjaya dibuat:</p><Input readOnly value={inviteLink} className="mt-2" onFocus={(e) => e.currentTarget.select()} /></div>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
