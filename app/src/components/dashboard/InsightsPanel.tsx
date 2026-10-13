import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { usePrefs } from "@/hooks/usePrefs";
import { Panel } from "@/components/shared";
import { Sparkles, ChevronRight, TrendingUp, Stethoscope, ClipboardList, User } from "lucide-react";
import { api } from "@/lib/api";

/* ============================================================================
 * InsightsPanel — proactive, deterministic cards from Insight AI (Phase C).
 *
 * GET /ai/insights/scan?period=30D returns COMPUTED cards (ruleKey, severity,
 * category, title, detail, actionHref) — no model call, no guessing. The scan
 * happens on demand; nothing is invented here.
 *
 * Design notes (dental-erp AIInsight adapted to our honesty rules):
 * - A healthy clinic returns ZERO cards — silence, not a fake "all good".
 * - The panel hides itself entirely when empty (no empty box on the
 *   dashboard — the reader sees only what needs attention).
 * - 403 (non-HQ or paused agent) also hides the panel: no permission, no
 *   noise, no broken box.
 * ========================================================================== */

interface InsightCard {
  ruleKey: string;
  severity: "info" | "warning" | "critical";
  category: "revenue" | "clinical" | "operational" | "patient";
  title: string;
  detail: string;
  actionHref: string;
}

const SEVERITY_STYLE: Record<InsightCard["severity"], string> = {
  info: "bg-blue-50/60 border-blue-200 text-blue-900",
  warning: "bg-amber-50/60 border-amber-200 text-amber-900",
  critical: "bg-red-50/60 border-red-200 text-red-900",
};

const SEVERITY_BADGE: Record<InsightCard["severity"], string> = {
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

const CATEGORY_ICON: Record<InsightCard["category"], React.ReactNode> = {
  revenue: <TrendingUp className="h-4 w-4" />,
  clinical: <Stethoscope className="h-4 w-4" />,
  operational: <ClipboardList className="h-4 w-4" />,
  patient: <User className="h-4 w-4" />,
};

export function InsightsPanel({ period = "30D" }: { period?: string }) {
  const { t } = usePrefs();
  const navigate = useNavigate();

  const scan = useQuery({
    queryKey: ["ai", "insights", period],
    queryFn: () => api.get<{ cards: InsightCard[] }>(`/ai/insights/scan?period=${period}`),
    retry: false,
    staleTime: 60_000,
  });

  /* Silence is the design: no cards (healthy clinic), no permission (non-HQ),
   * or a paused agent — the panel simply does not exist on screen. */
  if (scan.isLoading) return null;
  const cards = scan.data?.cards ?? [];
  if (cards.length === 0) return null;

  return (
    <Panel
      title={t("dash.insights.title")}
      subtitle={t("dash.insights.sub")}
      className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
    >
      <div className="flex items-start gap-2 mb-3">
        <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">{t("dash.insights.desc")}</p>
      </div>
      <div className="space-y-2">
        {cards.map((c) => (
          <button
            key={c.ruleKey}
            type="button"
            onClick={() => navigate(c.actionHref)}
            className={`w-full text-left rounded-lg border p-3 transition-all hover:shadow-md ${SEVERITY_STYLE[c.severity]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <span className="shrink-0 text-muted-foreground">{CATEGORY_ICON[c.category]}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold truncate">{c.title}</h4>
                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${SEVERITY_BADGE[c.severity]}`}>
                      {c.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 leading-relaxed">{c.detail}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

export default InsightsPanel;
