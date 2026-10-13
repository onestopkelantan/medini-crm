import { usePrefs } from "@/hooks/usePrefs";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  Ban,
  Bell,
  CheckCheck,
  MessageSquare,
  ServerCrash,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * FASA 5D-B — the notification bell.
 *
 * Replaces a hardcoded menu that listed three invented items ("3 unread WhatsApp
 * messages") regardless of what had actually happened. Those numbers were not
 * derived from anything, so the bell could not be trusted and an operator learns
 * to ignore it. Everything shown here comes from a real event.
 *
 * WHAT THE DESIGN IS PROTECTING
 *
 * Two properties matter more than the visuals:
 *
 *   1. ONE PLACE PER EVENT, NOT ONE PER OCCURRENCE. Ten patients waiting is one
 *      row reading "10 pesakit menunggu", not ten rows. The backend coalesces;
 *      this view shows the result. A list that grows with every event is a list
 *      nobody reads to the end.
 *
 *   2. UNREAD IS THE SIGNAL. The badge counts unread only. An operator who has
 *      dealt with something should stop seeing it at the top — otherwise the
 *      badge becomes permanent furniture and stops meaning anything.
 */

interface Notification {
  id: string;
  kind: "human_needed" | "opt_out" | "channel_error" | "blast_blocked";
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  entityId: string | null;
  occurrenceCount: number;
  firstAt: string;
  lastAt: string;
  readAt: string | null;
  branchId: string | null;
  branchName: string | null;
}

/**
 * Where clicking a notification should take the operator.
 *
 * A notification that cannot be acted on is just noise, so each kind has a
 * destination. A waiting patient belongs in the inbox; a refused blast belongs
 * where the blast was composed.
 */
const DESTINATION: Record<Notification["kind"], string> = {
  human_needed: "/whatsapp",
  opt_out: "/whatsapp",
  channel_error: "/whatsapp-blast",
  blast_blocked: "/whatsapp-blast",
};

/** Icon and colour per kind, so the list is scannable without reading. */
function appearance(n: Notification) {
  const critical = n.severity === "critical";
  switch (n.kind) {
    case "human_needed":
      return {
        Icon: MessageSquare,
        className: critical ? "text-rose-600" : "text-foreground",
      };
    case "opt_out":
      return { Icon: Ban, className: "text-muted-foreground" };
    case "channel_error":
      return { Icon: ServerCrash, className: "text-rose-600" };
    case "blast_blocked":
      return { Icon: ShieldAlert, className: "text-amber-600" };
  }
}

/** "3 minit lalu" — relative, because the operator cares about recency. */
function since(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "baru sahaja";
  if (min < 60) return `${min} minit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  return `${Math.floor(hr / 24)} hari lalu`;
}

export default function NotificationBell() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ["wa-notifications"],
    queryFn: () => api.get<Notification[]>("/whatsapp/notifications?limit=20"),
    /* Polled rather than pushed: the badge must be right after a reload, and a
     * one-minute interval is frequent enough for a front desk while keeping the
     * cost to one indexed count. A websocket would be better and is not worth
     * the operational surface until there is real traffic. */
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const items = useMemo(() => list.data ?? [], [list.data]);
  const unread = useMemo(() => items.filter((n) => !n.readAt).length, [items]);

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/whatsapp/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post<{ marked: number }>("/whatsapp/notifications/read-all", {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["wa-notifications"] });
      toast.success(r?.marked ? t("notif.markedRead", { n: r.marked }) : t("notif.allRead"));
    },
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="relative h-10 w-10 flex items-center justify-center rounded-full border border-border bg-card hover:bg-accent transition"
        aria-label={unread > 0 ? t("notif.unread", { n: unread }) : t("notif.title")}
      >
        <Bell className="h-[18px] w-[18px] text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center shadow">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-96 rounded-xl p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <DropdownMenuLabel className="p-0">
            {t("notif.title")} {unread > 0 && <span className="text-muted-foreground">({t("notif.unreadShort", { n: unread })})</span>}
          </DropdownMenuLabel>
          {unread > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                markAll.mutate();
              }}
              className="flex items-center gap-1 text-xs text-foreground hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tanda semua
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />

        <div className="max-h-96 overflow-y-auto">
          {list.isLoading && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("common.loading")}</p>
          )}

          {!list.isLoading && items.length === 0 && (
            <div className="px-3 py-8 text-center">
              <Bell className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                Tiada notifikasi. Pesakit yang menunggu, saluran bermasalah dan blast
                yang ditolak akan muncul di sini.
              </p>
            </div>
          )}

          {items.map((n) => {
            const { Icon, className } = appearance(n);
            return (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  navigate(DESTINATION[n.kind]);
                  setOpen(false);
                }}
                className="flex items-start gap-2.5 rounded-none px-3 py-2.5 focus:bg-muted"
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      n.readAt ? "font-normal text-muted-foreground" : "font-semibold text-foreground"
                    }`}
                  >
                    {n.title}
                    {n.occurrenceCount > 1 && (
                      <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                        ×{n.occurrenceCount}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{since(n.lastAt)}</p>
                </div>
                {!n.readAt && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                )}
              </DropdownMenuItem>
            );
          })}
        </div>

        {items.some((n) => n.severity === "critical" && !n.readAt) && (
          <>
            <DropdownMenuSeparator className="my-0" />
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{t("nb.urgent")}</span>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
