import { type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Inbox } from "lucide-react";

// ---------------------------------------------------------------------------
// Status badge — consistent colors across all modules
// ---------------------------------------------------------------------------
const statusColors: Record<string, string> = {
  booked: "bg-blue-100 text-blue-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  checked_in: "bg-amber-100 text-amber-700",
  in_progress: "bg-violet-100 text-violet-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-slate-100 text-slate-500",
  no_show: "bg-red-100 text-red-700",
  issued: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  refunded: "bg-slate-100 text-slate-500",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  proposed: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  draft: "bg-slate-100 text-slate-500",
  scheduled: "bg-violet-100 text-violet-700",
  running: "bg-green-100 text-green-700",
  ai_handled: "bg-emerald-100 text-emerald-700",
  human_takeover: "bg-amber-100 text-amber-700",
  closed: "bg-slate-100 text-slate-500",
  open: "bg-red-100 text-red-700",
  resolved: "bg-green-100 text-green-700",
  done: "bg-green-100 text-green-700",
  low: "bg-slate-100 text-slate-500",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

const statusLabels: Record<string, string> = {
  checked_in: "Checked In", in_progress: "In Progress", no_show: "No Show",
  ai_handled: "AI Handled", human_takeover: "Human Takeover",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  /* Defensive: status may be undefined/null while a query is resolving —
     .replace on undefined crashes the whole React tree (blank page). */
  const s = status ?? "unknown";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", statusColors[s] ?? "bg-slate-100 text-slate-600", className)}>
      {statusLabels[s] ?? s.replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI stat card
// ---------------------------------------------------------------------------
export function StatCard({ title, value, sub, icon, trend, loading }: {
  title: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode;
  trend?: { value: number; label?: string }; loading?: boolean;
}) {
  if (loading) {
    return (
      <Card><CardContent className="p-5">
        <Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-32 mb-2" /><Skeleton className="h-3 w-20" />
      </CardContent></Card>
    );
  }
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-[13px] font-medium text-slate-500">{title}</p>
          {icon && <div className="text-emerald-600 bg-emerald-50 rounded-lg p-1.5">{icon}</div>}
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        <div className="mt-1 flex items-center gap-2">
          {trend && (
            <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", trend.value >= 0 ? "text-emerald-600" : "text-red-600")}>
              {trend.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend.value)}%
            </span>
          )}
          {sub && <p className="text-xs text-slate-400">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page header (sticky)
// ---------------------------------------------------------------------------
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-4 bg-white/85 backdrop-blur border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-slate-100 p-4 text-slate-400 mb-3">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-400 mt-1 max-w-sm">{description}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card with title
// ---------------------------------------------------------------------------
export function Panel({ title, subtitle, children, className, action }: {
  title?: string; subtitle?: string; children: ReactNode; className?: string; action?: ReactNode;
}) {
  return (
    <Card className={className}>
      {(title || action) && (
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-[15px] font-semibold">{title}</CardTitle>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </CardHeader>
      )}
      <CardContent className={title ? "pt-0" : ""}>{children}</CardContent>
    </Card>
  );
}

export function LoadingGrid({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cards }).map((_, i) => <StatCard key={i} title="" value="" loading />)}
    </div>
  );
}

export { Badge };
