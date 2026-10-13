import { usePrefs } from "@/hooks/usePrefs";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Building2, CheckCircle2, Megaphone, Send, XCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * HQ view of WhatsApp campaigns — every branch, side by side.
 *
 * WHAT THIS IS FOR
 *
 * HQ runs the meeting: "this month we push scaling, 20% off". Each branch then
 * runs its own campaign. HQ does not send anything — it WATCHES, and the point of
 * watching is comparison: which branch is on track, which is behind, which has
 * run nothing at all.
 *
 * A single list of campaigns would hide the most important row. A branch with NO
 * campaign is invisible in a list of campaigns, and that is exactly what the
 * meeting needs to see — so every branch gets a row, including the quiet ones.
 *
 * WHY THERE IS NO SEND BUTTON HERE
 *
 * Sending is the branch's job, and the backend enforces it: queueBlast refuses
 * anyone who is not a branch_manager, and refuses a branch they do not belong to.
 * Putting a blast form on this screen would offer an action that fails — worse
 * than not offering it.
 */

interface CampaignProgress {
  elapsed: number;
  days: number;
  expected: number;
  onTrack: boolean;
  done: boolean;
  text: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  startDate: string | null;
  endDate: string | null;
  cancelled: boolean;
  progress: CampaignProgress | null;
  progressText: string;
}

interface ProgressBoard {
  campaigns: Campaign[];
  behindCount: number;
  summary: string;
}

interface Branch {
  id: string;
  shortName: string;
}

export default function CampaignHqBoard({ branchId }: { branchId?: string }) {
  const { t } = usePrefs();
  const branches = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Branch[]>("/admin/branches"),
  });

  const board = useQuery({
    queryKey: ["campaign-progress", branchId ?? "all"],
    queryFn: () =>
      api.get<ProgressBoard>(
        `/whatsapp/campaigns/progress${branchId ? `?branchId=${branchId}` : ""}`,
      ),
  });

  if (board.isLoading || branches.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const campaigns = board.data?.campaigns ?? [];
  const rows = branches.data ?? [];

  /* Group by branch, and keep branches with NO campaign.
   *
   * This is the whole reason the board exists. A branch that has run nothing is
   * the one the meeting is about, and it would vanish from any list built only
   * from campaigns. */
  const byBranch = new Map<string, Campaign[]>();
  for (const r of rows) byBranch.set(r.id, []);
  const orphan: Campaign[] = [];
  for (const c of campaigns) {
    const key = (c as Campaign & { branchId?: string }).branchId;
    if (key && byBranch.has(key)) byBranch.get(key)!.push(c);
    else orphan.push(c);
  }

  const totalSent = campaigns.reduce((n, c) => n + c.sentCount, 0);
  const totalRecipients = campaigns.reduce((n, c) => n + c.totalCount, 0);
  const running = campaigns.filter((c) => !c.cancelled && !c.progress?.done).length;
  const behind = board.data?.behindCount ?? 0;
  const silent = rows.filter((r) => (byBranch.get(r.id) ?? []).length === 0).length;

  return (
    <div className="space-y-6">
      {/* ---- Ringkasan keseluruhan ---- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Megaphone className="h-5 w-5" />}
          label={t("camp.running")}
          value={running}
          tint="teal"
        />
        <Stat
          icon={<Send className="h-5 w-5" />}
          label={t("camp.messagesSent")}
          value={`${totalSent.toLocaleString()}/${totalRecipients.toLocaleString()}`}
          tint="blue"
        />
        <Stat
          icon={<AlertTriangle className="h-5 w-5" />}
          label={t("wa.camp.late")}
          value={behind}
          tint={behind > 0 ? "amber" : "slate"}
        />
        <Stat
          icon={<Building2 className="h-5 w-5" />}
          label={t("camp.branchNotStarted")}
          value={silent}
          tint={silent > 0 ? "amber" : "slate"}
        />
      </div>

      {/* ---- Pecahan ikut cawangan ---- */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-bold text-foreground">{t("wa.camp.byBranch")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Setiap cawangan urus kempen sendiri. HQ memantau sahaja.
            </p>
          </div>
        </div>

        <div className="divide-y divide-border">
          {rows.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Tiada cawangan dijumpai.
            </p>
          )}

          {rows.map((r) => {
            const mine = byBranch.get(r.id) ?? [];
            const running = mine.filter((c) => !c.cancelled);
            const done = mine.filter((c) => c.progress?.done);
            const late = mine.filter((c) => c.progress && !c.progress.done && !c.progress.onTrack);
            const sent = mine.reduce((n, c) => n + c.sentCount, 0);
            const total = mine.reduce((n, c) => n + c.totalCount, 0);

            return (
              <div key={r.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {r.shortName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {mine.length === 0
                        ? t("camp.none")
                        : t("camp.summary", { n: mine.length, sent, total })}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {late.length > 0 && (
                      <Pill tone="amber" icon={<AlertTriangle className="h-3 w-3" />}>
                        {late.length} lewat
                      </Pill>
                    )}
                    {done.length > 0 && (
                      <Pill tone="teal" icon={<CheckCircle2 className="h-3 w-3" />}>
                        {done.length} selesai
                      </Pill>
                    )}
                    {running.length > 0 && !done.length && !late.length && (
                      <Pill tone="blue" icon={<Activity className="h-3 w-3" />}>
                        berjalan
                      </Pill>
                    )}
                    {mine.length === 0 && (
                      <Pill tone="slate" icon={<XCircle className="h-3 w-3" />}>
                        belum mula
                      </Pill>
                    )}
                  </div>
                </div>

                {/* Bar kemajuan per campaign dalam cawangan ini */}
                <div className="mt-3 space-y-2">
                  {mine.map((c) => (
                    <div key={c.id} className="flex items-center gap-3">
                      <span className="w-40 flex-shrink-0 truncate text-xs text-muted-foreground">
                        {c.name}
                      </span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            c.progress?.done
                              ? "bg-teal-500"
                              : late.some((l) => l.id === c.id)
                                ? "bg-amber-400"
                                : "bg-cyan-500"
                          }`}
                          style={{
                            width: `${
                              c.totalCount > 0
                                ? Math.min(100, Math.round((c.sentCount / c.totalCount) * 100))
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <span className="w-32 flex-shrink-0 text-right text-[11px] text-muted-foreground">
                        {c.progressText}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {orphan.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {orphan.length} kempen tanpa cawangan yang sah (cawangan mungkin dipadam).
        </p>
      )}
    </div>
  );
}

function Stat({
  icon, label, value, tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tint: "teal" | "blue" | "amber" | "slate";
}) {
  const tones = {
    teal: "bg-accent text-foreground",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-muted text-muted-foreground",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className={`inline-flex rounded-xl p-2.5 ${tones[tint]}`}>{icon}</div>
      <p className="mt-3 text-2xl font-extrabold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Pill({
  tone, icon, children,
}: {
  tone: "teal" | "blue" | "amber" | "slate";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    teal: "bg-accent text-foreground border-border",
    blue: "bg-cyan-50 text-cyan-700 border-cyan-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    slate: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
