/**
 * AI Assistant — aliran gaya ejen moden (macam ChatGPT/Codex), 8 Okt 2026.
 *
 * Aduan pemilik: "coba benarkan AI Assistantnya masih aneh flownya. buat
 * bener bener seperti AI Agentnya codex gitu loh".
 *
 * Audit visual (screenshot + DOM) menemukan enam keanehan aliran:
 *   1. Lencana `assistant` (metadat debug) bocor pada setiap jawapan
 *   2. Cadangan pemula laju tapi kosong bertenaga - tiada kumpulan, tiada
 *      cadangan AKSI walaupun backend menyokong imbas kutipan dsb.
 *   3. Tiada tindakan per-mesej: tiada salin, tiada cuba-semula
 *   4. Titik melantun sbg indicator "menaip" - terlalu generik
 *   5. Halaman & chat bergaduh skrol (dua scrollbar nampak serentak)
 *   6. Bubble AI terlalu lebar (80%) - jawapan pendek kelihatan kosong
 *
 * Model perbualan kekal: stateless di pelayan, benang hanya sesi ini —
 * segar, sebab jawapan ialah petikan "angka sekarang".
 */
import { useRef, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Send, User, Copy, Check, RefreshCw, AlertTriangle } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { PageHeader, BackLink } from "@/components/shared";
import { Card } from "@/components/ui/card";
import MiniMarkdown from "@/components/MiniMarkdown";
import { Button } from "@/components/ui/button";

interface AnalystSource {
  key: string;
  period: string;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: AnalystSource[];
  agent?: string;
  error?: boolean;
}

/* Cadangan berkumpulan: DATA (analyst jawab dr laporan sebenar) vs
 * AKSI (menu tertutup yg dilaksana ejen sebenar). Kumpulan menjelaskan
 * APA JENIS benda boleh diminta - bukan sekadar senarai ayat. */
const SUGGESTIONS_EN = [
  {
    group: "Data",
    items: [
      "Revenue this month vs last",
      "New patients this month",
      "Top treatments last 90 days",
      "No-show rate this week",
    ],
  },
  {
    group: "Actions",
    items: [
      "Imbas kutipan (scan overdue)",
      "Semak baris kelulusan",
      "Jeda agen",
    ],
  },
];
const SUGGESTIONS_MS = [
  {
    group: "Data",
    items: [
      "Hasil bulan ini berbanding lepas",
      "Pesakit baharu bulan ini",
      "Rawatan terlaris 90 hari",
      "Kadar no-show minggu ini",
    ],
  },
  {
    group: "Aksi",
    items: [
      "Imbas kutipan (scan tertunggak)",
      "Semak baris kelulusan",
      "Jeda agen",
    ],
  },
];

