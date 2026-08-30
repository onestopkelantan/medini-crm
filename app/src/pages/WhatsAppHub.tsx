import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { fmtDateTime } from "@/lib/format";
import { Radio, MessagesSquare, LayoutTemplate, ShieldAlert, Plus, Send, CheckCheck, User, Phone } from "lucide-react";
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

function initials(phone: string) {
  const d = (phone || "").replace(/[^0-9]/g, "");
  return d.length >= 2 ? d.slice(-2) : (phone || "?").slice(0, 2).toUpperCase();
}

function NewChannelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ phone: "", session: "" });
  const create = useMutation({
    mutationFn: () => api.post<Channel>("/whatsapp/channels", { branchId, phone: form.phone, sessionName: form.session || null }),
    onSuccess: () => { toast.success("Channel didaftar"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); setForm({ phone: "", session: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Gagal daftar channel")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-white/90 backdrop-blur-xl shadow-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">Register Channel</DialogTitle>
          <DialogDescription className="text-slate-500">Daftar nombor WhatsApp untuk cawangan ini. Pasangan QR dibuat dalam gateway WAHA (luaran).</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-slate-700 font-medium">Phone *</Label>
            <Input required minLength={6} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6012-345 6789" className="rounded-xl border-slate-200 bg-white/80 px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-700 font-medium">Session name</Label>
            <Input value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} placeholder="cth. setia-tropika-main" className="rounded-xl border-slate-200 bg-white/80 px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50">Batal</Button>
            <Button className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50" disabled={create.isPending}>{create.isPending ? "Mendaftar..." : "Daftar"}</Button>
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
    onSuccess: () => { toast.success("Template disimpan"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); setForm({ name: "", body: "", category: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Gagal simpan template")),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-white/90 backdrop-blur-xl shadow-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">New Template</DialogTitle>
          <DialogDescription className="text-slate-500">Template balasan pantas untuk staf.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-slate-700 font-medium">Nama *</Label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border-slate-200 bg-white/80 px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-700 font-medium">Isi *</Label>
            <Textarea required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} className="rounded-xl border-slate-200 bg-white/80 p-3" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-700 font-medium">Kategori</Label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="cth. appointment, greeting" className="rounded-xl border-slate-200 bg-white/80 px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50">Batal</Button>
            <Button className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50" disabled={create.isPending}>{create.isPending ? "Menyimpan..." : "Simpan Template"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChatPane({ conv, templates, onResolved }: { conv: Conversation; templates: Template[]; onResolved: () => void }) {
  const qc = useQueryClient();
  const messages = useQuery({
    queryKey: ["whatsapp", "messages", conv.id],
    queryFn: () => api.get<Message[]>(`/whatsapp/conversations/${conv.id}/messages?limit=100`),
  });
  const [reply, setReply] = useState("");
  const send = useMutation({
    mutationFn: () => api.post(`/whatsapp/conversations/${conv.id}/messages`, { body: reply }),
    onSuccess: () => { setReply(""); toast.success("Mesej dihantar"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Gagal hantar")),
  });
  const resolve = useMutation({
    mutationFn: () => api.post(`/whatsapp/conversations/${conv.id}/resolve`, {}),
    onSuccess: () => { toast.success("Perbualan diselesaikan"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onResolved(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Gagal selesai")),
  });
  const rows = messages.data ?? [];
  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] text-sm font-bold text-white">{initials(conv.contactPhone)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-[#0B132B]">{conv.contactPhone}</p>
          <p className="flex items-center gap-1 text-[11px] text-teal-600"><span className="inline-block h-2 w-2 rounded-full bg-teal-500" />{conv.status}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => resolve.mutate()} disabled={resolve.isPending} className="rounded-full border-slate-200 text-xs text-slate-700 hover:bg-slate-50">Resolve</Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-[#F4F7FA] p-4">
        {messages.isLoading && <Skeleton className="h-24 w-full" />}
        {rows.map((m) => (
          m.direction === "outbound" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] px-3.5 py-2 text-white shadow-sm">
                <p className="text-[13px] leading-snug">{m.body}</p>
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-teal-50">{fmtDateTime(m.sentAt ?? m.createdAt)}<CheckCheck className="h-3 w-3" /></p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex">
              <div className="max-w-[75%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 shadow-sm">
                <p className="text-[13px] leading-snug text-slate-800">{m.body}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(m.sentAt ?? m.createdAt)}</p>
              </div>
            </div>
          )
        ))}
        {!messages.isLoading && !rows.length && <p className="py-8 text-center text-xs text-slate-400">Tiada mesej dalam perbualan ini lagi.</p>}
      </div>
      <div className="space-y-2 border-t border-gray-100 p-3">
        <div className="flex flex-wrap gap-2">
          <select className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600 focus:outline-none" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setReply(t.body); }}>
            <option value="">Sisip template...</option>
            {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) send.mutate(); }}>
          <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Taip balasan..." className="flex-1 rounded-full border-slate-200 bg-white px-4 py-2" />
          <Button className="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-4 text-white hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50" disabled={send.isPending || !reply.trim()}><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </>
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const channelStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/whatsapp/channels/${id}/status`, { status }),
    onSuccess: () => { toast.success("Channel dikemas kini"); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Gagal kemas kini")),
  });
  const chanRows = channels.data ?? [];
  const convRows = conversations.data ?? [];
  const tmplRows = templates.data ?? [];
  const connected = chanRows.some((c) => c.status === "working");
  const activeConv = convRows.find((c) => c.id === activeId) ?? null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "#0B132B", fontFamily: "'Outfit', sans-serif" }}>WhatsApp Hub</h1>
          <p className="text-sm text-slate-400">Urus perbualan - balas - selesai</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${connected ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-slate-100 text-slate-500 ring-slate-200"}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-teal-500" : "bg-slate-400"}`} />
          {connected ? "Bersambung" : "Tiada sambungan"}
        </span>
      </div>
      <Tabs defaultValue="conversations">
        <TabsList className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-1 shadow-md flex flex-wrap gap-1">
          <TabsTrigger value="conversations" className="rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white"><MessagesSquare className="h-3.5 w-3.5 mr-1.5" />Perbualan</TabsTrigger>
          <TabsTrigger value="channels" className="rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white"><Radio className="h-3.5 w-3.5 mr-1.5" />Channel</TabsTrigger>
          <TabsTrigger value="templates" className="rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white"><LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />Template</TabsTrigger>
          <TabsTrigger value="safety" className="rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white"><ShieldAlert className="h-3.5 w-3.5 mr-1.5" />Keselamatan</TabsTrigger>
        </TabsList>
        <TabsContent value="conversations" className="mt-4">
          <div className="glass-card overflow-hidden rounded-2xl border border-white/40 bg-white/80 shadow-xl backdrop-blur-xl">
            <div className="grid h-[560px] grid-cols-1 md:grid-cols-3 lg:grid-cols-4">
              <div className="overflow-y-auto border-r border-gray-100">
                {conversations.isLoading && <div className="p-4"><Skeleton className="h-40 w-full" /></div>}
                {convRows.map((c) => {
                  const active = c.id === activeId;
                  return (
                    <button key={c.id} onClick={() => setActiveId(c.id)} className={`flex w-full cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition hover:bg-teal-50/40 ${active ? "bg-teal-50/60 border-l-2 border-l-[#0DC9B7]" : ""}`}>
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] text-sm font-bold text-white">{initials(c.contactPhone)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[13px] font-bold text-[#0B132B]">{c.contactPhone}</p>
                          <span className="shrink-0 text-[10px] text-slate-400">{c.lastMessageAt ? fmtDateTime(c.lastMessageAt) : ""}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[11.5px] text-slate-400">{c.status}</p>
                          {c.unreadCount > 0 && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0DC9B7] text-[10px] font-bold text-white">{c.unreadCount}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {!conversations.isLoading && !convRows.length && <p className="py-6 text-center text-xs text-slate-400">{connected ? "Tiada perbualan dalam skop cawangan anda." : "Sambungkan channel WhatsApp dahulu."}</p>}
              </div>
              <div className="flex min-h-[420px] flex-col md:col-span-2">
                {activeConv ? (
                  <ChatPane key={activeConv.id} conv={activeConv} templates={tmplRows} onResolved={() => setActiveId(null)} />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[#F4F7FA] p-6 text-center">
                    <MessagesSquare className="h-8 w-8 text-slate-300" />
                    <p className="text-sm text-slate-400">Pilih satu perbualan untuk balas.</p>
                  </div>
                )}
              </div>
              <div className="hidden overflow-y-auto border-l border-gray-100 p-4 lg:block">
                {activeConv ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Maklumat kenalan</p>
                    <div className="flex items-center gap-2 text-sm text-slate-700"><Phone className="h-4 w-4 text-teal-600" />{activeConv.contactPhone}</div>
                    <div className="flex items-center gap-2 text-sm text-slate-700"><User className="h-4 w-4 text-teal-600" />{activeConv.patientId ? "Pesakit berkait" : "Tiada pesakit berkait"}</div>
                    <div><StatusBadge status={activeConv.status} className="rounded-full px-3 py-1 text-xs font-medium bg-teal-50 text-teal-700 ring-1 ring-teal-200" /></div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Maklumat kenalan akan dipaparkan di sini.</p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button size="sm" className="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white hover:from-teal-600 hover:to-cyan-600 shadow-lg shadow-teal-200/50" onClick={() => setShowChannel(true)}><Plus className="h-4 w-4 mr-1.5" />Register Channel</Button>
          </div>
          <Panel className="glass-card bg-white/80 backdrop-blur-xl border border-white/40 shadow-xl rounded-2xl p-5">
            {channels.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {chanRows.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{c.phone}</p>
                    <p className="text-xs text-slate-400">{c.sessionName ?? "-"} - health {c.healthScore}/100</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} className="rounded-full px-3 py-1 text-xs font-medium bg-teal-50 text-teal-700 ring-1 ring-teal-200" />
                    {(channelFlow[c.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-teal-200 text-teal-700 hover:bg-teal-50" disabled={channelStatus.isPending} onClick={() => channelStatus.mutate({ id: c.id, status: next })}>{next.replace(/_/g, " ")}</Button>
                    ))}
                  </div>
                </div>
              ))}
              {!channels.isLoading && !chanRows.length && (
                <EmptyState title="Tiada channel WhatsApp" description="Daftar satu channel untuk mula. Gateway WAHA luaran mengendalikan pasangan QR dan penghantaran mesej." />
              )}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" className="rounded-full border-white/40 bg-white/70 backdrop-blur-xl shadow-md text-teal-700 hover:bg-white/90" onClick={() => setShowTemplate(true)}><LayoutTemplate className="h-4 w-4 mr-1.5" />New Template</Button>
          </div>
          <Panel className="glass-card bg-white/80 backdrop-blur-xl border border-white/40 shadow-xl rounded-2xl p-5">
            {templates.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {tmplRows.map((t) => (
                <div key={t.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                    <StatusBadge status={t.active ? "active" : "inactive"} className="rounded-full px-3 py-1 text-xs font-medium bg-teal-50 text-teal-700 ring-1 ring-teal-200" />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{t.body}</p>
                </div>
              ))}
              {!templates.isLoading && !tmplRows.length && <EmptyState title="Tiada template" description="Cipta template balasan pantas untuk soalan pesakit biasa." />}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="safety" className="mt-4">
          <Panel className="glass-card bg-white/80 backdrop-blur-xl border border-white/40 shadow-xl rounded-2xl p-5">
            {safety.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-slate-100">
              {(safety.data ?? []).map((s) => (
                <div key={s.id} className="py-3">
                  <p className="text-sm font-semibold text-slate-800">{s.decision ?? "Keputusan keselamatan"}</p>
                  <p className="text-xs text-slate-400">{fmtDateTime(s.createdAt)}{s.reason ? ` - ${s.reason}` : ""}</p>
                </div>
              ))}
              {!safety.isLoading && !(safety.data ?? []).length && <EmptyState title="Tiada keputusan keselamatan" description="Penilaian safety-gate AI akan diaudit di sini." />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
      <NewChannelDialog open={showChannel} onClose={() => setShowChannel(false)} />
      <NewTemplateDialog open={showTemplate} onClose={() => setShowTemplate(false)} />
    </div>
  );
}
