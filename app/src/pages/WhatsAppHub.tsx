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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { fmtDateTime } from "@/lib/format";
import { Radio, MessagesSquare, LayoutTemplate, ShieldAlert, Plus } from "lucide-react";
import { toast } from "sonner";

interface Channel { id: string; phone: string; sessionName?: string; status: string; healthScore: number }
interface Conversation { id: string; contactPhone: string; status: string; unreadCount: number; lastMessageAt?: string; patientId?: string }
interface Message { id: string; direction: string; body: string; status: string; sentAt?: string; createdAt?: string }
interface Template { id: string; name: string; body: string; category?: string; active: boolean }
interface Safety { id: string; createdAt?: string; decision?: string; reason?: string }

const channelFlow: Record<string, string[]> = {
  stopped: ["starting"], starting: ["working", "failed"], working: ["stopped"],
  failed: ["starting"], need_qr: ["working", "stopped"],
};

function NewChannelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ phone: "", session: "" });
  const create = useMutation({
    mutationFn: () => api.post<Channel>("/whatsapp/channels", { branchId, phone: form.phone, sessionName: form.session || null }),
    onSuccess: () => { toast.success("Channel registered"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); setForm({ phone: "", session: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to register channel")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Register Channel</DialogTitle><DialogDescription>Register a WhatsApp number for this branch. QR pairing happens in the WAHA gateway (external).</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Phone *</Label><Input required minLength={6} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6012-345 6789" /></div>
          <div className="space-y-1.5"><Label>Session name</Label><Input value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} placeholder="e.g. setia-tropika-main" /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Registering…" : "Register"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", body: "", category: "" });
  const create = useMutation({
    mutationFn: () => api.post<Template>("/whatsapp/templates", { branchId, name: form.name, body: form.body, category: form.category || null }),
    onSuccess: () => { toast.success("Template saved"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); setForm({ name: "", body: "", category: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Failed to save template")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Template</DialogTitle><DialogDescription>Quick-reply template for staff responses.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5"><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Body *</Label><Textarea required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} /></div>
          <div className="space-y-1.5"><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. appointment, greeting" /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={create.isPending}>{create.isPending ? "Saving…" : "Save Template"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConversationDetail({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const qc = useQueryClient();
  const messages = useQuery({
    queryKey: ["whatsapp", "messages", conv.id],
    queryFn: () => api.get<Message[]>(`/whatsapp/conversations/${conv.id}/messages?limit=100`),
  });
  const [reply, setReply] = useState("");
  const send = useMutation({
    mutationFn: () => api.post(`/whatsapp/conversations/${conv.id}/messages`, { body: reply }),
    onSuccess: () => { setReply(""); toast.success("Message sent"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Send failed")),
  });
  const resolve = useMutation({
    mutationFn: () => api.post(`/whatsapp/conversations/${conv.id}/resolve`, {}),
    onSuccess: () => { toast.success("Conversation resolved"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Resolve failed")),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{conv.contactPhone}</DialogTitle>
          <DialogDescription>Conversation thread — {conv.status}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-2 rounded-lg bg-slate-50 p-3 min-h-[220px]">
          {messages.isLoading && <Skeleton className="h-32 w-full" />}
          {(messages.data ?? []).map((m) => (
            <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.direction === "outbound" ? "ml-auto bg-emerald-600 text-white" : "bg-white border text-slate-800"}`}>
              <p>{m.body}</p>
              <p className={`text-[10px] mt-0.5 ${m.direction === "outbound" ? "text-emerald-100" : "text-slate-400"}`}>{fmtDateTime(m.sentAt ?? m.createdAt)}</p>
            </div>
          ))}
          {!messages.isLoading && !(messages.data ?? []).length && <p className="text-center text-xs text-slate-400 py-8">No messages in this thread yet.</p>}
        </div>
        <form className="flex gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) send.mutate(); }}>
          <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" />
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={send.isPending || !reply.trim()}>Send</Button>
          <Button type="button" variant="outline" onClick={() => resolve.mutate()}>Resolve</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WhatsAppHub() {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ["whatsapp", "channels"], queryFn: () => api.get<Channel[]>("/whatsapp/channels") });
  const conversations = useQuery({ queryKey: ["whatsapp", "conversations"], queryFn: () => api.get<Conversation[]>("/whatsapp/conversations") });
  const templates = useQuery({ queryKey: ["whatsapp", "templates"], queryFn: () => api.get<Template[]>("/whatsapp/templates") });
  const safety = useQuery({ queryKey: ["whatsapp", "safety"], queryFn: () => api.get<Safety[]>("/whatsapp/safety-decisions") });

  const [showChannel, setShowChannel] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);

  const channelStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/whatsapp/channels/${id}/status`, { status }),
    onSuccess: () => { toast.success("Channel updated"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Update failed")),
  });

  const chanRows = channels.data ?? [];
  const convRows = conversations.data ?? [];
  const unread = convRows.reduce((s, c) => s + (c.unreadCount ?? 0), 0);

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="WhatsApp Hub"
        description="Channels, conversations, templates and safety decisions"
        actions={<div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowTemplate(true)}><LayoutTemplate className="h-4 w-4 mr-1.5" /> New Template</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowChannel(true)}><Plus className="h-4 w-4 mr-1.5" /> Register Channel</Button>
        </div>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Channels", value: chanRows.length, icon: <Radio className="h-4 w-4" /> },
          { label: "Conversations", value: convRows.length, icon: <MessagesSquare className="h-4 w-4" /> },
          { label: "Unread", value: unread, icon: <MessagesSquare className="h-4 w-4" /> },
          { label: "Templates", value: (templates.data ?? []).length, icon: <LayoutTemplate className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium">{k.label}<span className="text-emerald-600 bg-emerald-50 rounded-lg p-1.5">{k.icon}</span></div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="conversations">
        <TabsList className="bg-white border">
          <TabsTrigger value="conversations"><MessagesSquare className="h-3.5 w-3.5 mr-1.5" />Conversations</TabsTrigger>
          <TabsTrigger value="channels"><Radio className="h-3.5 w-3.5 mr-1.5" />Channels</TabsTrigger>
          <TabsTrigger value="templates"><LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />Templates</TabsTrigger>
          <TabsTrigger value="safety"><ShieldAlert className="h-3.5 w-3.5 mr-1.5" />Safety</TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="mt-4">
          <Panel>
            {conversations.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {convRows.map((c) => (
                <button key={c.id} className="w-full text-left py-3 flex items-center justify-between hover:bg-slate-50 rounded-lg px-2 -mx-2 transition" onClick={() => setActiveConv(c)}>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.contactPhone}</p>
                    <p className="text-xs text-slate-400">{c.lastMessageAt ? fmtDateTime(c.lastMessageAt) : "no messages"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.unreadCount > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{c.unreadCount}</span>}
                    <StatusBadge status={c.status} />
                  </div>
                </button>
              ))}
              {!conversations.isLoading && !convRows.length && (
                <EmptyState title="No conversations" description={chanRows.length ? "Conversations will appear when messages arrive on a connected channel." : "Register a WhatsApp channel first, then pair it via the WAHA gateway."} />
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="channels" className="mt-4">
          <Panel>
            {channels.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {chanRows.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.phone}</p>
                    <p className="text-xs text-slate-400">{c.sessionName ?? "—"} · health {c.healthScore}/100</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} />
                    {(channelFlow[c.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs" disabled={channelStatus.isPending} onClick={() => channelStatus.mutate({ id: c.id, status: next })}>{next.replace(/_/g, " ")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!channels.isLoading && !chanRows.length && (
                <EmptyState title="No WhatsApp channels connected" description="Register a channel to begin. The external WAHA gateway handles QR pairing and message transport." />
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Panel>
            {templates.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(templates.data ?? []).map((t) => (
                <div key={t.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-800">{t.name}</p>
                    <StatusBadge status={t.active ? "active" : "inactive"} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{t.body}</p>
                </div>
              ))}
              {!templates.isLoading && !(templates.data ?? []).length && <EmptyState title="No templates" description="Create quick-reply templates for common patient questions." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="safety" className="mt-4">
          <Panel>
            {safety.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(safety.data ?? []).map((s) => (
                <div key={s.id} className="py-3">
                  <p className="text-sm font-medium text-slate-800">{s.decision ?? "Safety decision"}</p>
                  <p className="text-xs text-slate-400">{fmtDateTime(s.createdAt)}{s.reason ? ` · ${s.reason}` : ""}</p>
                </div>
              ))}
              {!safety.isLoading && !(safety.data ?? []).length && <EmptyState title="No safety decisions" description="AI safety-gate evaluations will be audited here." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <NewChannelDialog open={showChannel} onClose={() => setShowChannel(false)} />
      <NewTemplateDialog open={showTemplate} onClose={() => setShowTemplate(false)} />
      {activeConv && <ConversationDetail conv={activeConv} onClose={() => setActiveConv(null)} />}
    </div>
  );
}
