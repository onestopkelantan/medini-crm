import { usePrefs } from "@/hooks/usePrefs";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Bot,
  CheckCircle2,
  Loader2,
  RotateCcw,
  UserCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * ConversationActions — kawalan perbualan, satu tempat.
 *
 * Setiap butang memetakan terus kepada satu tindakan backend yang sudah wujud.
 * Sebelum ini endpoint ada tetapi tiada UI, jadi staff tidak boleh mengambil
 * alih daripada AI, mengagihkan perbualan, atau membuka semula kes yang
 * tersilap ditutup.
 */

export interface ConversationFlags {
  id: string;
  status: string;
  assignedTo?: string | null;
  needsHuman?: boolean;
  needsHumanReason?: string | null;
  aiQueueState?: string | null;
}

interface AssignableStaff {
  id: string;
  name: string;
  role: string;
  branchId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  new: "Baru",
  open: "Terbuka",
  pending: "st.waiting",
  escalated: "Diserahkan kepada manusia",
  resolved: "st.completed",
  archived: "Diarkib",
};

const ROLE_LABEL: Record<string, string> = {
  hq: "HQ",
  branch_manager: "role.branchManager",
  branch_admin: "Kaunter",
};

/**
 * Legal conversation transitions — mirrors canTransitionWaConversation in
 * backend domain/whatsapp-lifecycle.ts.
 *
 * The UI must offer only legal actions. Before this, "Selesai" was shown on an
 * ESCALATED conversation, but the domain allows escalated → open ONLY, so the
 * button returned 409 "Illegal transition escalated → resolved" and the
 * operator was stuck with no way to finish the conversation.
 *
 * NOTE: escalated has no direct path to resolved — that gap is a locked
 * governance rule, not a UI decision, so this component honours it and offers
 * the legal route (Buka semula) instead of a button that cannot work.
 */
const ALLOWED: Record<string, string[]> = {
  new: ["open", "pending", "resolved"],
  open: ["pending", "resolved", "escalated"],
  pending: ["open", "resolved"],
  escalated: ["open"],
  resolved: ["open", "archived"],
  archived: [],
};

/**
 * Is this a LEGAL transition for the UI to OFFER?
 *
 * Strict: a same-status move is NOT offered. The backend treats current === next
 * as a permitted no-op (it returns the row unchanged), but rendering a button
 * for it is wrong — it showed "Selesai" on conversations that were already
 * resolved or escalated, where the status cannot actually change.
 */
const canGo = (from: string, to: string) =>
  from !== to && (ALLOWED[from] ?? []).includes(to);

