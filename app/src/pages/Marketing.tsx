import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentsPanel, TemplatesPanel } from "@/components/marketing/MarketingContentPanels";
import ScrubbingPanel from "@/components/marketing/ScrubbingPanel";
import { canWriteMarketing } from "@/lib/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate } from "@/lib/format";
import { Megaphone, Users, Plus, BellRing, Repeat, Settings2, Target, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Lead { id: string; name: string; phone?: string; source: string; interestedTreatment?: string; status: string; createdAt?: string }
interface Campaign { id: string; name: string; intent: string; status: string; createdAt?: string }
interface RecallCase { id: string; dueDate?: string; status: string; createdAt?: string; patientName?: string; lastVisitDate?: string }
interface FollowUp { id: string; dueDate?: string; status: string; createdAt?: string; patientName?: string; treatmentName?: string }
interface FollowUpRule { id: string; name: string; treatmentCode?: string; daysAfter: number; active: boolean }
interface RecallRule { id: string; name: string; treatmentCode?: string; intervalMonths: number; active: boolean; effectiveFrom: string }

const leadFlow: Record<string, string[]> = {
  new: ["contacted", "lost"], contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"], converted: [], lost: [],
};
const campaignFlow: Record<string, string[]> = {
  draft: ["pending_approval", "cancelled"], pending_approval: ["approved", "cancelled"],
  approved: ["archived"], cancelled: [], archived: [],
};

function NewFollowUpRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", treatmentCode: "", days: "3" });
  const create = useMutation({
    mutationFn: () => api.post<FollowUpRule>("/marketing/follow-up-rules", {
      branchId,
      name: form.name || t("mkt.autoFollowupName").replace("{t}", form.treatmentCode || t("mkt.allShort")).replace("{n}", String(form.days)),
      treatmentCode: form.treatmentCode || null,
      daysAfter: parseInt(form.days, 10),
    }),
    onSuccess: () => { toast.success(t("msg.ruleCreated")); qc.invalidateQueries({ queryKey: ["marketing"] }); onClose(); setForm({ name: "", treatmentCode: "", days: "3" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.ruleCreateFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("mkt.followupRuleTitle")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("mkt.followupRuleHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.ruleName")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("mkt.ruleNameHint")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.treatmentFallback")}</Label>
            <Select value={form.treatmentCode} onValueChange={(v) => setForm({ ...form, treatmentCode: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5">
                <SelectValue placeholder={t("mkt.treatmentAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("mkt.treatmentAll")}</SelectItem>
                <SelectItem value="SCALING">Scaling</SelectItem>
                <SelectItem value="EXTRACTION">Extraction</SelectItem>
                <SelectItem value="FILLING">Filling</SelectItem>
                <SelectItem value="BRACES">Braces</SelectItem>
                <SelectItem value="ROOTCANAL">Root Canal</SelectItem>
                <SelectItem value="DENTURE">Denture</SelectItem>
                <SelectItem value="CHECKUP">Check-up</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.daysAfter")}</Label>
            <Select value={form.days} onValueChange={(v) => setForm({ ...form, days: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t("marketing.nDays", { n: 1 })}</SelectItem>
                                <SelectItem value="3">{t("marketing.nDays", { n: 3 })}</SelectItem>
                                <SelectItem value="7">{t("marketing.nDays", { n: 7 })}</SelectItem>
                                <SelectItem value="14">{t("marketing.nDays", { n: 14 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>{t("marketing.followupPreview")}</p>
            <p className="mt-1">{t("marketing.followupLine1")}</p>
            <p>{t("marketing.followupLine2")}</p>
            <p>{t("marketing.windowLine")}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending}>{create.isPending ? t("marketing.creating") : t("marketing.saveRule")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewRecallRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", treatmentCode: "", interval: "6", customInterval: "" });
  const create = useMutation({
    mutationFn: () => {
      const months = form.interval === "custom" ? parseInt(form.customInterval, 10) : parseInt(form.interval, 10);
      return api.post<RecallRule>("/marketing/recall-rules", {
        branchId,
        name: form.name || t("mkt.autoRecallName").replace("{t}", form.treatmentCode || t("mkt.allShort")).replace("{n}", String(months)),
        treatmentCode: form.treatmentCode || null,
        intervalMonths: months,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: () => { toast.success(t("msg.ruleRecallCreated")); qc.invalidateQueries({ queryKey: ["marketing"] }); onClose(); setForm({ name: "", treatmentCode: "", interval: "6", customInterval: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.ruleCreateFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("mkt.recallRuleTitle")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("mkt.recallRuleHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.ruleName")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("mkt.ruleNameHintRecall")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.treatmentFallback")}</Label>
            <Select value={form.treatmentCode} onValueChange={(v) => setForm({ ...form, treatmentCode: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5">
                <SelectValue placeholder={t("mkt.treatmentAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("mkt.treatmentAll")}</SelectItem>
                <SelectItem value="SCALING">Scaling</SelectItem>
                <SelectItem value="EXTRACTION">Extraction</SelectItem>
                <SelectItem value="FILLING">Filling</SelectItem>
                <SelectItem value="BRACES">Braces</SelectItem>
                <SelectItem value="ROOTCANAL">Root Canal</SelectItem>
                <SelectItem value="DENTURE">Denture</SelectItem>
                <SelectItem value="CHECKUP">Check-up</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.interval")}</Label>
            <Select value={form.interval} onValueChange={(v) => setForm({ ...form, interval: v })}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 bulan</SelectItem>
                <SelectItem value="3">3 bulan</SelectItem>
                <SelectItem value="6">6 bulan</SelectItem>
                <SelectItem value="12">12 bulan</SelectItem>
                <SelectItem value="custom">{t("mkt.customOption")}</SelectItem>
              </SelectContent>
            </Select>
            {form.interval === "custom" && (
              <Input
                type="number"
                min={1}
                max={36}
                value={form.customInterval}
                onChange={(e) => setForm({ ...form, customInterval: e.target.value })}
                placeholder={t("mkt.monthsAfter")}
                className="rounded-xl border-border bg-card px-4 py-2.5 mt-2"
              />
            )}
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>{t("mkt.recallPreview")}</p>
            <p className="mt-1">{t("marketing.windowLine")}</p>
            <p>{t("marketing.capLine")}</p>
            <p>{t("marketing.antibanLine")}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || (form.interval === "custom" && !form.customInterval)}>{create.isPending ? t("marketing.creating") : t("marketing.saveRule")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", phone: "", source: "Walk-in", treatment: "" });
  const create = useMutation({
    mutationFn: () => api.post<Lead>("/marketing/leads", {
      branchId, name: form.name, phone: form.phone || null, source: form.source,
      interestedTreatment: form.treatment || null,
    }),
    onSuccess: () => { toast.success(t("msg.leadCreated")); qc.invalidateQueries({ queryKey: ["marketing"] }); onClose(); setForm({ name: "", phone: "", source: "Walk-in", treatment: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.ruleCreateFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("mkt.newLead")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("mkt.leadHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.nameRequired")} *</Label>
            <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.sourceRequired")}</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Walk-in", "Google", "Facebook", "Referral", "WhatsApp", "Others"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.leadInterest")}</Label>
            <Input value={form.treatment} onChange={(e) => setForm({ ...form, treatment: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Create Lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", intent: "", audience: "all_active_patients" });
  const create = useMutation({
    mutationFn: () => api.post<Campaign>("/marketing/campaigns", {
      branchId, name: form.name, intent: form.intent,
      audienceDefinition: { segment: form.audience },
    }),
    onSuccess: () => { toast.success(t("msg.campaignCreated")); qc.invalidateQueries({ queryKey: ["marketing"] }); onClose(); setForm({ name: "", intent: "", audience: "all_active_patients" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.ruleCreateFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("mkt.newCampaign")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">Draft a marketing campaign (pending approval workflow).</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.nameRequired")} *</Label>
            <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.intentRequired")}</Label>
            <Input required value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })} placeholder={t("mkt.campaignName")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("mkt.audienceLabel")}</Label>
            <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
              <SelectTrigger className="w-full rounded-xl border-border bg-card px-4 py-2.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active_patients">{t("mkt.audienceAllActive")}</SelectItem>
                <SelectItem value="recall_due">{t("mkt.audienceRecallDue")}</SelectItem>
                <SelectItem value="new_leads">{t("mkt.audienceNewLeads")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Create Campaign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Marketing() {
  const { user } = useAuth();
  const { t } = usePrefs();
  const canWrite = canWriteMarketing(user?.role);
  const qc = useQueryClient();
  const leads = useQuery({ queryKey: ["marketing", "leads"], queryFn: () => api.get<Lead[]>("/marketing/leads") });
  const campaigns = useQuery({ queryKey: ["marketing", "campaigns"], queryFn: () => api.get<Campaign[]>("/marketing/campaigns") });
  const recalls = useQuery({ queryKey: ["marketing", "recalls"], queryFn: () => api.get<RecallCase[]>("/marketing/recall-cases") });
  const followUps = useQuery({ queryKey: ["marketing", "followups"], queryFn: () => api.get<FollowUp[]>("/marketing/follow-ups") });
  const recallRules = useQuery({ queryKey: ["marketing", "recall-rules"], queryFn: () => api.get<RecallRule[]>("/marketing/recall-rules") });

  const [showLead, setShowLead] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showRecallRule, setShowRecallRule] = useState(false);
  const [showFollowUpRule, setShowFollowUpRule] = useState(false);

  const leadStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/marketing/leads/${id}/status`, { status }),
    onSuccess: () => { toast.success(t("msg.leadUpdated")); qc.invalidateQueries({ queryKey: ["marketing"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.updateFailed"))),
  });
  const campaignStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/marketing/campaigns/${id}/status`, { status }),
    onSuccess: () => { toast.success(t("msg.campaignUpdated")); qc.invalidateQueries({ queryKey: ["marketing"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.updateFailed"))),
  });

  const leadRows = leads.data ?? [];
  const campRows = campaigns.data ?? [];
  const ruleRows = recallRules.data ?? [];

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={t("nav.marketingTitle")}
        description={t("nav.marketingDesc")}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="rounded-xl border-border bg-card shadow-md text-foreground hover:bg-card" onClick={() => setShowCampaign(true)}>
              <Megaphone className="h-4 w-4 mr-1.5" /> {t("mkt.newCampaign")}
            </Button>
            <Button size="sm" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowLead(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> {t("mkt.newLead")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: t("mkt.kpiLeads"), value: leadRows.length, icon: <Users className="h-4 w-4" /> },
          { label: t("mkt.kpiCampaigns"), value: campRows.length, icon: <Megaphone className="h-4 w-4" /> },
          { label: t("mkt.kpiRecall"), value: (recalls.data ?? []).length, icon: <BellRing className="h-4 w-4" /> },
          { label: t("mkt.kpiFollowups"), value: (followUps.data ?? []).length, icon: <Repeat className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="glass-card bg-card border border-border shadow-sm rounded-lg p-4">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              {k.label}
              <span className="text-foreground bg-accent rounded-xl p-1.5 ring-1 ring-teal-200">{k.icon}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="leads">
        <TabsList className="bg-card border border-border rounded-lg p-1 shadow-md flex flex-wrap gap-1">
          <TabsTrigger value="leads" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Users className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabLeads")}
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Megaphone className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabCampaigns")}
          </TabsTrigger>
          <TabsTrigger value="recalls" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <BellRing className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabRecall")}
          </TabsTrigger>
          <TabsTrigger value="followups" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Repeat className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabFollowups")}
          </TabsTrigger>
          <TabsTrigger value="recall-rules" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Settings2 className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabRecallRules")}
          </TabsTrigger>
          <TabsTrigger value="scrubbing" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabScrubbing")}
          </TabsTrigger>
          <TabsTrigger value="segments" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Target className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabSegmentsPlain")}
          </TabsTrigger>
          <TabsTrigger value="templates" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <FileText className="h-3.5 w-3.5 mr-1.5" />{t("mkt.tabTemplatesPlain")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Panel title={t("mkt.leadsTitle")} subtitle={t("mkt.leadsSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {leads.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {leadRows.map((l) => (
                <div key={l.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{l.source}{l.phone ? ` · ${l.phone}` : ""}{l.interestedTreatment ? ` · ${l.interestedTreatment}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={l.status} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    {(leadFlow[l.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={leadStatus.isPending} onClick={() => leadStatus.mutate({ id: l.id, status: next })}>
                        {next}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {!leads.isLoading && !leadRows.length && <EmptyState title={t("mkt.noLeads")} description={t("mkt.noLeadsHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          <Panel title={t("mkt.campaignsTitle")} subtitle={t("mkt.campaignsSub")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {campaigns.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {campRows.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.intent}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                    {(campaignFlow[c.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={campaignStatus.isPending} onClick={() => campaignStatus.mutate({ id: c.id, status: next })}>
                        {next.replace(/_/g, " ")}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {!campaigns.isLoading && !campRows.length && <EmptyState title={t("mkt.noCampaigns")} description={t("mkt.noCampaignsHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="recalls" className="mt-4">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">{t("mkt.recallsSub")}</p>
          {/* Recall stats */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(recalls.data ?? []).filter((r) => r.status === "open").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusWaiting")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(recalls.data ?? []).filter((r) => r.status === "contacted").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusContacted")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(recalls.data ?? []).filter((r) => r.status === "completed").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusCompleted")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(recalls.data ?? []).filter((r) => r.status === "opted_out").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusStopped")}</p>
            </div>
          </div>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {recalls.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(recalls.data ?? []).map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.patientName ?? t("msg.patientFallback")}</p>
                    <p className="text-xs text-muted-foreground">Recall due {fmtDate(r.dueDate)}{r.lastVisitDate ? ` · Lawatan terakhir ${fmtDate(r.lastVisitDate)}` : ""}</p>
                  </div>
                  <StatusBadge status={r.status} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                </div>
              ))}
              {!recalls.isLoading && !(recalls.data ?? []).length && <EmptyState title={t("mkt.noRecallPlain")} description={t("mkt.noRecallHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="followups" className="mt-4">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">{t("mkt.followupsSub")}</p>
          {/* Follow-up stats */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(followUps.data ?? []).filter((f) => f.status === "open").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusWaiting")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(followUps.data ?? []).filter((f) => f.status === "contacted").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusContacted")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(followUps.data ?? []).filter((f) => f.status === "completed").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusCompleted")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-2xl font-bold text-foreground">{(followUps.data ?? []).filter((f) => f.status === "opted_out").length}</p>
              <p className="text-xs text-muted-foreground">{t("mkt.statusStopped")}</p>
            </div>
          </div>
          <div className="mb-3 flex justify-end">
            <Button size="sm" className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowFollowUpRule(true)}>
              <Plus className="h-4 w-4 mr-1.5" />{t("mkt.newRule")}
            </Button>
          </div>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {followUps.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {(followUps.data ?? []).map((f) => (
                <div key={f.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{f.patientName ?? t("msg.patientFallback")}</p>
                    <p className="text-xs text-muted-foreground">{f.treatmentName ?? t("mkt.treatmentFallback")} · Follow-up {fmtDate(f.dueDate)}</p>
                  </div>
                  <StatusBadge status={f.status} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                </div>
              ))}
              {!followUps.isLoading && !(followUps.data ?? []).length && <EmptyState title={t("mkt.noFollowups")} description={t("mkt.noFollowupsHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="recall-rules" className="mt-4">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">{t("mkt.rulesSub")}</p>
          <div className="mb-3 flex justify-end">
            <Button size="sm" className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowRecallRule(true)}>
              <Plus className="h-4 w-4 mr-1.5" />{t("mkt.newRule")}
            </Button>
          </div>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {recallRules.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {ruleRows.map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.treatmentCode ?? t("mkt.treatmentAll")} · {r.intervalMonths} {t("mkt.monthsShort")} · {r.active ? t("common.active") : t("common.inactive")}
                    </p>
                  </div>
                  <StatusBadge status={r.active ? "active" : "inactive"} className="rounded-full px-3 py-1 text-xs font-medium bg-accent text-foreground ring-1 ring-teal-200" />
                </div>
              ))}
              {!recallRules.isLoading && !ruleRows.length && <EmptyState title={t("mkt.noRules")} description={t("mkt.noRulesHint")} />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="scrubbing" className="mt-4">
          <ScrubbingPanel />
        </TabsContent>
        <TabsContent value="segments" className="mt-4">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">{t("mkt.segmentsSub")}</p>
          <SegmentsPanel canWrite={canWrite} />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">{t("mkt.templatesSub")}</p>
          <TemplatesPanel canWrite={canWrite} />
        </TabsContent>
      </Tabs>

      <NewLeadDialog open={showLead} onClose={() => setShowLead(false)} />
      <NewCampaignDialog open={showCampaign} onClose={() => setShowCampaign(false)} />
      <NewRecallRuleDialog open={showRecallRule} onClose={() => setShowRecallRule(false)} />
      <NewFollowUpRuleDialog open={showFollowUpRule} onClose={() => setShowFollowUpRule(false)} />
    </div>
  );
}
