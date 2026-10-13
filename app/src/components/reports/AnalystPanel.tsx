import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, errorMessage, isAiProviderDown, ApiRequestError } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, ShieldAlert, TriangleAlert } from "lucide-react";
import AnalystAnswer from "@/components/reports/AnalystAnswer";

/* ============================================================================
 * AnalystPanel — "Tanya Data" (Insight AI), surfaced on Reports & Analytics.
 *
 * Endpoint: POST /ai/analyst/ask  (backend already built; HQ-only).
 *
 * WHY THE SUGGESTED QUESTIONS ARE HARD-CODED
 * The backend resolver is DETERMINISTIC KEYWORD MATCHING, not a model decision
 * (domain/analyst-question.ts): the model never chooses which data it sees, it
 * only narrates. A question that matches no topic returns the capability list
 * with keys: [] and NO model call — honest, but it reads to a user as "the AI
 * is broken".
 *
 * So these chips are the questions we KNOW resolve, verified against the
 * resolver's own regexes and the live endpoint. They are phrased in Malay
 * because the resolver's topics are Malay-first: "pesakit baharu" matches,
 * but the English "new patients" does NOT (the regex requires
 * `new patient\b`, so the plural misses). Offering a chip that silently
 * fails would be worse than offering none.
 *
 * What this panel deliberately does NOT do: it does not invent numbers, and it
 * does not hide the sources. Every answer shows which report(s) and which
 * period it came from, so a figure can be traced back to the Reports page.
 * ========================================================================== */

interface AnalystSource {
  key: string;
  period: string;
}

interface AnalystAnswer {
  reply: string;
  sources?: AnalystSource[];
}

interface Turn {
  question: string;
  answer: string;
  sources: AnalystSource[];
}

/* Verified against resolveAnalystQuestion(): each must produce a non-empty
 * `keys` array, or the endpoint answers with the capability list instead. */
/* Saranan soalan ikut bahasa UI; analyst memahami kedua-dua (BM/EN). */
const SUGGESTIONS: readonly string[] = [
  "an.sugg1", "an.sugg2", "an.sugg3", "an.sugg4", "an.sugg5", "an.sugg6",
];

const MAX_TURNS = 6;

export default function AnalystPanel() {
  const { t } = usePrefs();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const ask = useMutation({
    mutationFn: (message: string) => api.post<AnalystAnswer>("/ai/analyst/ask", { message }),
    onSuccess: (data, message) => {
      setTurns((prev) =>
        [{ question: message, answer: data?.reply ?? "", sources: data?.sources ?? [] }, ...prev].slice(0, MAX_TURNS),
      );
      setQuestion("");
    },
  });

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || ask.isPending) return;
    ask.mutate(message);
  };

  /* A 403 here is not a bug — the endpoint is HQ-only by design. Saying so
   * plainly beats showing "Request failed". */
  const isHqOnly = ask.error instanceof ApiRequestError && ask.error.status === 403;

  return (
    <Panel
      title={t("rep.analyst.title")}
      className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">{t("rep.analyst.desc")}</p>
        </div>

        {/* Suggested questions, the paths that are known to resolve. */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              disabled={ask.isPending}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-teal-400 hover:text-foreground disabled:opacity-50"
            >
              {t(s)}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("rep.analyst.placeholder")}
            rows={2}
            className="rounded-xl resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(question);
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{t("rep.analyst.hint")}</p>
            <Button
              size="sm"
              className="rounded-xl"
              disabled={!question.trim() || ask.isPending}
              onClick={() => submit(question)}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {ask.isPending ? t("rep.analyst.asking") : t("rep.analyst.ask")}
            </Button>
          </div>
        </div>

        {/* Errors: distinguish "you're not HQ" from "model is down" from "unknown". */}
        {ask.error && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-900">
            <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {isHqOnly
                ? t("rep.analyst.hqOnly")
                : isAiProviderDown(ask.error)
                  ? t("rep.analyst.modelDown")
                  : errorMessage(ask.error, t("rep.analyst.failed"))}
            </span>
          </div>
        )}

        {turns.length === 0 && !ask.error && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            {t("rep.analyst.empty")}
          </p>
        )}

        <div className="space-y-3">
          {turns.map((turn, i) => (
            <div key={`${turn.question}-${i}`} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <p className="text-xs font-semibold text-foreground">{turn.question}</p>
              <AnalystAnswer text={turn.answer} />
              {turn.sources.length > 0 && (
                <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                  {t("rep.analyst.sources")}:{" "}
                  {turn.sources.map((s) => `${s.key} (${s.period})`).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