export function ConversationActions({
  conv,
  branchId,
  onClosed,
}: {
  conv: ConversationFlags;
  branchId?: string | null;
  onClosed: () => void;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [showAssign, setShowAssign] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["whatsapp"] });
  };

  /* Assignee list is loaded lazily — only when the operator opens the picker,
   * so the common path (read and reply) makes no extra request. */
  const staff = useQuery({
    queryKey: ["whatsapp", "assignable-staff", branchId ?? "all"],
    queryFn: () =>
      api.get<AssignableStaff[]>(
        `/whatsapp/assignable-staff${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`,
      ),
    enabled: showAssign,
    retry: false,
  });

  /* Each action is its own useMutation call at the top level — a helper that
   * CALLS useMutation would be a hook called from a non-hook function, which
   * breaks the rules of hooks. `mk` only builds the options object. */
  const mk = (path: string, body: unknown, successMsg: string, onDone?: () => void) => ({
    mutationFn: () => api.post(`/whatsapp/conversations/${conv.id}/${path}`, body),
    onSuccess: () => {
      toast.success(successMsg);
      refresh();
      onDone?.();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.actionFailed"))),
  });

  const assign = useMutation<unknown, Error, { staffId: string }>({
    ...mk("assign", undefined, "Perbualan diagihkan", () => setShowAssign(false)),
    mutationFn: (vars: { staffId: string }) =>
      api.post(`/whatsapp/conversations/${conv.id}/assign`, { staffId: vars.staffId }),
  });
  const unassign = useMutation(mk("unassign", undefined, "Agihan ditarik"));
  const handoff = useMutation(mk("handoff", undefined, "Anda kini mengendalikan perbualan ini, AI berhenti menjawab"));
  const returnToAi = useMutation(mk("return-to-ai", undefined, "Perbualan diserahkan semula kepada AI"));
  const resolve = useMutation(mk("resolve", undefined, "Perbualan diselesaikan", onClosed));
  const reopen = useMutation(mk("reopen", undefined, "Perbualan dibuka semula"));
  const archive = useMutation(mk("archive", undefined, "Perbualan diarkibkan", onClosed));

  const busy =
    assign.isPending || unassign.isPending || handoff.isPending ||
    returnToAi.isPending || resolve.isPending || reopen.isPending || archive.isPending;

  const st = conv.status;
  const isArchived = st === "archived";
  const isResolved = st === "resolved";
  const isEscalated = st === "escalated";

  /* Only offer what the domain permits from the CURRENT status. */
  const canHandoff = !isArchived && canGo(st, "escalated");
  const canReturnToAi = !isArchived && canGo(st, "open");
  const canAssign = !isArchived;
  const canResolve = !isArchived && canGo(st, "resolved");
  const canReopen = !isArchived && canGo(st, "open");
  const canArchive = !isArchived && canGo(st, "archived");

  const aiPaused = conv.aiQueueState === "handoff";

  return (
    <div className="border-b border-gray-100 bg-card px-3 py-2">
      {/* Status + siapa mengendalikan */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
          {STATUS_LABEL[conv.status] ?? conv.status}
        </span>

        {conv.assignedTo ? (
          <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-foreground ring-1 ring-teal-200">
            Diagihkan
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">
            Belum diagihkan
          </span>
        )}

        {aiPaused && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 ring-1 ring-indigo-200">
            AI dijeda, manusia mengendalikan
          </span>
        )}

        {conv.needsHuman && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">
            Perlu manusia{conv.needsHumanReason ? ` · ${conv.needsHumanReason}` : ""}
          </span>
        )}
      </div>

      {/* Tindakan */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* AI ↔ manusia */}
        {canHandoff && !aiPaused && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => handoff.mutate()}
            className="h-7 rounded-full border-indigo-200 px-2.5 text-[11px] text-indigo-700 hover:bg-indigo-50">
            {handoff.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Bot className="mr-1 h-3 w-3" />}
            Ambil alih dari AI
          </Button>
        )}
        {canReturnToAi && (aiPaused || isEscalated) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => returnToAi.mutate()}
            className="h-7 rounded-full border-border px-2.5 text-[11px] text-foreground hover:bg-accent">
            {returnToAi.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Bot className="mr-1 h-3 w-3" />}
            Serah semula ke AI
          </Button>
        )}

        {/* Agihan */}
        {canAssign && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowAssign((v) => !v)}
              className="h-7 rounded-full border-border px-2.5 text-[11px] text-foreground hover:bg-muted">
              <UserPlus className="mr-1 h-3 w-3" />
              {conv.assignedTo ? "Tukar agihan" : "Agihkan"}
            </Button>
            {conv.assignedTo && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => unassign.mutate()}
                className="h-7 rounded-full border-border px-2.5 text-[11px] text-muted-foreground hover:bg-muted">
                {unassign.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <UserMinus className="mr-1 h-3 w-3" />}
                Tarik
              </Button>
            )}
          </>
        )}

        {/* Kitaran hayat, setiap butang hanya muncul jika peralihan itu sah.
            Arkib: resolved → archived sahaja. */}
        {canResolve && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve.mutate()}
            className="h-7 rounded-full border-border px-2.5 text-[11px] text-foreground hover:bg-accent">
            {resolve.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
            Selesai
          </Button>
        )}
        {canReopen && (isResolved || isEscalated) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => reopen.mutate()}
            className="h-7 rounded-full border-amber-200 px-2.5 text-[11px] text-amber-800 hover:bg-amber-50">
            {reopen.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
            Buka semula
          </Button>
        )}
        {canArchive && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(t("msg.archiveConfirm"))) archive.mutate(); }}
            className="h-7 rounded-full border-border px-2.5 text-[11px] text-muted-foreground hover:bg-muted">
            {archive.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Archive className="mr-1 h-3 w-3" />}
            Arkib
          </Button>
        )}

        {isArchived && (
          <span className="text-[11px] text-muted-foreground">
            Perbualan diarkib, tiada tindakan lagi.
          </span>
        )}
      </div>

      {/* Pemilih staff */}
      {showAssign && (
        <div className="mt-2 rounded-xl border border-border bg-card p-2">
          {staff.isLoading && (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">{t("wa.conv.loadingStaff")}</p>
          )}
          {staff.isError && (
            <p className="px-1 py-2 text-[11px] text-red-600">
              {errorMessage(staff.error, t("wa.staffLoadFailed"))}
            </p>
          )}
          {staff.data && staff.data.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              Tiada staff aktif dalam cawangan ini.
            </p>
          )}
          {(staff.data ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={busy}
              onClick={() => assign.mutate({ staffId: s.id })}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent/60 disabled:opacity-50"
            >
              <UserCheck className="h-3.5 w-3.5 shrink-0 text-foreground" />
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">{ROLE_LABEL[s.role] ?? s.role}</span>
              {assign.isPending && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
            </button>
          ))}
        </div>
      )}

      {/* Cara ambil alih dijelaskan supaya tiada tekaan */}
      {canHandoff && !aiPaused && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-4 text-muted-foreground">
          <ArrowLeftRight className="mt-0.5 h-3 w-3 shrink-0" />
          “Ambil alih dari AI” menghentikan balasan automatik untuk perbualan ini dan
          mengagihkannya kepada anda.
        </p>
      )}

      {/* Perbualan yang diserahkan kepada manusia perlu kembali terbuka dahulu
          sebelum ia boleh diselesaikan, peraturan domain, bukan pilihan UI. */}
      {isEscalated && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-4 text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Perbualan yang diserahkan kepada manusia perlu dibuka semula sebelum
          boleh diselesaikan.
        </p>
      )}
    </div>
  );
}
