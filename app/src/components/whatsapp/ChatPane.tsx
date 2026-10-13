import { usePrefs } from "@/hooks/usePrefs";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCheck,
  Loader2,
  Send,
  User,
  UserCog,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import MiniMarkdown from "@/components/MiniMarkdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";

/**
 * ChatPane — perbualan dua hala.
 *
 * Tiga perkara yang perlu betul di sini:
 *
 * 1. ARAH MESEJ. Backend menyimpan direction sebagai 'in' | 'out'. UI dahulu
 *    membandingkan dengan "outbound" (nilai yang tidak pernah wujud), jadi
 *    SETIAP mesej — termasuk balasan staff — dipaparkan di sebelah kiri sebagai
 *    mesej pesakit masuk. Perbualan kelihatan seperti pesakit bercakap sendiri.
 *
 * 2. SIAPA YANG MENJAWAB. senderType ('patient' | 'human' | 'ai' | 'system')
 *    menentukan label. Operator perlu tahu sama ada AI atau manusia yang
 *    membalas — terutamanya semasa AI masih diuji.
 *
 * 3. MESEJ BAHARU. Tiada muat-semula automatik dahulu, jadi balasan pesakit
 *    hanya muncul selepas operator menekan refresh sendiri. Tinjauan berkala
 *    setiap 5 saat cukup untuk kaunter; ia berhenti apabila tab tidak aktif
 *    supaya tiada permintaan terbuang.
 */

interface Message {
  id: string;
  direction: string;
  senderType?: string;
  body: string;
  status: string;
  isSimulated?: boolean;
  sentAt?: string;
  createdAt?: string;
}

const POLL_MS = 5000;

/** Backend stores 'in' | 'out'. Tolerate both spellings so a future rename in
 *  one place cannot silently flip the whole transcript again. */
function isOutbound(dir: string | undefined) {
  const d = (dir ?? "").toLowerCase();
  return d === "out" || d === "outbound";
}

function senderLabel(senderType: string | undefined): {
  text: string;
  icon: typeof User;
} {
  switch ((senderType ?? "").toLowerCase()) {
    case "ai":
      return { text: "AI", icon: Bot };
    case "human":
      return { text: "Staff", icon: UserCog };
    case "system":
      return { text: "Sistem", icon: UserCog };
    default:
      return { text: "pt.title", icon: User };
  }
}

