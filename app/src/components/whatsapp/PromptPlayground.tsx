import { usePrefs } from "@/hooks/usePrefs";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  Info,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { api, errorMessage, isAiProviderDown } from "@/lib/api";
import { Panel, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AiModelStatusCard } from "./AiModelStatusCard";
import type { PromptSlot } from "./PromptSlotsEditor";

/**
 * Playground — uji prompt dengan model sebenar sebelum ia hidup.
 *
 * Tiada mesej dihantar ke WhatsApp dan tiada perbualan dicipta. Operator taip
 * seperti seorang pesakit, dan bot menjawab dengan prompt yang dipilih. Ini
 * satu-satunya cara selamat untuk tahu apa pesakit akan lihat.
 */

interface PlaygroundReply {
  slot: number;
  promptName: string;
  reply: string;
  model: string;
  latencyMs: number;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY = 40;

function PlaygroundChat({
  branchId,
  slot,
}: {
  branchId: string;
  slot: PromptSlot;
}) {
  const { t } = usePrefs();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [modelDown, setModelDown] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{
    model: string;
    latencyMs: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  const send = useMutation({
    mutationFn: (message: string) =>
      api.post<PlaygroundReply>(
        `/whatsapp/playground/test?branchId=${encodeURIComponent(branchId)}`,
        {
          slot: slot.slot,
          message,
          history: turns.slice(-MAX_HISTORY),
        },
      ),
    onSuccess: (result, message) => {
      setTurns((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      ]);
      setLastMeta({ model: result.model, latencyMs: result.latencyMs });
      setModelDown(null);
      setInput("");
    },
    onError: (e: unknown) => {
      /* Only a model fault clears the composer. A validation or network error
       * keeps the operator's text so nothing they typed is lost. */
      if (isAiProviderDown(e)) {
        setModelDown(errorMessage(e, t("msg.modelDown")));
        setInput("");
        toast.error(t("msg.modelDownUntested"));
      } else {
        toast.error(errorMessage(e, t("msg.botFailed")));
      }
    },
  });

  function submit() {
    const message = input.trim();
    if (!message || send.isPending) return;
    send.mutate(message);
  }

  return (
    <div className="space-y-4">
      {/* Slot context */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            Menguji: {slot.name || `Slot ${slot.slot}`}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              versi {slot.version}
              {slot.isActive ? " · sedang aktif" : " · belum aktif"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ujian ini tidak menghantar apa-apa ke WhatsApp dan tidak menyimpan
            perbualan.
          </p>
        </div>

        {lastMeta && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {lastMeta.model}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {(lastMeta.latencyMs / 1000).toFixed(1)}s
            </span>
          </div>
        )}
      </div>

      {/* Model unavailable, say it plainly, in its own block, so nobody
          rewrites a working prompt chasing a server config fault. */}
      {modelDown && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{t("wa.pp.noModel")}</p>
            <p className="mt-0.5 text-xs">{modelDown}</p>
            <p className="mt-1.5 text-xs">
              Prompt dan slot anda <strong>selamat tersimpan</strong>, masalah
              ini pada tetapan pelayan, bukan pada prompt anda.
            </p>
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="max-h-[26rem] min-h-[14rem] space-y-3 overflow-y-auto rounded-lg border border-border bg-muted/60 p-4">
        {turns.length === 0 ? (
          <EmptyState
            title={t("pp.noTest")}
            description={t("pp.noTestHint")}
            icon={<Sparkles className="h-6 w-6" />}
          />
        ) : (
          turns.map((turn, i) => (
            <div
              key={i}
              className={
                "flex " + (turn.role === "user" ? "justify-end" : "justify-start")
              }
            >
              <div
                className={
                  "max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap break-words " +
                  (turn.role === "user"
                    ? "bg-teal-600 text-white"
                    : "border border-border bg-card text-foreground")
                }
              >
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {turn.role === "user" ? (
                    <>
                      <User className="h-3 w-3" />
                      Pesakit
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Bot
                    </>
                  )}
                </div>
                {turn.content}
              </div>
            </div>
          ))
        )}

        {send.isPending && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Bot sedang menaip...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="flex flex-wrap items-end gap-2">
        <textarea
          value={input}
          rows={2}
          maxLength={4000}
          disabled={send.isPending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("wa.pp.patientMsgPh")}
          className="min-w-[16rem] flex-1 resize-y rounded-xl border border-border bg-card p-3 text-sm leading-6 text-foreground outline-none focus:border-border focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        />

        <Button
          type="button"
          className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={!input.trim() || send.isPending}
          onClick={submit}
        >
          {send.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Hantar
        </Button>

        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={turns.length === 0 || send.isPending}
          onClick={() => {
            setTurns([]);
            setLastMeta(null);
            setModelDown(null);
            setInput("");
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playground shell                                                    */
/* ------------------------------------------------------------------ */

export function PromptPlayground({
  branchId,
  slotNumber,
  onPickSlot,
}: {
  branchId: string;
  slotNumber: number | null;
  onPickSlot: (slot: number) => void;
}) {
  const { t } = usePrefs();
  const query = useQuery({
    queryKey: ["whatsapp-prompt-slots", branchId],
    queryFn: () =>
      api.get<{ slots: PromptSlot[] }>(
        `/whatsapp/prompt-slots?branchId=${encodeURIComponent(branchId)}`,
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) {
    return (
      <Panel>
        <Skeleton className="h-64 w-full" />
      </Panel>
    );
  }

  if (query.isError) {
    return (
      <Panel>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {errorMessage(query.error, t("ps.loadFailed"))}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 rounded-xl"
            onClick={() => void query.refetch()}
          >
            Cuba semula
          </Button>
        </div>
      </Panel>
    );
  }

  const slots = query.data?.slots ?? [];
  const usable = slots.filter((s) => s.configured && s.prompt.trim().length > 0);
  const selected =
    usable.find((s) => s.slot === slotNumber) ??
    usable.find((s) => s.isActive) ??
    usable[0];

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{t("wa.pp.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Uji jawapan bot sebelum ia dihidupkan. Pilih slot mana untuk diuji.
            </p>
          </div>

          {usable.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {usable.map((s) => (
                <button
                  key={s.slot}
                  type="button"
                  onClick={() => onPickSlot(s.slot)}
                  className={
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
                    (selected?.slot === s.slot
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted-foreground hover:bg-muted")
                  }
                >
                  {s.name || `Slot ${s.slot}`}
                  {s.isActive && " · aktif"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status model terus di sini juga: operator datang ke tab ini khusus
            untuk menguji, jadi sebab kegagalan model mesti kelihatan sebelum
            dia menaip, bukan selepas. */}
        <div className="mt-3">
          <AiModelStatusCard />
        </div>
      </Panel>

      {usable.length === 0 ? (
        <Panel>
          <EmptyState
            title={t("pp.noPrompt")}
            description="Tulis dan simpan sekurang-kurangnya satu slot prompt dahulu, kemudian kembali ke sini."
            icon={<AlertTriangle className="h-6 w-6" />}
          />
        </Panel>
      ) : (
        <Panel>
          {selected && (
            <PlaygroundChat
              key={`${branchId}-${selected.slot}-${selected.version}`}
              branchId={branchId}
              slot={selected}
            />
          )}
        </Panel>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Jika bot pulangkan ralat berkaitan kunci API, tetapan model belum
          dilengkapkan pada pelayan. Prompt dan slot tetap selamat disimpan.
        </span>
      </div>
    </div>
  );
}
