import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime } from "@/lib/format";
import { Bot, ShieldCheck, ListChecks, ScrollText, MessageSquare, Sparkles, ShieldOff, CalendarClock, FlaskConical, Plus, BookOpen, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { PromptSlotsEditor, type PromptSlot } from "@/components/whatsapp/PromptSlotsEditor";
import { PromptPlayground } from "@/components/whatsapp/PromptPlayground";
import { AiModelStatusCard } from "@/components/whatsapp/AiModelStatusCard";
import AntibanSettingsPanel from "@/components/whatsapp/AntibanSettingsPanel";
import OptOutListPanel from "@/components/whatsapp/OptOutListPanel";
import { GuardrailsPanel, ApprovalRulesPanel, PolicyTesterPanel } from "@/components/ai/AiGovernancePanels";
import { ApprovalQueuePanel } from "@/components/ai/ApprovalQueuePanel";
import { BookingBehaviourPanel, BookingRecordsPanel } from "@/components/ai/AiBookingPanels";

/* ============================================================================
 * AI Manager — pusat kawalan AI (Seksyen 2 Fasa 2).
 *
 * Halaman ini menjawab satu soalan: "Apa yang AI ini tahu, dan apa yang ia
 * dibenarkan buat?" Sebelum ini backend mempunyai 34 endpoint dan UI memanggil
 * 4 — jadi kawalan agen, kemahiran, ilmu, automasi, penciptaan guardrail dan
 * enjin dasar semuanya tidak kelihatan dari skrin.
 *
 * SUSUNAN TAB MENGIKUT SOALAN OPERATOR, bukan mengikut folder backend:
 *   Ringkasan  — apa keadaannya sekarang?
 *   AI Booking — apa AI buat bila menempah? (slot finder + keutamaan doktor)
 *   Prompt     — apa ia katakan?
 *   Playground — uji prompt sebelum hidupkan
 *   Anti-Ban   — had kadar (jangan sampai nombor disekat)
 *   Senarai STOP — siapa yang tidak boleh dihubungi
 *   Agen       — daftar/kawal agen
 *   Kemahiran  — apa agen ini dibenarkan buat (capabilities/ilmu/automasi)
 *   Guardrails — peraturan keselamatan
 *   Kelulusan  — tindakan mana perlukan manusia
 *   Uji Polisi — tanya enjin dasar "apa akan jadi?"
 *   Audit      — jejak penuh
 *
 * Satu perkara yang UI ini TIDAK buat dengan sengaja: ia tidak memalsukan
 * kawalan yang backend tidak menyimpan. Rujuk AiBookingPanels untuk sebabnya.
 * ========================================================================== */

interface Agent { id: string; key: string; name: string; icon?: string; ownerDomain: string; status: string; description?: string }
interface Audit { id: string; agentId?: string; createdAt?: string; action?: string; detail?: string }
interface Capability { id: string; domain: string; capability: string; draftOnly: boolean }
interface Knowledge { id: string; item: string; type?: string; sourceDomain?: string | null }
interface Automation { id: string; triggerKey: string; actionKey: string; enabled: boolean }
interface AgentDetail extends Agent { capabilities?: Capability[]; knowledge?: Knowledge[]; automations?: Automation[] }

const tabClass = "rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAINS = ["patients", "appointments", "clinical", "finance", "documents", "reports", "marketing", "operations", "whatsapp", "ai", "admin", "settings"];

/* ---------------------------------------------------------------- register agent */
function RegisterAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: "", name: "", ownerDomain: "appointments", description: "" });
  const create = useMutation({
    mutationFn: () => api.post("/ai/agents", { key: form.key, name: form.name, ownerDomain: form.ownerDomain, description: form.description || null }),
    onSuccess: () => { toast.success(t("ai.agentRegistered")); qc.invalidateQueries({ queryKey: ["ai"] }); onClose(); setForm({ key: "", name: "", ownerDomain: "appointments", description: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ai.createFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>{t("ai.registerAgent")}</DialogTitle>
          <DialogDescription>{t("ai.registerAgentHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label>{t("ai.agentKey")} *</Label>
            <Input required pattern="[a-z0-9-]+" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} placeholder="booking-assistant" className="rounded-xl border-border bg-card px-4 py-2.5" />
            <p className="text-xs text-muted-foreground">{t("ai.agentKeyHint")}</p>
          </div>
          <div className="space-y-1.5"><Label>{t("ai.agentName")} *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" /></div>
          <div className="space-y-1.5">
            <Label>{t("ai.ownerDomain")}</Label>
            <Select value={form.ownerDomain} onValueChange={(v) => setForm({ ...form, ownerDomain: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{DOMAINS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("ai.ownerDomainHint")}</p>
          </div>
          <div className="space-y-1.5"><Label>{t("ai.description")}</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground" disabled={create.isPending}>{create.isPending ? t("ai.saving") : t("ai.registerAgent")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- agent skills */
/** SkillsPanel — apa agen ini dibenarkan buat, tahu, dan jalankan automatik.
 *
 *  Tiga perkara berasingan yang selalu dikelirukan:
 *    Kemahiran  = kebenaran bertindak (READ sahaja / DRAFT / EXECUTE)
 *    Ilmu       = apa yang agen tahu (fakta, sumber)
 *    Automasi   = apa yang berjalan sendiri (pencetus → tindakan)
 *
 *  NOTA PENTING TENTANG EXECUTE: backend MENOLAK geran EXECUTE di luar domain
 *  pemilik agen (dan menolak EXECUTE dalam domain 'admin' sama sekali). UI
 *  menyatakan had itu di hadapan, supaya operator tidak mengisi borang yang
 *  mustahil diterima.
 */
function SkillsPanel({ agent }: { agent: AgentDetail }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["ai", "agent", agent.id], queryFn: () => api.get<AgentDetail>(`/ai/agents/${agent.id}`) });
  const d = detail.data ?? agent;
  const caps = d.capabilities ?? [];
  const know = d.knowledge ?? [];
  const autos = d.automations ?? [];

  const [cap, setCap] = useState({ domain: agent.ownerDomain, capability: "READ", draftOnly: false });
  const [knowForm, setKnowForm] = useState({ item: "", type: "static" });
  const [autoForm, setAutoForm] = useState({ triggerKey: "", actionKey: "" });

  const after = () => qc.invalidateQueries({ queryKey: ["ai", "agent", agent.id] });
  const addCap = useMutation({ mutationFn: () => api.post(`/ai/agents/${agent.id}/capabilities`, cap), onSuccess: () => { toast.success(t("ai.capGranted")); after(); }, onError: (e: unknown) => toast.error(errorMessage(e, t("ai.createFailed"))) });
  const addKnow = useMutation({ mutationFn: () => api.post(`/ai/agents/${agent.id}/knowledge`, knowForm), onSuccess: () => { toast.success(t("ai.knowledgeAdded")); setKnowForm({ item: "", type: "static" }); after(); }, onError: (e: unknown) => toast.error(errorMessage(e, t("ai.createFailed"))) });
  const addAuto = useMutation({ mutationFn: () => api.post(`/ai/agents/${agent.id}/automations`, autoForm), onSuccess: () => { toast.success(t("ai.automationAdded")); setAutoForm({ triggerKey: "", actionKey: "" }); after(); }, onError: (e: unknown) => toast.error(errorMessage(e, t("ai.createFailed"))) });
  const toggleAuto = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patch(`/ai/automations/${id}`, { enabled }), onSuccess: () => after(), onError: (e: unknown) => toast.error(errorMessage(e, t("ai.updateFailed"))) });

  const executeBlocked = cap.capability === "EXECUTE" && (cap.domain !== agent.ownerDomain || cap.domain === "admin");

  return (
    <div className="space-y-4">
      <Panel title={t("ai.capabilities")} subtitle={t("ai.capabilitiesHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
        <div className="divide-y divide-border mb-4">
          {caps.map((c) => (
            <div key={c.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{c.domain}</p>
                <p className="text-xs text-muted-foreground">{c.capability === "READ" ? t("ai.cap.readHint") : c.capability === "DRAFT" ? t("ai.cap.draftHint") : t("ai.cap.executeHint")}{c.draftOnly ? ` · ${t("ai.draftOnly")}` : ""}</p>
              </div>
              <StatusBadge status={c.capability === "EXECUTE" ? "high" : c.capability === "DRAFT" ? "medium" : "low"} statusText={t(`ai.cap.${c.capability}`)} className="rounded-full px-3 py-1 text-xs" />
            </div>
          ))}
          {!caps.length && <EmptyState title={t("ai.noCapabilities")} description={t("ai.noCapabilitiesHint")} />}
        </div>
        <form className="grid gap-3 sm:grid-cols-4 items-end" onSubmit={(e) => { e.preventDefault(); addCap.mutate(); }}>
          <div className="space-y-1.5">
            <Label>{t("ai.domain")}</Label>
            <Select value={cap.domain} onValueChange={(v) => setCap({ ...cap, domain: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-3 py-2 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{DOMAINS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("ai.capability")}</Label>
            <Select value={cap.capability} onValueChange={(v) => setCap({ ...cap, capability: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-3 py-2 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{["READ", "DRAFT", "EXECUTE"].map((x) => <SelectItem key={x} value={x}>{t(`ai.cap.${x}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={addCap.isPending || executeBlocked} className="rounded-xl bg-primary text-primary-foreground">
            <Plus className="h-4 w-4 mr-1.5" />{t("ai.grant")}
          </Button>
        </form>
        {executeBlocked && (
          <p className="mt-2 text-xs text-amber-600">
            {cap.domain === "admin" ? t("ai.executeAdminBlocked") : t("ai.executeCrossDomainBlocked")}
          </p>
        )}
      </Panel>

      <Panel title={t("ai.knowledge")} subtitle={t("ai.knowledgeHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
        <div className="divide-y divide-border mb-4">
          {know.map((k) => (
            <div key={k.id} className="py-2.5 flex items-center justify-between gap-3">
              <p className="text-sm text-foreground min-w-0">{k.item}</p>
              <span className="text-xs text-muted-foreground shrink-0">{k.type === "dynamic" ? t("ai.know.typeDynamic") : t("ai.know.typeStatic")}{k.sourceDomain ? ` · ${k.sourceDomain}` : ""}</span>
            </div>
          ))}
          {!know.length && <EmptyState title={t("ai.noKnowledge")} description={t("ai.noKnowledgeHint")} />}
        </div>
        <form className="grid gap-3 sm:grid-cols-4 items-end" onSubmit={(e) => { e.preventDefault(); addKnow.mutate(); }}>
          <div className="space-y-1.5 sm:col-span-2"><Label>{t("ai.knowledgeItem")}</Label><Input required value={knowForm.item} onChange={(e) => setKnowForm({ ...knowForm, item: e.target.value })} className="rounded-xl border-border bg-card px-3 py-2" /></div>
          <div className="space-y-1.5">
            <Label>{t("ai.knowledgeType")}</Label>
            <Select value={knowForm.type} onValueChange={(v) => setKnowForm({ ...knowForm, type: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-3 py-2 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="static">{t("ai.know.typeStatic")}</SelectItem><SelectItem value="dynamic">{t("ai.know.typeDynamic")}</SelectItem></SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={addKnow.isPending} className="rounded-xl bg-primary text-primary-foreground"><Plus className="h-4 w-4 mr-1.5" />{t("ai.add")}</Button>
        </form>
      </Panel>

      <Panel title={t("ai.automations")} subtitle={t("ai.automationsHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
        <div className="divide-y divide-border mb-4">
          {autos.map((a) => (
            <div key={a.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-mono text-foreground">{a.triggerKey} → {a.actionKey}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={a.enabled ? "done" : "pending"} statusText={a.enabled ? t("ai.enabled") : t("ai.disabled")} className="rounded-full px-3 py-1 text-xs" />
                <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground" disabled={toggleAuto.isPending}
                  onClick={() => toggleAuto.mutate({ id: a.id, enabled: !a.enabled })}>
                  {a.enabled ? t("ai.disable") : t("ai.enable")}
                </Button>
              </div>
            </div>
          ))}
          {!autos.length && <EmptyState title={t("ai.noAutomations")} description={t("ai.noAutomationsHint")} />}
        </div>
        <form className="grid gap-3 sm:grid-cols-3 items-end" onSubmit={(e) => { e.preventDefault(); addAuto.mutate(); }}>
          <div className="space-y-1.5"><Label>{t("ai.trigger")}</Label><Input required value={autoForm.triggerKey} onChange={(e) => setAutoForm({ ...autoForm, triggerKey: e.target.value })} placeholder="appointment.no_show" className="rounded-xl border-border bg-card px-3 py-2" /></div>
          <div className="space-y-1.5"><Label>{t("ai.action")}</Label><Input required value={autoForm.actionKey} onChange={(e) => setAutoForm({ ...autoForm, actionKey: e.target.value })} placeholder="whatsapp.send_recall" className="rounded-xl border-border bg-card px-3 py-2" /></div>
          <Button type="submit" disabled={addAuto.isPending} className="rounded-xl bg-primary text-primary-foreground"><Plus className="h-4 w-4 mr-1.5" />{t("ai.add")}</Button>
        </form>
      </Panel>
    </div>
  );
}

/* ============================================================================ */

export default function AIManager() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const selectedBranch = typeof branchId === "string" && uuidPattern.test(branchId) ? branchId : "";
  const isHq = user?.role === "hq";

  const agents = useQuery({ queryKey: ["ai", "agents"], queryFn: () => api.get<Agent[]>("/ai/agents") });
  const audit = useQuery({ queryKey: ["ai", "audit"], queryFn: () => api.get<Audit[]>("/ai/audit?limit=50") });
  const guardrails = useQuery({ queryKey: ["ai", "guardrails"], queryFn: () => api.get<unknown[]>("/ai/guardrails") });
  const approvals = useQuery({ queryKey: ["ai", "approval-rules"], queryFn: () => api.get<unknown[]>("/ai/approval-rules") });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "enable" | "pause" | "archive" }) => api.post(`/ai/agents/${id}/${action}`, {}),
    onSuccess: () => { toast.success(t("ai.agentUpdated")); qc.invalidateQueries({ queryKey: ["ai"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ai.updateFailed"))),
  });

  /* AGEN AKTIF MEDINI (arah pemilik): empat sahaja - Receptionist, Booking,
   * Finance, Insight. Baris lain (clinical/marketing/inventory/recall) wujud
   * dalam kontrak tadbir urus lama TANPA enjin; memaparkannya di UI hanya
   * mengelirukan ("Enabled" tapi tak buat apa-apa). Senarai UI menapis
   * kepada empat yang benar-benar bekerja; keputusan pemilik dipatuhi
   * tanpa memadam sejarah kontrak. */
  const ACTIVE_AGENT_KEYS = ["ai-receptionist", "booking-ai", "finance-ai", "insights-ai"] as const;
  const agentRows = (agents.data ?? []).filter((a) => (ACTIVE_AGENT_KEYS as readonly string[]).includes(a.key));
  const enabled = agentRows.filter((a) => a.status === "enabled").length;
  const [tab, setTab] = useState("overview");
  const [testSlot, setTestSlot] = useState<number | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [skillAgent, setSkillAgent] = useState<Agent | null>(null);

  function startTest(slot: PromptSlot) { setTestSlot(slot.slot); setTab("playground"); }

  return (
    <div className="space-y-6 -mt-6">
      <PageHeader title={t("ai.title")} description={t("ai.desc")} />
      <AiModelStatusCard />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: t("ai.metric.agents"), value: agentRows.length, icon: <Bot className="h-4 w-4" /> },
          { label: t("ai.metric.enabled"), value: enabled, icon: <Sparkles className="h-4 w-4" /> },
          { label: t("ai.metric.guardrails"), value: (guardrails.data ?? []).length, icon: <ShieldCheck className="h-4 w-4" /> },
          { label: t("ai.metric.approvals"), value: (approvals.data ?? []).length, icon: <ListChecks className="h-4 w-4" /> },
        ].map((item) => (
          <div key={item.label} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              {item.label}
              <span className="text-foreground bg-accent rounded-xl p-1.5 ring-1 ring-teal-200">{item.icon}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-foreground">{item.value}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <TabsTrigger className={tabClass} value="overview"><Sparkles className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.overview")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="booking"><CalendarClock className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.booking")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="prompt"><MessageSquare className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.prompt")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="playground"><FlaskConical className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.playground")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="antiban"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.antiban")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="stoplist"><ShieldOff className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.stoplist")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="agents"><Bot className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.agents")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="skills"><BookOpen className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.skills")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="guardrails"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.guardrails")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="approvals"><ListChecks className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.approvals")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="policy"><FlaskConical className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.policy")}</TabsTrigger>
          <TabsTrigger className={tabClass} value="audit"><ScrollText className="mr-1.5 h-3.5 w-3.5" />{t("ai.tab.audit")}</TabsTrigger>
        </TabsList>

        {/* ---- Ringkasan: apa yang AI ini sebenarnya kuasai, dalam satu pandangan ---- */}
        <TabsContent value="overview" className="mt-4 space-y-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.overview")}</p>
          {!isHq && (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-accent/40 p-3 text-xs">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              <p className="text-muted-foreground">{t("ai.hqOnlyNote")}</p>
            </div>
          )}
          <Panel title={t("ai.overview.posisi")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2"><Bot className="h-4 w-4 shrink-0 text-primary mt-0.5" /><p>{t("ai.overview.agentsLine", { total: agentRows.length, enabled })}</p></div>
              <div className="flex items-start gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" /><p>{t("ai.overview.guardrailLine", { n: (guardrails.data ?? []).length })}</p></div>
              <div className="flex items-start gap-2"><ListChecks className="h-4 w-4 shrink-0 text-primary mt-0.5" /><p>{t("ai.overview.approvalLine", { n: (approvals.data ?? []).length })}</p></div>
              <div className="flex items-start gap-2"><CalendarClock className="h-4 w-4 shrink-0 text-primary mt-0.5" /><p>{t("ai.overview.bookingLine")}</p></div>
            </div>
          </Panel>
          {agentRows.length === 0 && (
            <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              <EmptyState
                title={t("ai.overview.emptyTitle")}
                description={t("ai.overview.emptyHint")}
                icon={<Bot className="h-5 w-5" />}
              />
              {isHq && (
                <div className="flex justify-center mt-3">
                  <Button className="rounded-xl bg-primary text-primary-foreground" onClick={() => setShowRegister(true)}>
                    <Plus className="h-4 w-4 mr-1.5" />{t("ai.registerAgent")}
                  </Button>
                </div>
              )}
            </Panel>
          )}
        </TabsContent>

        {/* ---- AI Booking: apa AI tahu bila menempah ---- */}
        <TabsContent value="booking" className="mt-4 space-y-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.booking")}</p>
          <BookingBehaviourPanel />
          <BookingRecordsPanel />
        </TabsContent>

        <TabsContent value="prompt" forceMount className="mt-4 data-[state=inactive]:hidden">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.prompt")}</p>
          {selectedBranch ? <PromptSlotsEditor key={selectedBranch} branchId={selectedBranch} onTest={startTest} /> : (
            <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              <EmptyState title={t("ai.pickBranch")} description={t("ai.pickBranchPromptHint")} />
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="playground" forceMount className="mt-4 data-[state=inactive]:hidden">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.playground")}</p>
          {selectedBranch ? <PromptPlayground key={selectedBranch} branchId={selectedBranch} slotNumber={testSlot} onPickSlot={setTestSlot} /> : (
            <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              <EmptyState title={t("ai.pickBranch")} description={t("ai.pickBranchPlaygroundHint")} />
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="antiban" forceMount className="mt-4 data-[state=inactive]:hidden">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.antiban")}</p>
          {selectedBranch ? <AntibanSettingsPanel key={selectedBranch} branchId={selectedBranch} /> : (
            <EmptyState title={t("ai.pickBranch")} description={t("ai.pickBranchAntibanHint")} />
          )}
        </TabsContent>

        <TabsContent value="stoplist" forceMount className="mt-4 data-[state=inactive]:hidden">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.stoplist")}</p>
          <OptOutListPanel />
        </TabsContent>

        {/* ---- Agen ---- */}
        <TabsContent value="agents" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.agents")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
            action={isHq ? <Button size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={() => setShowRegister(true)}><Plus className="h-4 w-4 mr-1.5" />{t("ai.registerAgent")}</Button> : undefined}>
            {agents.isLoading && <Skeleton className="h-40 w-full" />}
            {agents.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(agents.error, t("ai.loadFailed"))}</p>}
            <div className="divide-y divide-border">
              {agentRows.map((agent) => (
                <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Bot className="h-5 w-5 shrink-0 text-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{agent.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{agent.description ?? agent.ownerDomain}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={agent.status} statusText={t(`ai.status.${agent.status}`)} className="rounded-full px-3 py-1 text-xs" />
                    <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground" onClick={() => { setSkillAgent(agent); setTab("skills"); }}>
                      <BookOpen className="h-3.5 w-3.5 mr-1" />{t("ai.skills")}
                    </Button>
                    {isHq && agent.status !== "enabled" && agent.status !== "archived" && (
                      <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground" disabled={transition.isPending} onClick={() => transition.mutate({ id: agent.id, action: "enable" })}>{t("ai.enable")}</Button>
                    )}
                    {isHq && agent.status === "enabled" && (
                      <Button size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground" disabled={transition.isPending} onClick={() => transition.mutate({ id: agent.id, action: "pause" })}>{t("ai.pause")}</Button>
                    )}
                    {isHq && agent.status !== "archived" && (
                      <Button size="sm" variant="outline" className="text-xs rounded-xl border-red-200 text-red-600" disabled={transition.isPending} onClick={() => transition.mutate({ id: agent.id, action: "archive" })}>{t("ai.archive")}</Button>
                    )}
                  </div>
                </div>
              ))}
              {agents.isSuccess && !agentRows.length && <EmptyState title={t("ai.noAgents")} description={t("ai.noAgentsHint")} icon={<Bot className="h-5 w-5" />} />}
            </div>
          </Panel>
        </TabsContent>

        {/* ---- Kemahiran ---- */}
        <TabsContent value="skills" className="mt-4 space-y-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.skills")}</p>
          {skillAgent ? (
            <>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-foreground" />
                <span className="text-sm font-semibold text-foreground">{skillAgent.name}</span>
                <span className="text-xs text-muted-foreground">· {skillAgent.ownerDomain}</span>
              </div>
              <SkillsPanel agent={skillAgent} />
            </>
          ) : (
            <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
              <EmptyState title={t("ai.pickAgentForSkills")} description={t("ai.pickAgentForSkillsHint")} icon={<BookOpen className="h-5 w-5" />} />
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="guardrails" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.guardrails")}</p>
          <GuardrailsPanel agents={agentRows} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4 space-y-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.approvals")}</p>
          {/* The QUEUE first: these are actions actually waiting on a human.
              The rules below are the configuration that produced them. */}
          <ApprovalQueuePanel />
          <ApprovalRulesPanel agents={agentRows} />
        </TabsContent>

        <TabsContent value="policy" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.policy")}</p>
          <PolicyTesterPanel agents={agentRows} />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("ai.tabDesc.audit")}</p>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {audit.isLoading && <Skeleton className="h-40 w-full" />}
            {audit.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(audit.error, t("ai.loadFailed"))}</p>}
            <div className="max-h-[480px] divide-y divide-border overflow-y-auto">
              {(audit.data ?? []).map((item) => (
                <div key={item.id} className="py-2.5">
                  <p className="text-sm text-foreground">{item.action ?? t("ai.auditAction")}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(item.createdAt)}{item.agentId ? ` · ${t("ai.agent")} ${item.agentId.slice(0, 8)}…` : ""}
                  </p>
                </div>
              ))}
              {audit.isSuccess && !(audit.data ?? []).length && <EmptyState title={t("ai.noAudit")} description={t("ai.noAuditHint")} />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <RegisterAgentDialog open={showRegister} onClose={() => setShowRegister(false)} />
    </div>
  );
}
