import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader, StatCard, Panel, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, CalendarDays, Clock, CheckCircle2 } from "lucide-react";

/* S10 T1: dashboard consumes the real backend contract. */
interface DashboardContext {
  date: string;
  branchId: string;
  patients: { total: number };
  appointments: {
    total: number;
    byStatus: Array<{ status: string; n: number }>;
    queueActive: number;
    completed: number;
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const context = useQuery({
    queryKey: ["dashboard", "context"],
    queryFn: () => api.get<DashboardContext>("/dashboard/context"),
  });

  const d = context.data;
  const isLoading = context.isLoading;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={`Welcome${user?.name ? `, ${user.name}` : ""}`}
        description={`${user?.role?.replace(/_/g, " ") ?? "—"} · Medini CRM production dashboard`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Today's Appointments"
          value={isLoading ? "—" : d?.appointments.total ?? 0}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title="Total Patients"
          value={isLoading ? "—" : d?.patients.total ?? 0}
          icon={<Users className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title="Queue Active"
          value={isLoading ? "—" : d?.appointments.queueActive ?? 0}
          icon={<Clock className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={isLoading ? "—" : d?.appointments.completed ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <Panel title="Today's Appointment Status">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && !d && (
          <EmptyState
            title="No dashboard data"
            description="The backend dashboard context returned no data for your scope."
          />
        )}
        {!isLoading && d && d.appointments.byStatus.length === 0 && (
          <EmptyState
            title="No appointments today"
            description="There are no appointments scheduled for today."
          />
        )}
        {!isLoading && d && d.appointments.byStatus.length > 0 && (
          <div className="space-y-2">
            {d.appointments.byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <span className="capitalize text-slate-700">{(s.status ?? "unknown").replace(/-/g, " ")}</span>
                <span className="font-medium text-slate-900">{s.n}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
