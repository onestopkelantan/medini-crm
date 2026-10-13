import { usePrefs } from "@/hooks/usePrefs";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, RotateCcw, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";

/**
 * STOP list — patients who asked to stop receiving messages.
 *
 * This screen exists because the block is invisible otherwise. "Why did this
 * patient not receive the campaign?" needs an answer the operator can look up,
 * and a request that arrives by phone ("please stop messaging me") has to have
 * somewhere to go.
 *
 * Revoked entries stay visible: "asked us to stop, then asked to resume" is
 * exactly the history you want if the decision is ever questioned.
 */

interface OptOut {
  id: string;
  phone: string;
  source: "reply_stop" | "staff_manual" | "patient_request";
  matchedKeyword: string | null;
  reason: string | null;
  originBranchId: string | null;
  createdAt: string;
  revoked: boolean;
  revokedAt: string | null;
}

const SOURCE_LABEL: Record<OptOut["source"], string> = {
  reply_stop: "opt.replyStop",
  staff_manual: "opt.staffManual",
  patient_request: "Permintaan pesakit",
};

/** 60123456789 → 6012-345 6789, for reading aloud on the phone. */
function formatPhone(raw: string): string {
  if (raw.length < 10) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 7)} ${raw.slice(7)}`;
}

export default function OptOutListPanel() {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [showRevoked, setShowRevoked] = useState(false);

  const list = useQuery({
    queryKey: ["opt-outs"],
    queryFn: () => api.get<OptOut[]>("/whatsapp/opt-outs"),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post<OptOut>("/whatsapp/opt-outs", { phone, reason }),
    onSuccess: () => {
      toast.success(t("msg.stopAdded"));
      setPhone("");
      setReason("");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["opt-outs"] });
    },
    onError: (e) => toast.error(errorMessage(e, t("opt.addFailed"))),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del<OptOut>(`/whatsapp/opt-outs/${id}`),
    onSuccess: () => {
      toast.success(t("opt.removed"));
      qc.invalidateQueries({ queryKey: ["opt-outs"] });
    },
    onError: (e) => toast.error(errorMessage(e, t("opt.removeFailed"))),
  });

  const rows = list.data ?? [];
  const active = rows.filter((r) => !r.revoked);
  const visible = showRevoked ? rows : active;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-red-100 p-2.5 text-red-700">
            <ShieldOff className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold text-foreground">{t("wa.stop.title")}</p>
            <p className="text-xs text-muted-foreground">
              Pesakit yang meminta berhenti menerima mesej. Mereka tidak akan
              dimasukkan dalam mana-mana blast.
            </p>
          </div>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Tambah Manual
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("opt.addTitle")}</DialogTitle>
              <DialogDescription>
                Untuk permintaan yang diterima melalui telefon atau di kaunter.
                Pesakit ini tidak akan menerima mesej promosi lagi.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="stop-phone">{t("wa.stop.phone")}</Label>
                <Input
                  id="stop-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("wa.stop.phonePh")}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="stop-reason">{t("wa.stop.reason")}</Label>
                <Textarea
                  id="stop-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("opt.addPh")}
                  className="mt-2"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Batal
              </Button>
              <Button
                disabled={phone.trim().length < 9 || add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? t("common.saving") : t("common.add")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <Badge variant="destructive" className="text-sm">
          {t("wa.optOutCount", { n: active.length })}
        </Badge>
        {rows.length > active.length && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRevoked((v) => !v)}
            className="text-xs"
          >
            {showRevoked
              ? t("wa.optOutHideRevoked")
              : t("wa.optOutShowRevoked", { n: rows.length - active.length })}
          </Button>
        )}
      </div>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingList")}</p>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <Ban className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-muted-foreground">
            Tiada pesakit dalam Senarai STOP
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bila pesakit balas "STOP", mereka akan muncul di sini secara automatik.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("wa.stop.colNo")}</th>
                <th className="px-4 py-3 font-semibold">{t("wa.stop.colSource")}</th>
                <th className="px-4 py-3 font-semibold">{t("wa.stop.colReason")}</th>
                <th className="px-4 py-3 font-semibold">{t("wa.stop.colDate")}</th>
                <th className="px-4 py-3 font-semibold">{t("wa.stop.colStatus")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono font-semibold text-foreground">
                    {formatPhone(r.phone)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={r.source === "reply_stop" ? "default" : "secondary"}>
                      {SOURCE_LABEL[r.source]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.reason ?? (r.matchedKeyword ? `"${r.matchedKeyword}"` : "—")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("ms-MY")}
                  </td>
                  <td className="px-4 py-3">
                    {r.revoked ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Dibuka
                      </Badge>
                    ) : (
                      <Badge variant="destructive">{t("wa.stop.blocked")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.revoked ? (
                      <span className="text-xs text-muted-foreground">
                        {r.revokedAt
                          ? new Date(r.revokedAt).toLocaleDateString("ms-MY")
                          : ""}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(r.id)}
                        title={t("wa.stop.unblockHint")}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Buka
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-accent p-4 text-xs text-teal-900">
        <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {t("wa.stop.unblockNote1")} <strong>{t("wa.stop.unblockNote2")}</strong> {t("wa.stop.unblockNote3")}
        </p>
      </div>
    </div>
  );
}