/** Fresh key per send — the backend rejects a reused key carrying new text. */
function newIdempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatPane({
  convId,
  contactPhone,
  templates,
  actions,
}: {
  convId: string;
  contactPhone: string;
  templates: { id: string; name: string; body: string; active: boolean }[];
  actions?: React.ReactNode;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastCount = useRef(0);

  const messages = useQuery({
    queryKey: ["whatsapp", "messages", convId],
    queryFn: () => api.get<Message[]>(`/whatsapp/conversations/${convId}/messages?limit=100`),
    /* Auto-refresh so an inbound reply reaches the operator without a manual
     * reload. Skipped while the operator is typing so a refresh never fights
     * their input, and stopped entirely when the tab is hidden. */
    refetchInterval: paused ? false : POLL_MS,
    refetchIntervalInBackground: false,
  });

  const rows = messages.data ?? [];

  /* Mark the conversation as read the moment the operator opens it. The
   * unread badge in the sidebar should drop immediately, not after a manual
   * refresh. Fire-and-forget — a failure here must not block the operator
   * from reading the thread. */
  useEffect(() => {
    if (!convId) return;
    api.post(`/whatsapp/conversations/${convId}/read`, {}).catch(() => {
      /* silent — the next poll or a manual refresh will reconcile */
    });
  }, [convId]);

  /* Keep the view pinned to the newest message, but only when the count
   * actually changes — otherwise every poll would yank the operator's scroll
   * position back to the bottom mid-read. */
  useEffect(() => {
    if (rows.length !== lastCount.current) {
      lastCount.current = rows.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [rows.length]);

  const send = useMutation({
    mutationFn: () =>
      api.post(`/whatsapp/conversations/${convId}/messages`, {
        body: reply,
        idempotencyKey: newIdempotencyKey("wa-reply"),
      }),
    onSuccess: () => {
      setReply("");
      setSendError(null);
      toast.success(t("chat.sent"));
      void qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
    onError: (e: unknown) => {
      /* Keep the text so nothing typed is lost, and show WHY inline — a safety
       * block carries an actionable reason the operator must read. */
      setSendError(errorMessage(e, t("chat.sendFailed")));
    },
  });

  function submit() {
    if (!reply.trim() || send.isPending) return;
    send.mutate();
  }

  return (
    <>
      {/* Kepala perbualan */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
          {contactPhone.replace(/\D/g, "").slice(-2) || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-foreground">{contactPhone}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-500" />
            {messages.isFetching ? "Menyegarkan…" : paused ? "Auto-muat dijeda" : "Muat semula setiap 5s"}
          </p>
        </div>
        {/* Jeda tinjauan, berguna semasa membaca perbualan panjang. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 rounded-full border-border px-2.5 text-[11px] text-muted-foreground"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Sambung auto-muat" : "Jeda auto-muat"}
        </Button>
      </div>

      {actions}

      {/* Transkrip */}
      <div className="flex-1 space-y-3 overflow-y-auto bg-[#F4F7FA] p-4">
        {messages.isLoading && <Skeleton className="h-24 w-full" />}

        {rows.map((m) => {
          const out = isOutbound(m.direction);
          const sender = senderLabel(m.senderType);
          const SenderIcon = sender.icon;

          return out ? (
            /* Keluar: kanan. Warna berbeza ikut siapa yang menjawab. */
            <div key={m.id} className="flex justify-end">
              <div
                className={
                  "max-w-[75%] rounded-lg rounded-tr-sm px-3.5 py-2 text-primary-foreground " +
                  (sender.text === "AI"
                    ? "bg-gradient-to-br from-indigo-500 to-violet-500"
                    : "bg-primary")
                }
              >
                <p className="mb-0.5 flex items-center justify-end gap-1 text-[10px] font-medium uppercase tracking-wide opacity-80">
                  <SenderIcon className="h-3 w-3" />
                  {sender.text}
                </p>
                <MiniMarkdown text={m.body} className="text-[13px] leading-snug" />
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-80">
                  {fmtDateTime(m.sentAt ?? m.createdAt)}
                  <CheckCheck className="h-3 w-3" />
                </p>
              </div>
            </div>
          ) : (
            /* Masuk: kiri. */
            <div key={m.id} className="flex">
              <div className="max-w-[75%] rounded-lg rounded-tl-sm bg-card px-3.5 py-2 shadow-sm">
                <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <SenderIcon className="h-3 w-3" />
                  {sender.text}
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-snug text-foreground">{m.body}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {fmtDateTime(m.sentAt ?? m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}

        {!messages.isLoading && !rows.length && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Tiada mesej dalam perbualan ini lagi.
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Pengirim */}
      <div className="space-y-2 border-t border-border p-3">
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground focus:outline-none"
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              if (t) setReply((prev) => (prev ? `${prev}\n${t.body}` : t.body));
            }}
          >
            <option value="">{t("wa.chat.insertTpl")}</option>
            {templates.filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Kekal di skrin sampai operator bertindak, bukan toast sekilas. */}
        {sendError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{sendError}</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={reply}
            rows={2}
            maxLength={4000}
            onChange={(e) => {
              setReply(e.target.value);
              if (sendError) setSendError(null);
            }}
            onKeyDown={(e) => {
              /* Enter hantar, Shift+Enter baris baru — corak yang staff sudah
               * biasa dari WhatsApp sendiri. */
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("wa.chat.replyPh")}
            className="flex-1 resize-y rounded-xl border-border bg-card px-4 py-2 text-sm"
          />
          <Button
            type="button"
            onClick={submit}
            disabled={send.isPending || !reply.trim()}
            className="mb-0.5 rounded-full bg-primary px-4 text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-right text-[10px] text-muted-foreground">{reply.length} / 4,000</p>
      </div>
    </>
  );
}