export default function Assistant() {
  const { t, lang } = usePrefs();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [lastUserMsg, setLastUserMsg] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (message: string) =>
      api.post<{ reply: string; sources: AnalystSource[]; agent?: string }>("/ai/assistant/ask", { message }),
    onSuccess: (data) => {
      setTurns((prev) => [...prev, { role: "assistant", text: data.reply, sources: data.sources ?? [], agent: data.agent }]);
    },
    onError: (e: unknown) => {
      setTurns((prev) => [...prev, { role: "assistant", text: errorMessage(e, t("asst.errorFallback")), error: true } as Turn]);
    },
  });

  /* Auto-scroll HANYA bila giliran baharu tiba — [turns.length] mengekalkan
   * "turun automatik bila ada jawapan" tanpa melawan pengguna menaiki benang. */
  const turnCount = turns.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnCount, ask.isPending]);

  const send = (message: string) => {
    const text = message.trim();
    if (!text || ask.isPending) return;
    setLastUserMsg(text);
    setTurns((prev) => [...prev, { role: "user", text }]);
    setInput("");
    ask.mutate(text);
  };

  /* Cuba semula: buang jawapan (ralat) terakhir, hantar semula soalan
   * terakhir — corak "regenerate" ejen moden. */
  const retry = () => {
    if (!lastUserMsg || ask.isPending) return;
    setTurns((prev) => {
      const next = [...prev];
      if (next.length && next[next.length - 1]!.role === "assistant") next.pop();
      return next;
    });
    ask.mutate(lastUserMsg);
  };

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard dinafikan - kekal ikon salin */ }
  };

  const suggestions = lang === "ms" ? SUGGESTIONS_MS : SUGGESTIONS_EN;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("asst.title")}
        description={t("asst.desc")}
        actions={<BackLink to="/dashboard" />}
      />

      {/* Satu rantaian flex tunggal: lajur tetap tinggi, benang satu-satunya
          penatal (overscroll-contain supaya roda tetikus berhenti padanya),
          komposer melekat di bawah. Tiada skrol halaman bergaduh. */}
      <Card className="flex h-[calc(100vh-11rem)] min-h-[26rem] flex-col overflow-hidden border-border p-0">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {turns.length === 0 && (
            <div className="mx-auto max-w-xl py-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-7 w-7 text-primary" aria-hidden />
              </div>
              <p className="text-base font-semibold text-foreground">{t("asst.emptyTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("asst.emptyHint")}</p>
              <div className="mt-6 space-y-3 text-left">
                {suggestions.map((grp) => (
                  <div key={grp.group}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{grp.group}</p>
                    <div className="flex flex-wrap gap-2">
                      {grp.items.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => send(ex)}
                          className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground transition hover:border-primary/50 hover:bg-primary/5"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) => {
            const isUser = turn.role === "user";
            /* Lencana ejen hanya bila ia EJEN DATA sebenar (insights-ai,
             * finance-ai) - 'assistant' generik disembunyi: semua orang
             * sudah tahu itu pembantu, lencana debug tak membantu sesiapa. */
            const showAgent = !isUser && !!turn.agent && turn.agent !== "assistant";
            return (
              <div key={i} className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
                {!isUser && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                  </div>
                )}
                <div className={`max-w-[72%] ${isUser ? "" : "min-w-0"}`}>
                  <div className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : turn.error
                        ? "border border-red-200 bg-red-50 text-red-700"
                        : "border border-border bg-card text-foreground"
                  }`}>
                    <MiniMarkdown text={turn.text} />
                  </div>
                  {/* Baris tindakan per-jawapan: lencana ejen data + sumber +
                      salin (ikon batal->semak) + cuba-semula bila ralat. */}
                  {!isUser && (
                    <div className="mt-1.5 flex items-center gap-1">
                      {showAgent && (
                        <span className="mr-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">{turn.agent}</span>
                      )}
                      {(turn.sources ?? []).map((s, j) => (
                        <span key={j} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {s.key} · {s.period}
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => copy(turn.text, i)}
                        className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        title={t("common.copy")}
                        aria-label={t("common.copy")}
                      >
                        {copied === i ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                      </button>
                      {turn.error && (
                        <button
                          type="button"
                          onClick={retry}
                          className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          title={t("asst.retry")}
                          aria-label={t("asst.retry")}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isUser && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
                    <User className="h-4 w-4 text-primary-foreground" aria-hidden />
                  </div>
                )}
              </div>
            );
          })}

          {ask.isPending && (
            <div className="flex gap-3">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 animate-pulse text-primary" aria-hidden />
              </div>
              <div className="flex items-center rounded-lg border border-border bg-card px-4 py-3">
                <span className="text-sm text-muted-foreground">{t("asst.thinking")}</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Komposer: kapsul fokus (fokus nampak pada bekas, bukan input
            telanjang) + butang hantar di dalam. */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="shrink-0 border-t border-border p-3 sm:p-4"
        >
          <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-2 py-1.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("asst.inputPh")}
              className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              aria-label={t("asst.inputPh")}
            />
            <Button type="submit" size="sm" className="btn-brand shrink-0" disabled={ask.isPending || !input.trim()}>
              <Send className="h-4 w-4" aria-hidden />
              <span className="sr-only">{t("asst.send")}</span>
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            {t("asst.groundedNote")}
          </p>
        </form>
      </Card>
    </div>
  );
}
