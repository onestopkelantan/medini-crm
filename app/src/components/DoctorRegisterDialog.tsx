import { usePrefs } from "@/hooks/usePrefs";
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
  const { t } = usePrefs();
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
      toast.success(t("msg.inviteCreated"));
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
      setInviteLink(data.inviteLink);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("dr.registerFailed"))),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dr.title")}</DialogTitle>
          <DialogDescription>{t("dr.desc")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); register.mutate(); }}>
          <div className="space-y-1.5"><Label>{t("adm.fullNameReq")}</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("dr.usernameLabel")} *</Label><Input required minLength={3} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} /></div>
          <div className="space-y-1.5"><Label>{t("dr.roleLabel")} *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="doctor">Doctor</option><option value="branch_admin">Branch Admin</option></select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t("dr.emailLabel")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{t("adm.phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={register.isPending}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={register.isPending || !!inviteLink} className="bg-primary text-primary-foreground">
              <UserPlus className="mr-2 h-4 w-4" /> {register.isPending ? t("wa.registering") : t("dr.title")}
            </Button>
          </div>
          {inviteLink && <div className="rounded-md bg-emerald-50 p-3 text-sm"><p className="font-medium text-emerald-700">{t("adm.inviteLinkOk")}</p><Input readOnly value={inviteLink} className="mt-2" onFocus={(e) => e.currentTarget.select()} /></div>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
