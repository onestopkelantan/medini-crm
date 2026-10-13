import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, ShieldAlert, Plus, FlaskConical, Ban, FileCheck2, Sparkles, PenLine, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/* ============================================================================
 * AiGovernancePanels — guardrails, approval rules, and the POLICY TESTER.
 *
 * Ketiga-tiga ini dikawal oleh backend yang SUDAH wujud tetapi tiada UI:
 *   POST /ai/guardrails         (agentId null = GLOBAL)
 *   POST /ai/approval-rules
 *   POST /ai/policy/evaluate    — enjin dasar deterministik
 *
 * MENGAPA UJI POLISI PENTING
 * Enjin dasar menentukan sama ada AI boleh bertindak (AUTO), hanya mendraf
 * (DRAFT), perlukan manusia (APPROVAL_REQUIRED), atau diblok (BLOCKED) — dan
 * ia dilakukan SEBELUM sebarang tindakan, dengan susunan fail-closed. Tanpa UI,
 * satu-satunya cara untuk tahu jawapannya ialah membaca kod atau menunggu AI
 * tersalah. Penguji ini menjawab "kenapa" secara terus, dan setiap penilaian
 * diaudit oleh backend (`policy_evaluated`).
 * ========================================================================== */

interface Guardrail { id: string; agentId?: string | null; ruleKey: string; rule: string; level: string }
interface ApprovalRule { id: string; agentId?: string | null; actionKey: string; risk: string; auto: boolean; note?: string | null }
interface AgentRef { id: string; key: string; name: string }
interface PolicyResult { decision: string; reason: string; agentId?: string }

const DOMAINS = ["patients", "appointments", "clinical", "finance", "documents", "reports", "marketing", "operations", "whatsapp", "ai", "admin", "settings"];
const CAPABILITIES = ["READ", "DRAFT", "EXECUTE"] as const;

/* Warna + ikon ikut keputusan enjin dasar. 'BLOCKED' sengaja merah, bukan kelabu:
   ia jawapan yang menghentikan AI, dan operator perlu nampak itu serta-merta. */
const DECISION_STYLE: Record<string, { key: string; cls: string; icon: React.ReactNode }> = {
  AUTO: { key: "ai.pol.auto", cls: "text-green-600", icon: <CheckCircle2 className="h-4 w-4" /> },
  DRAFT: { key: "ai.pol.draft", cls: "text-blue-600", icon: <PenLine className="h-4 w-4" /> },
  APPROVAL_REQUIRED: { key: "ai.pol.approval", cls: "text-amber-600", icon: <ShieldAlert className="h-4 w-4" /> },
  BLOCKED: { key: "ai.pol.blocked", cls: "text-red-600", icon: <Ban className="h-4 w-4" /> },
};

