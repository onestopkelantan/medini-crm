import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader, StatusBadge, Panel, EmptyState } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtDateTime, age, initials } from "@/lib/format";
import { Phone, Mail, ArrowLeft, Activity, CalendarDays } from "lucide-react";

interface Patient {
  id: string; mrn: string; name: string; phone: string | null; email: string | null;
  dob: string | null; gender: string | null; status: string; createdAt: string;
}
interface TimelineEvent { id: string; type: string; summary: string; createdAt: string; actorRole?: string }

export default function Patient360() {
  const { id } = useParams();
  const patient = useQuery({ queryKey: ["patients", id], queryFn: () => api.get<Patient>(`/patients/${id}`), enabled: !!id });
  const timeline = useQuery({ queryKey: ["patients", id, "timeline"], queryFn: () => api.get<TimelineEvent[]>(`/patients/${id}/timeline`), enabled: !!id });

  if (patient.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (!patient.data) return <EmptyState title="Patient not found" />;
  const p = patient.data;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={p.name}
        description={`${p.mrn} · Registered ${fmtDate(p.createdAt)}`}
        actions={<Link to="/patients"><span className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-600"><ArrowLeft className="h-4 w-4" /> Back to Patients</span></Link>}
      />

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16"><AvatarFallback className="bg-emerald-600 text-white text-xl">{initials(p.name)}</AvatarFallback></Avatar>
            <div>
              <p className="text-lg font-bold text-slate-900">{p.name}</p>
              <p className="text-sm text-slate-500">{age(p.dob)} · {p.gender ?? "—"}</p>
              <div className="mt-1.5"><StatusBadge status={p.status === "Active" ? "completed" : "cancelled"} /></div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-4 min-w-[280px]">
            <div className="flex items-start gap-2.5">
              <Phone className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-[11px] text-slate-400 uppercase font-medium">Phone</p><p className="text-sm font-medium text-slate-700 truncate">{p.phone ?? "—"}</p></div>
            </div>
            <div className="flex items-start gap-2.5">
              <Mail className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-[11px] text-slate-400 uppercase font-medium">Email</p><p className="text-sm font-medium text-slate-700 truncate">{p.email ?? "—"}</p></div>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="journey">
        <TabsList className="bg-white border">
          <TabsTrigger value="journey"><Activity className="h-3.5 w-3.5 mr-1.5" />Journey</TabsTrigger>
          <TabsTrigger value="appointments"><CalendarDays className="h-3.5 w-3.5 mr-1.5" />Appointments</TabsTrigger>
        </TabsList>

        <TabsContent value="journey" className="mt-4">
          <Panel title="Patient Journey Timeline">
            <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-slate-200 max-h-[520px] overflow-y-auto">
              {(timeline.data ?? []).map((ev) => (
                <div key={ev.id} className="relative flex gap-4">
                  <div className="absolute -left-6 top-1 h-4 w-4 rounded-full bg-emerald-500 ring-4 ring-white" />
                  <div className="flex-1 pb-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-800">{ev.summary}</p>
                      <span className="text-xs text-slate-400">{fmtDateTime(ev.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-400 capitalize">{(ev.type ?? "event").replace(/_/g, " ")}</p>
                  </div>
                </div>
              ))}
              {!timeline.isLoading && !(timeline.data ?? []).length && <EmptyState title="No journey events yet" />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="appointments" className="mt-4">
          <Panel>
            <EmptyState title="Appointments" description="Per-patient appointment history is served by the backend timeline; a dedicated per-patient appointments endpoint is a post-T1 refinement." />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
