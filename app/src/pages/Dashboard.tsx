import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router";

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

const TEAL = "#0DC9B7";
const CYAN = "#12B5E5";

const statusColor: Record<string, { bg: string; color: string }> = {
  booked: { bg: "#f8fafc", color: "#64748b" },
  confirmed: { bg: "#f0fdfa", color: "#0d9488" },
  "checked-in": { bg: "#eff6ff", color: "#2563eb" },
  "in-progress": { bg: "#f5f3ff", color: "#7c3aed" },
  completed: { bg: "#f0fdfa", color: "#0d9488" },
  cancelled: { bg: "#fff1f2", color: "#e11d48" },
  "no-show": { bg: "#fffbeb", color: "#d97706" },
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Selamat Pagi";
  if (h < 19) return "Selamat Petang";
  return "Selamat Malam";
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: d, isLoading } = useQuery({
    queryKey: ["dashboard", "context"],
    queryFn: () => api.get<DashboardContext>("/dashboard/context"),
  });

  const total = d?.appointments.total ?? 0;
  const completed = d?.appointments.completed ?? 0;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const today = new Date().toLocaleDateString("ms-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6" style={{ animation: "fadeIn .25s ease" }}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "#0B132B", fontFamily: "'Outfit', sans-serif" }}>
            {greeting()}{user?.name ? `, ${user.name}` : ""} 👋
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Inilah yang berlaku di klinik anda hari ini</p>
        </div>
        <div className="rounded-2xl bg-white/85 border border-slate-100 flex items-center gap-2.5 px-4 py-2.5" style={{ backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
          <svg className="h-4 w-4" style={{ color: TEAL }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <p className="text-[13px] font-semibold text-slate-700">{today}</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Hero card - Appointments */}
        <div className="relative overflow-hidden rounded-2xl p-5 text-white shadow-xl flex flex-col" style={{ background: "linear-gradient(135deg, #0B3B36 0%, #0d6b5e 55%, #0DC9B7 130%)" }}>
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full blur-2xl" style={{ background: "rgba(45,212,191,0.15)" }}></div>
          <p className="text-[12px] font-medium" style={{ color: "rgba(204,251,241,0.8)" }}>Appointment Hari Ini</p>
          {isLoading ? <Skeleton className="h-9 w-20 mt-2 bg-white/20" /> : (
            <p className="text-[32px] font-bold mt-1 tracking-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>{total}</p>
          )}
          <p className="text-[11px] mt-auto pt-3" style={{ color: "rgba(204,251,241,0.7)" }}>{completed} selesai · {rate}% kadar siap</p>
        </div>

        <KpiCard label="Jumlah Pesakit" value={d?.patients.total} loading={isLoading} gradient="linear-gradient(135deg, #2E8CFF, #7C5CFC)" icon={<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></>} />
        <KpiCard label="Dalam Giliran" value={d?.appointments.queueActive} loading={isLoading} gradient="linear-gradient(135deg, #0DC9B7, #12B5E5)" icon={<><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>} />
        <KpiCard label="Selesai" value={completed} loading={isLoading} gradient="linear-gradient(135deg, #7C5CFC, #FF7A7A)" icon={<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></>} />
      </div>

      {/* Lower grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Appointment status breakdown */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-100 p-6" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
          <h3 className="font-semibold text-[15px] text-slate-800" style={{ fontFamily: "'Outfit', sans-serif" }}>Status Appointment</h3>
          <p className="text-xs text-slate-400 mt-0.5">Hari ini · ikut status</p>
          {isLoading ? (
            <div className="space-y-3 pt-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : (d?.appointments.byStatus?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400 pt-6 text-center">Tiada appointment hari ini.</p>
          ) : (
            <div className="space-y-2.5 pt-4">
              {d!.appointments.byStatus.map((s) => {
                const c = statusColor[s.status] ?? { bg: "#f8fafc", color: "#64748b" };
                const pct = total > 0 ? Math.round((s.n / total) * 100) : 0;
                return (
                  <div key={s.status} className="flex items-center gap-3">
                    <span className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold capitalize w-32 justify-center" style={{ background: c.bg, color: c.color }}>{s.status.replace(/-/g, " ")}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${TEAL}, ${CYAN})` }}></div>
                    </div>
                    <span className="text-[13px] font-bold text-slate-700 w-8 text-right">{s.n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="rounded-2xl border border-slate-100 p-5 space-y-2" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
          <p className="font-semibold text-[13px] text-slate-700 px-1 pb-1" style={{ fontFamily: "'Outfit', sans-serif" }}>Tindakan Pantas</p>
          <QuickAction label="Booking WhatsApp" onClick={() => nav("/booking-requests")} gradient="linear-gradient(135deg, #0DC9B7, #12B5E5)" icon={<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>} />
          <QuickAction label="Appointments" onClick={() => nav("/appointments")} gradient="linear-gradient(135deg, #2E8CFF, #7C5CFC)" icon={<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>} />
          <QuickAction label="Pesakit" onClick={() => nav("/patients")} gradient="linear-gradient(135deg, #7C5CFC, #FF7A7A)" icon={<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>} />
          <QuickAction label="Clinical" onClick={() => nav("/clinical")} gradient="linear-gradient(135deg, #FFB020, #FF7A7A)" icon={<><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></>} />
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, loading, gradient, icon }: { label: string; value?: number; loading: boolean; gradient: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 p-5 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
      <div className="h-11 w-11 rounded-2xl flex items-center justify-center text-white shadow-md" style={{ background: gradient }}>
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </div>
      <div>
        <p className="text-[12px] text-slate-400 font-medium">{label}</p>
        {loading ? <Skeleton className="h-8 w-16 mt-1" /> : (
          <p className="text-[28px] font-bold text-slate-900 leading-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>{value ?? 0}</p>
        )}
      </div>
    </div>
  );
}

function QuickAction({ label, onClick, gradient, icon }: { label: string; onClick: () => void; gradient: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-slate-50 transition group text-left">
      <span className="h-8 w-8 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0" style={{ background: gradient }}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </span>
      <span className="text-[13px] font-medium text-slate-700 flex-1">{label}</span>
      <span className="text-slate-300 group-hover:text-teal-500">›</span>
    </button>
  );
}
