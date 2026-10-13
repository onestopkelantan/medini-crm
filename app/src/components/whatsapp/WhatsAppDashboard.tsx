import { usePrefs } from "@/hooks/usePrefs";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  MessageSquare,
  Power,
  QrCode,
  Send,
  Smartphone,
  Unplug,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * Dashboard — paparan utama WhatsApp Hub.
 *
 * Bila dibuka, operator terus nampak: nombor mana yang dipautkan, sama ada AI
 * menjawab, dan apa yang perlukan tindakan. Tiada klik tambahan diperlukan.
 */

export interface Channel {
  id: string;
  phone: string;
  sessionName?: string;
  status: string;
  healthScore: number;
  aiReplyEnabled?: boolean;
  sentTodayCount?: number;
  lastSeenAt?: string;
}

interface Conversation {
  id: string;
  contactPhone: string;
  status: string;
  unreadCount: number;
  needsHuman?: boolean;
  needsHumanReason?: string;
  lastMessageAt?: string;
}

interface Props {
  channels: Channel[];
  conversations: Conversation[];
  loadingChannels: boolean;
  loadingConversations: boolean;
  onShowQr: (channelId: string) => void;
  onRegisterNumber: () => void;
  onGoToQueue: (filter: "needs_human" | "unanswered" | "all") => void;
}

/** Relative time in Malay, coarse enough to stay stable between renders. */
function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMin = Math.floor((Date.now() - then) / 60000);
  if (diffMin < 1) return "baru sahaja";
  if (diffMin < 60) return `${diffMin} min lalu`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} jam lalu`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} hari lalu`;
}

function healthTone(score: number): { bar: string; text: string; label: string } {
  if (score >= 80) return { bar: "bg-teal-500", text: "text-foreground", label: "Sihat" };
  if (score >= 50) return { bar: "bg-amber-500", text: "text-amber-700", label: "Perlu perhatian" };
  return { bar: "bg-red-500", text: "text-red-700", label: "Bermasalah" };
}