function CreateGuardrailDialog({ agents, open, onClose }: { agents: AgentRef[]; open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [form, setForm] = useState({ agentId: "", ruleKey: "", rule: "", level: "HARD_BLOCK" });
  const create = useMutation({
    mutationFn: () => api.post("/ai/guardrails", {
      agentId: form.agentId || null, ruleKey: form.ruleKey, rule: form.rule, level: form.level,
    }),
    onSuccess: () => { toast.success(t("ai.grCreated")); qc.invalidateQueries({ queryKey: ["ai"] }); onClose(); setForm({ agentId: "", ruleKey: "", rule: "", level: "HARD_BLOCK" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ai.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>{t("ai.newGuardrail")}</DialogTitle>
          <DialogDescription>{t("ai.newGuardrailHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label>{t("ai.scope")}</Label>
            <Select value={form.agentId || "GLOBAL"} onValueChange={(v) => setForm({ ...form, agentId: v === "GLOBAL" ? "" : v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GLOBAL">{t("ai.scopeGlobal")}</SelectItem>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.ruleKey")} *</Label>
            <Input required value={form.ruleKey} onChange={(e) => setForm({ ...form, ruleKey: e.target.value })} placeholder="GR-2" className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.rule")} *</Label>
            <Textarea required minLength={4} value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })} rows={3} className="rounded-xl border-border bg-card p-3" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.level")}</Label>
            <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HARD_BLOCK">{t("ai.levelHardBlock")}</SelectItem>
                <SelectItem value="APPROVAL_REQUIRED">{t("ai.levelApproval")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("ai.levelHint")}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground" disabled={create.isPending}>{create.isPending ? t("ai.saving") : t("ai.createGuardrail")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateApprovalRuleDialog({ agents, open, onClose }: { agents: AgentRef[]; open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [form, setForm] = useState({ agentId: "", actionKey: "", risk: "MEDIUM", auto: false, note: "" });
  const create = useMutation({
    mutationFn: () => api.post("/ai/approval-rules", {
      agentId: form.agentId || null, actionKey: form.actionKey, risk: form.risk, auto: form.auto, note: form.note || null,
    }),
    onSuccess: () => { toast.success(t("ai.arCreated")); qc.invalidateQueries({ queryKey: ["ai"] }); onClose(); setForm({ agentId: "", actionKey: "", risk: "MEDIUM", auto: false, note: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ai.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>{t("ai.newApprovalRule")}</DialogTitle>
          <DialogDescription>{t("ai.newApprovalRuleHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label>{t("ai.scope")}</Label>
            <Select value={form.agentId || "GLOBAL"} onValueChange={(v) => setForm({ ...form, agentId: v === "GLOBAL" ? "" : v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GLOBAL">{t("ai.scopeGlobal")}</SelectItem>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.actionKey")} *</Label>
            <Input required value={form.actionKey} onChange={(e) => setForm({ ...form, actionKey: e.target.value })} placeholder="clinical.medical_advice" className="rounded-xl border-border bg-card px-4 py-2.5" />
            <p className="text-xs text-muted-foreground">{t("ai.actionKeyHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("ai.risk")}</Label>
              <Select value={form.risk} onValueChange={(v) => setForm({ ...form, risk: v })}>
                <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{["LOW", "MEDIUM", "HIGH"].map((r) => <SelectItem key={r} value={r}>{t(`ai.risk.${r}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("ai.handling")}</Label>
              <Select value={form.auto ? "AUTO" : "MANUAL"} onValueChange={(v) => setForm({ ...form, auto: v === "AUTO" })}>
                <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">{t("ai.handlingAuto")}</SelectItem>
                  <SelectItem value="MANUAL">{t("ai.handlingManual")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.note")}</Label>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground" disabled={create.isPending}>{create.isPending ? t("ai.saving") : t("ai.createRule")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** PolicyTesterPanel — tanya enjin dasar "apa akan jadi?" sebelum AI bertindak. */
export function PolicyTesterPanel({ agents }: { agents: AgentRef[] }) {
  const { t } = usePrefs();
  const [agentKey, setAgentKey] = useState("");
  const [domain, setDomain] = useState("appointments");
  const [capability, setCapability] = useState<string>("READ");
  const [actionKey, setActionKey] = useState("");
  const [result, setResult] = useState<PolicyResult | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<PolicyResult>("/ai/policy/evaluate", {
      agentKey, domain, capability, actionKey: actionKey || null,
    }),
    onSuccess: (d) => setResult(d),
    onError: (e: unknown) => { setResult(null); toast.error(errorMessage(e, t("ai.evalFailed"))); },
  });
  const style = result ? DECISION_STYLE[result.decision] : null;
  return (
    <Panel title={t("ai.policyTester")} subtitle={t("ai.policyTesterHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("ai.agent")} *</Label>
            <Select value={agentKey} onValueChange={setAgentKey}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue placeholder={t("ai.pickAgent")} /></SelectTrigger>
              <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.key}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.domain")}</Label>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{DOMAINS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.capability")}</Label>
            <Select value={capability} onValueChange={setCapability}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{CAPABILITIES.map((c) => <SelectItem key={c} value={c}>{t(`ai.cap.${c}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.actionKeyOptional")}</Label>
            <Input value={actionKey} onChange={(e) => setActionKey(e.target.value)} placeholder="clinical.medical_advice" className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
        </div>
        <Button onClick={() => run.mutate()} disabled={!agentKey || run.isPending} className="rounded-xl bg-primary text-primary-foreground">
          <FlaskConical className="h-4 w-4 mr-1.5" />{run.isPending ? t("ai.evaluating") : t("ai.evaluate")}
        </Button>
        {result && style && (
          <div className="rounded-xl border border-border bg-accent/40 p-4">
            <div className={`flex items-center gap-2 font-semibold ${style.cls}`}>
              {style.icon}
              <span>{t(style.key)}</span>
              <span className="text-xs font-mono text-muted-foreground">({result.decision})</span>
            </div>
            <p className="mt-2 text-sm text-foreground">{result.reason}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t("ai.evalAudited")}</p>
          </div>
        )}
        {result && !style && (
          <div className="rounded-xl border border-border bg-accent/40 p-3 text-sm">
            <span className="font-mono">{result.decision}</span>, {result.reason}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function GuardrailsPanel({ agents }: { agents: AgentRef[] }) {
  const { t } = usePrefs();
  const [showNew, setShowNew] = useState(false);
  const guardrails = useQuery({ queryKey: ["ai", "guardrails"], queryFn: () => api.get<Guardrail[]>("/ai/guardrails") });
  const rows = guardrails.data ?? [];
  return (
    <>
      <Panel title={t("ai.guardrails")} subtitle={t("ai.guardrailsHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
        action={<Button size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1.5" />{t("ai.newGuardrail")}</Button>}>
        {guardrails.isLoading && <Skeleton className="h-40 w-full" />}
        {guardrails.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(guardrails.error, t("ai.loadFailed"))}</p>}
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-mono font-medium text-foreground">{r.ruleKey}</p>
                <StatusBadge status={r.level === "HARD_BLOCK" ? "critical" : "high"} statusText={t(r.level === "HARD_BLOCK" ? "ai.levelHardBlock" : "ai.levelApproval")} className="rounded-full px-3 py-1 text-xs" />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{r.rule}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.agentId ? `${t("ai.agent")} ${r.agentId.slice(0, 8)}…` : t("ai.scopeGlobal")}</p>
            </div>
          ))}
          {guardrails.isSuccess && !rows.length && <EmptyState title={t("ai.noGuardrails")} description={t("ai.noGuardrailsHint")} />}
        </div>
      </Panel>
      <CreateGuardrailDialog agents={agents} open={showNew} onClose={() => setShowNew(false)} />
    </>
  );
}

export function ApprovalRulesPanel({ agents }: { agents: AgentRef[] }) {
  const { t } = usePrefs();
  const [showNew, setShowNew] = useState(false);
  const approvals = useQuery({ queryKey: ["ai", "approvals"], queryFn: () => api.get<ApprovalRule[]>("/ai/approval-rules") });
  const rows = approvals.data ?? [];
  return (
    <>
      <Panel title={t("ai.approvalRules")} subtitle={t("ai.approvalRulesHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
        action={<Button size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1.5" />{t("ai.newApprovalRule")}</Button>}>
        {approvals.isLoading && <Skeleton className="h-40 w-full" />}
        {approvals.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(approvals.error, t("ai.loadFailed"))}</p>}
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-mono font-medium text-foreground">{r.actionKey}</p>
                <p className="text-xs text-muted-foreground">
                  {r.agentId ? `${t("ai.agent")} ${r.agentId.slice(0, 8)}…` : t("ai.scopeGlobal")}{r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={r.risk === "HIGH" ? "high" : r.risk === "MEDIUM" ? "medium" : "low"} statusText={t(`ai.risk.${r.risk}`)} className="rounded-full px-3 py-1 text-xs" />
                <span className={`text-xs font-semibold ${r.auto ? "text-emerald-600" : "text-amber-600"}`}>
                  {r.auto ? t("ai.handlingAuto") : t("ai.handlingManual")}
                </span>
              </div>
            </div>
          ))}
          {approvals.isSuccess && !rows.length && <EmptyState title={t("ai.noApprovalRules")} description={t("ai.noApprovalRulesHint")} />}
        </div>
      </Panel>
      <CreateApprovalRuleDialog agents={agents} open={showNew} onClose={() => setShowNew(false)} />
    </>
  );
}

export { ShieldCheck, FileCheck2, Sparkles };
