import { usePrefs } from "@/hooks/usePrefs";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useBranch } from "@/hooks/useBranch";
import { useAuth } from "@/hooks/useAuth";
import { Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime } from "@/lib/format";
import { Radio, MessagesSquare, LayoutTemplate, LayoutDashboard, Plus, User, Phone, QrCode, Zap } from "lucide-react";
import { WhatsAppDashboard } from "@/components/whatsapp/WhatsAppDashboard";
import { ConversationActions } from "@/components/whatsapp/ConversationActions";
import { ChatPane } from "@/components/whatsapp/ChatPane";
import { toast } from "sonner";

interface Channel { id: string; phone: string; sessionName?: string; status: string; healthScore: number; aiReplyEnabled?: boolean; sentTodayCount?: number; lastSeenAt?: string; isPrimary?: boolean; branchId?: string }
interface Conversation { id: string; contactPhone: string; status: string; unreadCount: number; lastMessageAt?: string; patientId?: string; needsHuman?: boolean; needsHumanReason?: string; assignedTo?: string | null; aiQueueState?: string | null; slaWaitMinutes?: number | null }

interface Template { id: string; name: string; body: string; category?: string; active: boolean }

interface EditTemplateForm { id: string; name: string; body: string; category: string }

const channelFlow: Record<string, string[]> = {
  stopped: ["starting"], starting: ["working", "failed"], working: ["stopped"],
  failed: ["starting"], need_qr: ["working", "stopped"],
};

function initials(phone: string) {
  const d = (phone || "").replace(/[^0-9]/g, "");
  return d.length >= 2 ? d.slice(-2) : (phone || "?").slice(0, 2).toUpperCase();
}

function NewChannelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ phone: "+601****5247", session: "setia-tropika" });
  /* HQ pada "All Branches" (branchId null) tidak boleh register: backend
     menolak branchId null dgn 422. Dialog ini kini memaksa pilihan cawangan
     dahulu — pilihan tersimpan sbg konteks cawangan supaya QR selepas itu
     juga berada pada cawangan yang betul. */
  const isHq = user?.role === "hq";
  const branches = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Array<{ id: string; shortName?: string; fullName?: string; name?: string }>>("/admin/branches"),
    enabled: open && isHq,
  });
  const [dialogBranch, setDialogBranch] = useState<string>("");
  const effectiveBranch = isHq ? dialogBranch || branchId : branchId;
  const create = useMutation({
    mutationFn: () => api.post<Channel>("/whatsapp/channels", { branchId: effectiveBranch, phone: form.phone, sessionName: form.session || null }),
    onSuccess: () => { toast.success(t("msg.chanRegistered")); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); setForm({ phone: "+601****5247", session: "setia-tropika" }); setDialogBranch(""); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.registerFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">{t("wa.registerChannel")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("wa.registerChannelHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (effectiveBranch) create.mutate(); }}>
          {isHq && (
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("wa.branchRequired")} *</Label>
              <Select required value={dialogBranch || (branchId ?? "")} onValueChange={setDialogBranch}>
                <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5">
                  <SelectValue placeholder={t("wa.pickBranchHint")} />
                </SelectTrigger>
                <SelectContent>
                  {(branches.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.shortName || b.fullName || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.phoneRequiredShort")} *</Label>
            <Input required minLength={6} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6012-345 6789" className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.sessionName")}</Label>
            <Input value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} placeholder={t("wa.sessionNameHint")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending || !effectiveBranch}>{create.isPending ? t("wa.registering") : t("wa.register")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", body: "", category: "" });
  const create = useMutation({
    mutationFn: () => api.post<Template>("/whatsapp/templates", { branchId, name: form.name, body: form.body, category: form.category || null }),
    onSuccess: () => { toast.success(t("wa.templateSaved")); qc.invalidateQueries({ queryKey: ["whatsapp"] }); onClose(); setForm({ name: "", body: "", category: "" }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.templateSaveFailed"))),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("wa.newTemplate")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("wa.templateHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.nameRequired")} *</Label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.bodyRequired")} *</Label>
            <Textarea required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} className="rounded-xl border-border bg-card p-3" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.category")}</Label>
            {/* #4: dua nada tetap sbg pilihan satu-klik; kategori lain boleh ditaip. */}
            <div className="mb-1.5 flex gap-1.5">
              {(["casual", "professional"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, category: form.category === c ? "" : c })}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
                    form.category === c
                      ? "bg-primary text-primary-foreground ring-primary"
                      : "bg-card text-foreground ring-border hover:bg-accent"
                  }`}
                >
                  {c === "casual" ? t("wa.tplCasual") : t("wa.tplProfessional")}
                </button>
              ))}
            </div>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("wa.templateTags")} className="rounded-xl border-border bg-card px-4 py-2.5" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={create.isPending}>{create.isPending ? t("wa.saving") : t("wa.saveTemplate")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WhatsAppHub() {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const [queueFilter, setQueueFilter] = useState<"all" | "needs_human" | "unanswered" | "ai">("all");
  const channels = useQuery({ queryKey: ["whatsapp", "channels"], queryFn: () => api.get<Channel[]>("/whatsapp/channels") });
  /* Queue query is filter-driven: the dashboard tabs and the inbox share one
   * request, so switching a KPI card re-queries rather than filtering client-side
   * (the server already enforces branch scope and escalation rules). */
  const conversations = useQuery({
    queryKey: ["whatsapp", "conversations", queueFilter],
    queryFn: () => api.get<Conversation[]>(`/whatsapp/conversation-queue?filter=${queueFilter}&limit=50`),
  });
  const templates = useQuery({ queryKey: ["whatsapp", "templates"], queryFn: () => api.get<Template[]>("/whatsapp/templates") });
  const [showChannel, setShowChannel] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<EditTemplateForm | null>(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvMessage, setNewConvMessage] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hubTab, setHubTab] = useState("dashboard");
  const [qrChannel, setQrChannel] = useState<Channel | null>(null);
  const [qrImage, setQrImage] = useState("");
  const deleteChannel = useMutation({
    mutationFn: (id: string) => api.del(`/whatsapp/channels/${id}`),
    onSuccess: () => { toast.success(t("msg.chanDeleted")); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.deleteChannelFailed"))),
  });
  const channelStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/whatsapp/channels/${id}/status`, { status }),
    onSuccess: () => { toast.success(t("msg.chanUpdated")); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.updateFailed"))),
  });
  const generateQr = useMutation({
    mutationFn: (id: string) =>
      api.get<{ qr: string; expiresAt?: string | null; session?: string }>(`/whatsapp/channels/${id}/qr`),
    onSuccess: (data, id) => {
      setQrChannel(chanRows.find((c) => c.id === id) ?? null);
      setQrImage(data.qr);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.qrFailed"))),
  });

  /* 0029 — make this channel the branch's LIVE number. The backend demotes
   * the branch's other channels in the same transaction; routing changes on
   * the very next message (resolver cache invalidated server-side). */
  const switchPrimary = useMutation({
    mutationFn: (id: string) => api.patch(`/whatsapp/channels/${id}/primary`, {}),
    onSuccess: () => {
      toast.success(t("wa.primarySwitched"));
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.primarySwitchFailed"))),
  });
  const updateTemplate = useMutation({
    mutationFn: (form: EditTemplateForm) =>
      api.patch<Template>(`/whatsapp/templates/${form.id}`, {
        name: form.name,
        body: form.body,
        category: form.category || null,
      }),
    onSuccess: () => {
      toast.success(t("msg.tplUpdated"));
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
      setEditTemplate(null);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("wa.templateSaveFailed"))),
  });
  const createConversation = useMutation({
    mutationFn: () =>
      api.post<Conversation>("/whatsapp/conversations", {
        channelId: chanRows.find((c) => c.status === "working")?.id ?? chanRows[0]?.id,
        contactPhone: newConvPhone,
        linkPatient: true,
      }),
    onSuccess: (conv) => {
      toast.success(t("msg.convStarted"));
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
      setShowNewConv(false);
      setNewConvPhone("");
      setNewConvMessage("");
      setActiveId(conv.id);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.convFailed"))),
  });
  const chanRows = channels.data ?? [];
  const convRows = conversations.data ?? [];
  const tmplRows = templates.data ?? [];
  const connected = chanRows.some((c) => c.status === "working");
  const activeConv = convRows.find((c) => c.id === activeId) ?? null;

  /* ------------------------------------------------------------------
   * QR pairing UX: keep the code fresh and close the dialog automatically.
   *  - WAHA/WhatsApp rotates the QR ~every 20-30s, so we re-request the code
   *    on a timer while the dialog is open. The user always sees a scannable
   *    code instead of a dead one.
   *  - We poll channel status; the moment the session reports "working" we
   *    close the dialog and confirm — no manual refresh needed.
   * ----------------------------------------------------------------*/
  const [qrRefreshing, setQrRefreshing] = useState(false);
  useEffect(() => {
    if (!qrChannel) return;
    let cancelled = false;
    const REFRESH_MS = 25_000;   /* re-fetch ahead of WhatsApp's rotation */
    const refresh = async () => {
      if (cancelled) return;
      setQrRefreshing(true);
      try {
        const data = await api.get<{ qr: string }>(`/whatsapp/channels/${qrChannel.id}/qr`);
        if (!cancelled && data.qr) setQrImage(data.qr);
      } catch {
        /* transient WAHA/network hiccup — keep the previous code on screen */
      } finally {
        if (!cancelled) setQrRefreshing(false);
      }
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [qrChannel]);

  /* TIADA NOMOR AKTIF → arahkan pengguna ke tab Number (bos #2 / rancangan
   * poin 3). Dashboard tanpa nomor bekerja ialah halaman kosong yang
   * membingungkan; tab Number ialah tempat satu-satunya tindakan bermakna
   * (daftar/QR/aktifkan). Berlaku SEKALI sahaja semasa muat senarai — bila
   * pengguna sudah menekan tab lain secara manual, hormati pilihan itu. */
  const [steeredOnce, setSteeredOnce] = useState(false);
  useEffect(() => {
    if (steeredOnce || channels.isLoading || !channels.data) return;
    const hasLive = (channels.data ?? []).some((c) => c.status === "working" || c.status === "connected");
    if (!hasLive) {
      setSteeredOnce(true);
      setHubTab("channels");
    }
  }, [steeredOnce, channels.isLoading, channels.data]);

  /* Poll channel status while the QR dialog is open; auto-close when paired. */
  useEffect(() => {
    if (!qrChannel) return;
    const POLL_MS = 3_000;
    const timer = window.setInterval(async () => {
      try {
        const rows = await api.get<Channel[]>("/whatsapp/channels");
        const mine = rows.find((c) => c.id === qrChannel.id);
        if (mine && mine.status === "working") {
          qc.invalidateQueries({ queryKey: ["whatsapp"] });
          toast.success(t("msg.waConnected"));
          setQrChannel(null);
          setQrImage("");
        }
      } catch {
        /* keep polling silently */
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [qrChannel, qc, t]);

  return (
    <div className="space-y-5">
      {/* #3 (pemilik 10 Okt): header Hub diseragamkan dgn WhatsApp Campaign -
          h2 text-xl extrabold + deskripsi, pill status kekal (maklumat sebenar:
          ada/tiada nombor aktif). Font display 'Outfit' 24px dibuang kerana
          Campaign dan halaman lain tidak memakainya - konsistensi mengatasi
          saiz besar. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-foreground">{t("wa.hubTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("wa.manageHint")}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${connected ? "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground ring-border"}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
          {connected ? t("wa.connected") : t("wa.noConnection")}
        </span>
      </div>
      <Tabs defaultValue="dashboard" value={hubTab} onValueChange={(v) => setHubTab(v)}>
        <TabsList className="bg-card border border-border rounded-lg p-1 shadow-md flex flex-wrap gap-1">
          <TabsTrigger value="dashboard" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />{t("wa.tabDashboard")}</TabsTrigger>
          <TabsTrigger value="conversations" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><MessagesSquare className="h-3.5 w-3.5 mr-1.5" />{t("wa.tabConversations")}</TabsTrigger>
          <TabsTrigger value="channels" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><Radio className="h-3.5 w-3.5 mr-1.5" />{t("wa.tabChannels")}</TabsTrigger>
          <TabsTrigger value="templates" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />{t("wa.tabTemplates")}</TabsTrigger>
        </TabsList>

        {/* Dashboard, paparan utama: status, toggle AI, KPI, tindakan */}
        <TabsContent value="dashboard" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("wa.tabDashDesc")}</p>
          <WhatsAppDashboard
            channels={chanRows}
            conversations={convRows}
            loadingChannels={channels.isLoading}
            loadingConversations={conversations.isLoading}
            onShowQr={(id) => generateQr.mutate(id)}
            onRegisterNumber={() => setShowChannel(true)}
            onGoToQueue={(filter) => {
              setQueueFilter(filter);
              setHubTab("conversations");
            }}
          />
        </TabsContent>
        <TabsContent value="conversations" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("wa.tabConvDesc")}</p>
          <div className="mb-3 flex justify-end">
            <Button size="sm" className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowNewConv(true)}>
              <Plus className="h-4 w-4 mr-1.5" />{t("wa.newConversation")}</Button>
          </div>
          <div className="glass-card overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="grid h-[560px] grid-cols-1 md:grid-cols-3 lg:grid-cols-4">
              <div className="overflow-y-auto border-r border-border">
                {conversations.isLoading && <div className="p-4"><Skeleton className="h-40 w-full" /></div>}
                {convRows.map((c) => {
                  const active = c.id === activeId;
                  return (
                    <button key={c.id} onClick={() => setActiveId(c.id)} className={`flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-accent/40 ${active ? "bg-accent/60 border-l-2 border-l-primary" : ""}`}>
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{initials(c.contactPhone)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[13px] font-bold text-foreground">{c.contactPhone}</p>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{c.lastMessageAt ? fmtDateTime(c.lastMessageAt) : ""}</span>
                          {c.slaWaitMinutes != null && c.slaWaitMinutes > 0 && (
                            <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-200">
                              {c.slaWaitMinutes < 60 ? `${c.slaWaitMinutes}m` : `${Math.floor(c.slaWaitMinutes / 60)}j`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[11.5px] text-muted-foreground">{c.status}</p>
                          {c.unreadCount > 0 && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{c.unreadCount}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {!conversations.isLoading && !convRows.length && <p className="py-6 text-center text-xs text-muted-foreground">{connected ? t("wa.noConv") : t("wa.connectFirst")}</p>}
              </div>
              <div className="flex min-h-[420px] flex-col md:col-span-2">
                {activeConv ? (
                  <ChatPane
                    key={activeConv.id}
                    convId={activeConv.id}
                    contactPhone={activeConv.contactPhone}
                    templates={tmplRows}
                    actions={<ConversationActions conv={activeConv} branchId={branchId} onClosed={() => setActiveId(null)} />}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[#F4F7FA] p-6 text-center">
                    <MessagesSquare className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t("wa.pickConversation")}</p>
                  </div>
                )}
              </div>
              <div className="hidden overflow-y-auto border-l border-border p-4 lg:block">
                {activeConv ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("wa.contactInfo")}</p>
                    <div className="flex items-center gap-2 text-sm text-foreground"><Phone className="h-4 w-4 text-foreground" />{activeConv.contactPhone}</div>
                    <div className="flex items-center gap-2 text-sm text-foreground"><User className="h-4 w-4 text-foreground" />{activeConv.patientId ? t("wa.patientLinked") : t("wa.patientNotLinked")}</div>
                    <div><StatusBadge status={activeConv.status} className="rounded-full px-3 py-1 text-xs font-medium" /></div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("wa.contactInfoEmpty")}</p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("wa.tabChanDesc")}</p>
          <div className="mb-3 flex justify-end">
            <Button size="sm" className="btn-brand" onClick={() => setShowChannel(true)}><Plus className="h-4 w-4 mr-1.5" />{t("wa.registerChannel")}</Button>
          </div>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {channels.isLoading && <Skeleton className="h-40 w-full" />}
            <div className="divide-y divide-border">
              {chanRows.map((c) => {
                /* Baris bermasalah (failed / need_qr / stopped) diberi latar
                 * lembut supaya MATA terus jatuh ke saluran yang perlukan
                 * tindakan — arahan pemilik: "yg dihighlight ya yg stopped". */
                const attention = c.status === "failed" || c.status === "need_qr" || c.status === "stopped";
                return (
                <div key={c.id} className={`py-3 flex items-center justify-between gap-3 rounded-lg px-2 -mx-2 ${attention ? "bg-amber-50/70 ring-1 ring-amber-200/70 dark:bg-amber-950/30 dark:ring-amber-900" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {c.phone}
                      {c.isPrimary && (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          {t("wa.primaryBadge")}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.sessionName ?? "-"} - health {c.healthScore}/100</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} statusText={t(`wa.st.${c.status}`)} className="rounded-full px-3 py-1 text-xs font-medium" />
                    <Button size="sm" variant="outline" className="rounded-xl border-red-200 text-red-600 hover:bg-red-50" disabled={deleteChannel.isPending} onClick={() => { if (window.confirm(t("msg.deleteChannelConfirm", { n: c.phone }))) deleteChannel.mutate(c.id); }}>Delete</Button>                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-border text-foreground hover:bg-accent"
                      onClick={() => generateQr.mutate(c.id)}
                      disabled={generateQr.isPending}
                    >
                      <QrCode className="mr-1 h-4 w-4" />{t("wa.qr")}</Button>
                    {!c.isPrimary && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        disabled={switchPrimary.isPending}
                        onClick={() => switchPrimary.mutate(c.id)}
                        title={t("wa.primarySwitchHint")}
                      >
                        <Zap className="mr-1 h-4 w-4" />{t("wa.makePrimary")}
                      </Button>
                    )}
                    {(channelFlow[c.status] ?? []).map((next) => (
                      <Button key={next} size="sm" variant="outline" className="text-xs rounded-xl border-border text-foreground hover:bg-accent" disabled={channelStatus.isPending} onClick={() => channelStatus.mutate({ id: c.id, status: next })}>{t(`wa.flow.${next}`)}</Button>
                    ))}
                  </div>
                </div>
                );
              })}
              {!channels.isLoading && !chanRows.length && (
                <EmptyState title={t("wa.noChannel")} description={t("wa.noChannelDesc")} />
              )}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("wa.tabTplDesc")}</p>
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" className="rounded-full border-border bg-card shadow-md text-foreground hover:bg-card" onClick={() => setShowTemplate(true)}><LayoutTemplate className="h-4 w-4 mr-1.5" />{t("wa.newTemplate")}</Button>
          </div>
          <Panel className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
            {templates.isLoading && <Skeleton className="h-40 w-full" />}
            {/* #4 (pemilik 10 Okt): dua seksi mengikut nada mesej. Kategori
                bebas kekal (template tanpa kategori masuk "Lain-lain"),
                supaya data lama tidak hilang. */}
            {(["casual", "professional", ""] as const).map((cat) => {
              const rows = tmplRows.filter((tpl) => (tpl.category ?? "") === cat);
              const tajuk = cat === "casual" ? t("wa.tplCasual") : cat === "professional" ? t("wa.tplProfessional") : t("wa.tplOther");
              if (!rows.length) return null;
              return (
                <div key={cat || "other"} className="mb-5 last:mb-0">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{tajuk}</p>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {rows.map((tpl) => (
                      <div key={tpl.id} className="py-3 px-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-foreground">{tpl.name}</p>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={tpl.active ? "active" : "inactive"} className="rounded-full px-3 py-1 text-xs font-medium" />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-full border-border px-2.5 text-[11px] text-foreground hover:bg-accent"
                              onClick={() => setEditTemplate({ id: tpl.id, name: tpl.name, body: tpl.body, category: tpl.category ?? "" })}
                            >{t("wa.edit")}</Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!templates.isLoading && !tmplRows.length && <EmptyState title={t("wa.noTemplate")} description={t("wa.noTemplateDesc")} />}
          </Panel>
        </TabsContent>
        
      </Tabs>

      {/* New conversation dialog */}
      <Dialog open={showNewConv} onOpenChange={setShowNewConv}>
        <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("wa.newConversation")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">{t("wa.newConversationHint")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createConversation.mutate(); }}>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("wa.phoneRequired")}</Label>
              <Input required value={newConvPhone} onChange={(e) => setNewConvPhone(e.target.value)} placeholder="+6012-345 6789" className="rounded-xl border-border bg-card px-4 py-2.5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">{t("wa.firstMessageRequired")}</Label>
              <Textarea required value={newConvMessage} onChange={(e) => setNewConvMessage(e.target.value)} rows={3} placeholder={t("wa.templateBodyHint")} className="rounded-xl border-border bg-card p-3" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowNewConv(false)} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
              <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={createConversation.isPending}>{createConversation.isPending ? t("common.loading") : t("msg.sendCta")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit template dialog */}
      <Dialog open={Boolean(editTemplate)} onOpenChange={(open) => { if (!open) setEditTemplate(null); }}>
        <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold bg-primary bg-clip-text text-transparent">{t("wa.editTemplate")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">{t("wa.editTemplateHint")}</DialogDescription>
          </DialogHeader>
          {editTemplate && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); updateTemplate.mutate(editTemplate); }}>
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">{t("wa.nameRequired")} *</Label>
                <Input required value={editTemplate.name} onChange={(e) => setEditTemplate({ ...editTemplate, name: e.target.value })} className="rounded-xl border-border bg-card px-4 py-2.5" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">{t("wa.bodyRequired")} *</Label>
                <Textarea required value={editTemplate.body} onChange={(e) => setEditTemplate({ ...editTemplate, body: e.target.value })} rows={4} className="rounded-xl border-border bg-card p-3" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">{t("wa.category")}</Label>
                <Input value={editTemplate.category} onChange={(e) => setEditTemplate({ ...editTemplate, category: e.target.value })} placeholder={t("wa.templateTags")} className="rounded-xl border-border bg-card px-4 py-2.5" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditTemplate(null)} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
                <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={updateTemplate.isPending}>{updateTemplate.isPending ? t("wa.saving") : t("wa.saveTemplate")}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(qrChannel)} onOpenChange={(open) => { if (!open) { setQrChannel(null); setQrImage(""); } }}>
        <DialogContent className="rounded-lg bg-card text-center">
          <DialogHeader>
            <DialogTitle>{t("wa.connect")}</DialogTitle>
            <DialogDescription>
              {t("wa.qrSteps")}</DialogDescription>
          </DialogHeader>
          {qrImage ? (
            <div className="relative">
              <img
                src={qrImage.startsWith("data:") ? qrImage : `data:image/png;base64,${qrImage}`}
                alt="WhatsApp QR Code"
                className="mx-auto h-72 w-72 rounded-xl border border-border p-2"
              />
              {qrRefreshing && (
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-[10px] font-medium text-white">{t("wa.updatingCode")}</span>
              )}
            </div>
          ) : (
            <p className="py-12 text-sm text-muted-foreground">{t("wa.preparingQR")}</p>
          )}
          <p className="text-xs text-muted-foreground">{qrChannel?.phone}</p>
          <p className="text-xs text-muted-foreground">{t("wa.qrAutoRefresh")}</p>
        </DialogContent>
      </Dialog>
      <NewChannelDialog open={showChannel} onClose={() => setShowChannel(false)} />
      <NewTemplateDialog open={showTemplate} onClose={() => setShowTemplate(false)} />
    </div>
  );
}