import { type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePrefs } from "@/hooks/usePrefs";
import { translateStatus } from "@/lib/i18n";
import { TrendingUp, TrendingDown, Inbox, ArrowLeft } from "lucide-react";
import { Link } from "react-router";

// ---------------------------------------------------------------------------
// Status badge — consistent colors across all modules
// ---------------------------------------------------------------------------
const statusColors: Record<string, string> = {
  booked: "bg-blue-100 text-blue-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  checked_in: "bg-amber-100 text-amber-700",
  in_progress: "bg-violet-100 text-violet-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-red-100 text-red-700",
  issued: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  refunded: "bg-muted text-muted-foreground",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  proposed: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-violet-100 text-violet-700",
  running: "bg-green-100 text-green-700",
  ai_handled: "bg-emerald-100 text-emerald-700",
  human_takeover: "bg-amber-100 text-amber-700",
  closed: "bg-muted text-muted-foreground",
  open: "bg-red-100 text-red-700",
  resolved: "bg-green-100 text-green-700",
  done: "bg-green-100 text-green-700",
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

/* Status temujanji yang ada kunci i18n st.* — dipetakan di translateStatus. */
const ST_STATUSES = new Set(["booked", "confirmed", "checked-in", "waiting", "called", "in-progress", "completed", "cancelled", "no-show"]);
const stStatusKey = (s: string) => ST_STATUSES.has(s);

const statusLabels: Record<string, string> = {
  checked_in: "Checked In", in_progress: "In Progress", no_show: "No Show",
  ai_handled: "AI Handled", human_takeover: "Human Takeover",
};

/* Warna semantik status saluran WhatsApp — pemilik 10 Okt: "kalau emg
 * stopped yg dihighlight ya yg stopped". Sebelum ini SEMUA status
 * pakai teal yang sama, jadi FAILED nampak sama penting dgn WORKING:
 *
 *   working  = hijau   (sihat, jangan sentuh)
 *   need_qr  = amber   (perlu tindakan: imbas QR)
 *   starting = biru    (proses, tunggu)
 *   stopped  = kelabu  (diam — menonjol dgn latar ring kuning di baris)
 *   failed   = merah   (rosak — laluan Tindakan di atas)
 *
 * Kunci baharu sahaja; status lama (pending/medium/high...) kekal. */
const waStatusColors: Record<string, string> = {
  working: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  connected: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  need_qr: "bg-amber-100 text-amber-800 ring-1 ring-amber-300 font-semibold",
  starting: "bg-sky-100 text-sky-800 ring-1 ring-sky-300",
  stopped: "bg-muted text-muted-foreground ring-1 ring-border",
  failed: "bg-red-100 text-red-800 ring-1 ring-red-300 font-semibold",
};

export function StatusBadge({ status, className, statusText }: { status: string; className?: string; statusText?: string }) {
  /* Defensive: status may be undefined/null while a query is resolving —
     .replace on undefined crashes the whole React tree (blank page). */
  const s = status ?? "unknown";
  /* Label mengikut bahasa semasa (anti-bocor EN/BM): kunci st.* diterjemah,
     nilai mentah API hanya sebagai fallback terakhir. */
  const { lang } = usePrefs();
  const localized = stStatusKey(s) ? translateStatus(lang, s) : (statusLabels[s] ?? s.replace(/_/g, " "));
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", statusColors[s] ?? waStatusColors[s] ?? "bg-muted text-muted-foreground", className)}>
      {statusText ?? localized}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * BackLink — pautan "Kembali" piawai untuk sub-halaman (waitlist, rekod
 * tempahan, jadual doktor...). UX: pengguna deep-link / dari telefon
 * sentiasa ada jalan pulang satu-klik ke halaman induk.
 * ------------------------------------------------------------------------- */
export function BackLink({ to, label }: { to: string; label?: string }) {
  const { t } = usePrefs();
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-emerald-600">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label ?? t("common.back")}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// KPI stat card
// ---------------------------------------------------------------------------
export function StatCard({ title, value, sub, icon, trend, loading, className }: {
  title: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode;
  trend?: { value: number; label?: string }; loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <Card className={className}><CardContent className="p-5">
        <Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-32 mb-2" /><Skeleton className="h-3 w-20" />
      </CardContent></Card>
    );
  }
  return (
    <Card className={cn("hover:shadow-md transition-shadow", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
          {icon && <div className="text-emerald-600 bg-emerald-50 rounded-lg p-1.5">{icon}</div>}
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <div className="mt-1 flex items-center gap-2">
          {trend && (
            <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", trend.value >= 0 ? "text-emerald-600" : "text-red-600")}>
              {trend.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend.value)}%
            </span>
          )}
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
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
    <div className="sticky top-0 z-20 -mx-6 px-6 py-4 bg-card border-b border-border flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
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
      <div className="rounded-full bg-muted p-4 text-muted-foreground mb-3">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
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
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
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
