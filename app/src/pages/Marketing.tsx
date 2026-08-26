import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { PageHeader, Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate } from "@/lib/format";
import { Megaphone, Users, Plus, BellRing, Repeat } from "lucide-react";
import { toast } from "sonner";

interface Lead { id: string; name: string; phone?: string; source: string; interestedTreatment?: string; status: string; createdAt?: string }
interface Campaign { id: string; name: string; intent: string; status: string; createdAt?: string }
interface RecallCase { id: string; dueDate?: string; status: string; createdAt?: string }
interface FollowUp { id: string; dueDate?: string; status: string; createdAt?: string }

const leadFlow: Record<string, string[]> = {
  new: ["contacted", "lost"], contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"], converted: [], lost: [],
};
const campaignFlow: Record<string, string[]> = {
  draft: ["pending_approval", "cancelled"], pending_approval: ["approved", "cancelled"],
  approved: ["archived"], cancelled: [], archived: [],
};

function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", phone: "", source: "Walk-in", treatment: "" });
  const create = useMutation({
    mutationFn: () => api.post<Lead>("/marketing/leads", {
      branchId, name: form.name, phone: form.phone || null, source: form.source,
      interestedTreatment: form.treatment || null,
    }),
    onSuccess: () => { toast.success("Lead created"); qc.invalidateQueries({ queryKey: ["marketing"] }); onClose(); setForm({ name: "", phone: "", source: "Walk-in", treatment: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to create lead")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Lead</DialogTitle><DialogDescription>Register a prospective patient lead.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Name *</Label><Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Source *</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["Walk-in", "Google", "Facebook", "Referral", "WhatsApp", "Others"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Interested treatment</Label><Input value={form.treatment} onChange={(e) => setForm({ ...form, treatment: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create Lead"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", intent: "", audience: "all_active_patients" });
  const create = useMutation({
    mutationFn: () => api.post<Campaign>("/marketing/campaigns", {
      branchId, name: form.name, intent: form.intent,
      audienceDefinition: { segment: form.audience },
    }),
    onSuccess: () => { toast.success("Campaign created (draft)"); qc.invalidateQueries({ queryKey: ["marketing"] }); onClose(); setForm({ name: "", intent: "", audience: "all_active_patients" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to create campaign")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Campaign</DialogTitle><DialogDescription>Draft a marketing campaign (pending approval workflow).</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Name *</Label><Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Intent *</Label><Input required value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })} placeholder="e.g. Recall overdue scaling patients" /></div>
          <div className="space-y-1.5"><Label>Audience</Label>
            <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active_patients">All active patients</SelectItem>
                <SelectItem value="recall_due">Recall due</SelectItem>
                <SelectItem value="new_leads">New leads</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create Campaign"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Marketing() {
  const qc = useQueryClient();
  const leads = useQuery({ queryKey: ["marketing", "leads"], queryFn: () => api.get<Lead[]>("/marketing/leads") });
  const campaigns = useQuery({ queryKey: ["marketing", "campaigns"], queryFn: () => api.get<Campaign[]>("/marketing/campaigns") });
  const recalls = useQuery({ queryKey: ["marketing", "recalls"], queryFn: () => api.get<RecallCase[]>("/marketing/recall-cases") });
  const followUps = useQuery({ queryKey: ["marketing", "followups"], queryFn: () => api.get<FollowUp[]>("/marketing/follow-ups") });

  const [showLead, setShowLead] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);

  const leadStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/marketing/leads/${id}/status`, { status }),
    onSuccess: () => { toast.success("Lead updated"); qc.invalidateQueries({ queryKey: ["marketing"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Update failed")),
  });
  const campaignStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/marketing/campaigns/${id}/status`, { status }),
    onSuccess: () => { toast.success("Campaign updated"); qc.invalidateQueries({ queryKey: ["marketing"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Update failed")),
  });

  const leadRows = leads.data ?? [];
  const campRows = campaigns.data ?? [];

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="Marketing"
        description="Leads, campaigns, recall cases and follow-ups"
        actions={<div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCampaign(true)}><Megaphone className="h-4 w-4 mr-1.5" /> New Campaign</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowLead(true)}><Plus className="h-4 w-4 mr-1.5" /> New Lead</Button>
        </div>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Leads", value: leadRows.length, icon: <Users className="h-4 w-4" /> },
          { label: "Campaigns", value: campRows.length, icon: <Megaphone className="h-4 w-4" /> },
          { label: "Recall Cases", value: (recalls.data ?? []).length, icon: <BellRing className="h-4 w-4" /> },
          { label: "Follow-ups", value: (followUps.data ?? []).length, icon: <Repeat className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium">{k.label}<span className="text-emerald-600 bg-emerald-50 rounded-lg p-1.5">{k.icon}</span></div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="leads">
        <TabsList className="bg-white border">
          <TabsTrigger value="leads"><Users className="h-3.5 w-3.5 mr-1.5" />Leads</TabsTrigger>
          <TabsTrigger value="campaigns"><Megaphone className="h-3.5 w-3.5 mr-1.5" />Campaigns</TabsTrigger>
          <TabsTrigger value="recalls"><BellRing className="h-3.5 w-3.5 mr-1.5" />Recall</TabsTrigger>
          <TabsTrigger value="followups"><Repeat className="h-3.5 w-3.5 mr-1.5" />Follow-ups</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Panel>
            {leads.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {leadRows.map((l) => (
                <div key={l.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{l.name}</p>
                    <p className="text-xs text-slate-400">{l.source}{l.phone ? ` · ${l.phone}` : ""}{l.interestedTreatment ? ` · ${l.interestedTreatment}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={l.status} />
                    {(leadFlow[l.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs" disabled={leadStatus.isPending} onClick={() => leadStatus.mutate({ id: l.id, status: next })}>{next}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!leads.isLoading && !leadRows.length && <EmptyState title="No leads found" description="Create the first lead to start tracking prospective patients." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          <Panel>
            {campaigns.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {campRows.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400 truncate">{c.intent}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} />
                    {(campaignFlow[c.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs" disabled={campaignStatus.isPending} onClick={() => campaignStatus.mutate({ id: c.id, status: next })}>{next.replace(/_/g, " ")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!campaigns.isLoading && !campRows.length && <EmptyState title="No campaigns found" description="Draft the first campaign to reach out to patients." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="recalls" className="mt-4">
          <Panel>
            {recalls.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(recalls.data ?? []).map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">Recall due {fmtDate(r.dueDate)}</p>
                  <StatusBadge status={r.status} />
                </div>
              ))}
              {!recalls.isLoading && !(recalls.data ?? []).length && <EmptyState title="No recall cases" description="Recall cases are generated from recall rules and appointment history." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="followups" className="mt-4">
          <Panel>
            {followUps.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(followUps.data ?? []).map((f) => (
                <div key={f.id} className="py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">Follow-up {fmtDate(f.dueDate)}</p>
                  <StatusBadge status={f.status} />
                </div>
              ))}
              {!followUps.isLoading && !(followUps.data ?? []).length && <EmptyState title="No follow-ups" description="Post-treatment follow-ups will appear here." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewLeadDialog open={showLead} onClose={() => setShowLead(false)} />
      <NewCampaignDialog open={showCampaign} onClose={() => setShowCampaign(false)} />
    </div>
  );
}