export function WhatsAppDashboard({
  channels,
  conversations,
  loadingChannels,
  loadingConversations,
  onShowQr,
  onRegisterNumber,
  onGoToQueue,
}: Props) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const primary = channels[0] ?? null;
  const connected = Boolean(primary && primary.status === "working");
  const needsQr = Boolean(primary && (primary.status === "need_qr" || primary.status === "stopped"));

  const toggleAi = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/whatsapp/channels/${id}/ai-reply`, { enabled }),
    onSuccess: (_r, vars) => {
      toast.success(vars.enabled ? "AI diaktifkan" : "AI dimatikan");
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wd.toggleFailed"))),
    onSettled: () => setBusy(null),
  });

  const unreadTotal = conversations.reduce((n, c) => n + (c.unreadCount ?? 0), 0);
  const needsHuman = conversations.filter((c) => c.needsHuman);
  const unanswered = conversations.filter(
    (c) => (c.unreadCount ?? 0) > 0 && !c.needsHuman,
  );

  /* ---------------- Tiada nombor didaftarkan ---------------- */
  if (!loadingChannels && !primary) {
    return (
      <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Unplug className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">{t("wd.noNumber")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Daftarkan nombor cawangan ini untuk mula menerima booking automatik.
            </p>
          </div>
          <Button
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onRegisterNumber}
          >
            <Smartphone className="mr-2 h-4 w-4" />
            Daftar & Pautkan Nombor
          </Button>
        </div>
      </Panel>
    );
  }

  /* ---------------- Belum dipautkan ---------------- */
  if (!loadingChannels && primary && !connected) {
    return (
      <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <QrCode className="h-8 w-8 text-amber-500" />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {needsQr ? t("wd.notLinked") : t("wd.connecting")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {primary.phone} · {t("wa.scanHint")}
            </p>
          </div>
          <Button
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy === primary.id}
            onClick={() => {
              setBusy(primary.id);
              onShowQr(primary.id);
            }}
          >
            <QrCode className="mr-2 h-4 w-4" />
            Pautkan WhatsApp
          </Button>
        </div>
      </Panel>
    );
  }

  /* ---------------- Connected ---------------- */
  const health = healthTone(primary?.healthScore ?? 0);

  return (
    <div className="space-y-4">
      {/* Status header */}
      <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-teal-500" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">{t("wa.dash.connected")}</p>
              <p className="text-xs text-muted-foreground">
                {primary?.phone}
                {primary?.sessionName ? ` · ${primary.sessionName}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Aktif {relativeTime(primary?.lastSeenAt)}
            </span>
            {primary && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-border text-muted-foreground hover:bg-muted"
                onClick={() => onShowQr(primary.id)}
              >
                <QrCode className="mr-1.5 h-3.5 w-3.5" />
                QR
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {/* Toggle AI */}
      <Panel
        className={`glass-card border shadow-sm rounded-lg p-5 ${
          primary?.aiReplyEnabled
            ? "bg-accent/70 border-border"
            : "bg-card border-border"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                primary?.aiReplyEnabled ? "bg-teal-500 text-white" : "bg-muted text-muted-foreground"
              }`}
            >
              <Power className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                AI Reply {primary?.aiReplyEnabled ? t("wd.active") : t("wd.off")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {primary?.aiReplyEnabled
                  ? t("wd.aiOnDesc")
                  : t("wd.aiOff")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(primary?.aiReplyEnabled)}
              disabled={!primary || toggleAi.isPending}
              onCheckedChange={(v) => {
                if (!primary) return;
                setBusy(primary.id);
                toggleAi.mutate({ id: primary.id, enabled: v });
              }}
            />
            <span className="text-xs font-medium text-muted-foreground">
              {primary?.aiReplyEnabled ? "AKTIF" : "MATI"}
            </span>
          </div>
        </div>
      </Panel>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          label={t("wa.dash.health")}
          value={`${primary?.healthScore ?? 0}/100`}
          hint={health.label}
          tone={health.text}
        />
        <KpiCard
          icon={<MessageSquare className="h-4 w-4" />}
          label={t("wa.dash.conversations")}
          value={loadingConversations ? "…" : String(conversations.length)}
          hint="Aktif"
          onClick={() => onGoToQueue("all")}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label={t("wd.unanswered")}
          value={loadingConversations ? "…" : String(unreadTotal)}
          hint={unanswered.length ? t("wd.needsAction", { n: unanswered.length }) : t("wd.allAnswered")}
          tone={unreadTotal > 0 ? "text-amber-700" : undefined}
          onClick={() => onGoToQueue("unanswered")}
        />
        <KpiCard
          icon={<Send className="h-4 w-4" />}
          label={t("wd.sentToday")}
          value={String(primary?.sentTodayCount ?? 0)}
          hint="Had harian dikawal di AI Manager"
        />
      </div>

      {/* Health bar */}
      <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{t("wa.dash.connHealth")}</p>
          <p className={`text-xs font-semibold ${health.text}`}>
            {primary?.healthScore ?? 0}/100 · {health.label}
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${health.bar}`}
            style={{ width: `${Math.min(100, Math.max(0, primary?.healthScore ?? 0))}%` }}
          />
        </div>
      </Panel>

      {/* Perlu perhatian */}
      {needsHuman.length > 0 && (
        <Panel className="glass-card border border-amber-200 bg-amber-50/70 shadow-sm rounded-lg p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => onGoToQueue("needs_human")}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Perlu Reply Manual ({needsHuman.length})
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  AI tidak dapat menyelesaikan {needsHuman.length} perbualan ini. Pegawai perlu balas.
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-amber-900 underline underline-offset-2">
              Lihat Senarai
            </span>
          </button>
        </Panel>
      )}

      {/* Senarai ringkas perbualan terkini */}
      {!loadingConversations && conversations.length > 0 && (
        <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{t("wa.dash.recent")}</p>
            <button
              type="button"
              className="text-xs font-medium text-foreground underline underline-offset-2"
              onClick={() => onGoToQueue("all")}
            >
              Lihat semua
            </button>
          </div>
          <div className="divide-y divide-border">
            {conversations.slice(0, 5).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onGoToQueue("all")}
                className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{c.contactPhone}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.needsHuman
                      ? `Perlu manual${c.needsHumanReason ? ` · ${c.needsHumanReason}` : ""}`
                      : c.status}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.needsHuman && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      Manual
                    </span>
                  )}
                  {(c.unreadCount ?? 0) > 0 && (
                    <span className="rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{relativeTime(c.lastMessageAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {loadingChannels && <Skeleton className="h-32 w-full rounded-lg" />}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`glass-card w-full rounded-lg border border-border bg-card p-4 text-left shadow-lg ${
        onClick ? "transition hover:border-border hover:bg-card" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold ${tone ?? "text-foreground"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </Tag>
  );
}
