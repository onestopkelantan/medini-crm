import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { Bot, ShieldCheck, ListChecks, ScrollText } from "lucide-react";
import { toast } from "sonner";

interface Agent { id: string; key: string; name: string; icon?: string; ownerDomain: string; status: string; description?: string }
interface Guardrail { id: string; agentId?: string; ruleKey: string; rule: string; level: string }
interface ApprovalRule { id: string; agentId?: string; actionKey: string; risk: string; auto: boolean; note?: string }
interface Audit { id: string; agentId?: string; createdAt?: string; action?: string; detail?: string }

export default function AIManager() {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ["ai", "agents"], queryFn: () => api.get<Agent[]>("/ai/agents") });
  const guardrails = useQuery({ queryKey: ["ai", "guardrails"], queryFn: () => api.get<Guardrail[]>("/ai/guardrails") });
  const approvals = useQuery({ queryKey: ["ai", "approvals"], queryFn: () => api.get<ApprovalRule[]>("/ai/approval-rules") });
  const audit = useQuery({ queryKey: ["ai", "audit"], queryFn: () => api.get<Audit[]>("/ai/audit?limit=50") });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "enable" | "pause" | "archive" }) => api.post(`/ai/agents/${id}/${action}`, {}),
    onSuccess: (_d, v) => { toast.success(`Agent ${v.action}d`); qc.invalidateQueries({ queryKey: ["ai"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Action failed")),
  });

  const agentRows = agents.data ?? [];
  const enabled = agentRows.filter((a) => a.status === "enabled").length;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader title="AI Manager" description="AI agents, guardrails, approval rules and audit trail" />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "AI Agents", value: agentRows.length, icon: <Bot className="h-4 w-4" /> },
          { label: "Enabled", value: enabled, icon: <Bot className="h-4 w-4" /> },
          { label: "Guardrails", value: (guardrails.data ?? []).length, icon: <ShieldCheck className="h-4 w-4" /> },
          { label: "Approval Rules", value: (approvals.data ?? []).length, icon: <ListChecks className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium">{k.label}<span className="text-emerald-600 bg-emerald-50 rounded-lg p-1.5">{k.icon}</span></div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="agents">
        <TabsList className="bg-white border">
          <TabsTrigger value="agents"><Bot className="h-3.5 w-3.5 mr-1.5" />Agents</TabsTrigger>
          <TabsTrigger value="guardrails"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Guardrails</TabsTrigger>
          <TabsTrigger value="approvals"><ListChecks className="h-3.5 w-3.5 mr-1.5" />Approval Rules</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="h-3.5 w-3.5 mr-1.5" />Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="mt-4">
          <Panel>
            {agents.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {agentRows.map((a) => (
                <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-xl">{a.icon ?? "🤖"}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{a.name}</p>
                      <p className="text-xs text-slate-400 truncate">{a.description ?? a.ownerDomain}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={a.status} />
                    {a.status !== "enabled" && <Button size="sm" variant="outline" className="text-xs" disabled={transition.isPending} onClick={() => transition.mutate({ id: a.id, action: "enable" })}>Enable</Button>}
                    {a.status === "enabled" && <Button size="sm" variant="outline" className="text-xs" disabled={transition.isPending} onClick={() => transition.mutate({ id: a.id, action: "pause" })}>Pause</Button>}
                    {a.status !== "archived" && <Button size="sm" variant="outline" className="text-xs text-red-600 border-red-200" disabled={transition.isPending} onClick={() => transition.mutate({ id: a.id, action: "archive" })}>Archive</Button>}
                  </div>
                </div>
              ))}
              {!agents.isLoading && !agentRows.length && <EmptyState title="No AI agents" description="Registered AI agents will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="guardrails" className="mt-4">
          <Panel>
            {guardrails.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(guardrails.data ?? []).map((g) => (
                <div key={g.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-800">{g.ruleKey}</p>
                    <StatusBadge status={g.level === "HARD_BLOCK" ? "critical" : "high"} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{g.rule}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{g.agentId ? `Agent ${g.agentId.slice(0, 8)}…` : "GLOBAL"}</p>
                </div>
              ))}
              {!guardrails.isLoading && !(guardrails.data ?? []).length && <EmptyState title="No guardrails" description="AI safety guardrails will appear here." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <Panel>
            {approvals.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(approvals.data ?? []).map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{r.actionKey}</p>
                    <p className="text-xs text-slate-400">{r.agentId ? `Agent ${r.agentId.slice(0, 8)}…` : "GLOBAL"}{r.note ? ` · ${r.note}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.risk === "HIGH" ? "high" : r.risk === "MEDIUM" ? "medium" : "low"} />
                    <span className={`text-xs font-semibold ${r.auto ? "text-emerald-600" : "text-amber-600"}`}>{r.auto ? "AUTO" : "MANUAL"}</span>
                  </div>
                </div>
              ))}
              {!approvals.isLoading && !(approvals.data ?? []).length && <EmptyState title="No approval rules" description="Rules governing which AI actions need human approval." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Panel>
            {audit.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {(audit.data ?? []).map((a) => (
                <div key={a.id} className="py-2.5">
                  <p className="text-sm text-slate-700">{a.action ?? "AI action"}</p>
                  <p className="text-xs text-slate-400">{fmtDateTime(a.createdAt)}{a.agentId ? ` · agent ${a.agentId.slice(0, 8)}…` : ""}</p>
                </div>
              ))}
              {!audit.isLoading && !(audit.data ?? []).length && <EmptyState title="No audit records" description="AI actions and evaluations will be audited here." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
