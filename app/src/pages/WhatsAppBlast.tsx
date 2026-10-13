import { usePrefs } from "@/hooks/usePrefs";
import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Brain,
  CalendarDays,
  Megaphone,
  Radio,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { BackLink } from "@/components/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CampaignHqBoard from "@/components/whatsapp/CampaignHqBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import RecipientPicker, {
  type RecipientSelection,
} from "@/components/whatsapp/RecipientPicker";

interface Channel {
  id: string;
  phone: string;
  status: string;
  healthScore: number;
  sentTodayCount?: number;
  autoPausedAt?: string | null;
}

interface BlastResult {
  ok: boolean;
  batchId: string;
  queued: number;
  dailyLimit: number;
  usedBefore: number;
  remaining: number;
}

interface ScrubbingCandidate {
  patientId: string;
  mrn: string;
  name: string;
  contactPhone: string;
  lastVisitDate: string;
  daysSinceLastVisit: number;
  monthsSinceLastVisit: number;
  lastTreatment: string;
  suggestedReason: string;
}

interface ScrubbingMessageDraft {
  patientId: string;
  name: string;
  contactPhone: string;
  lastVisitDate: string;
  monthsSinceLastVisit: number;
  lastTreatment: string;
  suggestedReason: string;
  message: string;
  source: "ai" | "fallback";
}

type Mode = "scrubbing" | "marketing";


/* ============================================================================
 * HqComposeDialog — #2 (pemilik 10 Okt): HQ menghantar blast ATAS NAMA
 * satu cawangan. Corak sama seperti clinical on-behalf-of: HQ memilih
 * cawangan; blast direkod di bawah cawangan itu (jejak audit kekal nama HQ).
 * Form ini sengaja ringkas: nombor terus (paste) + mesej + persetujuan.
 * ========================================================================== */
function HqComposeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [numbers, setNumbers] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);

  const branches = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Array<{ id: string; shortName?: string; fullName?: string }>>("/admin/branches"),
    enabled: open,
  });
  const channels = useQuery({
    queryKey: ["whatsapp-campaign", "channels", branchId],
    queryFn: () => api.get<Channel[]>("/whatsapp/channels?limit=100"),
    enabled: open,
  });
  /* Saluran cawangan terpilih sahaja, dan hanya yang sihat. */
  const branchChannels = (channels.data ?? []).filter((c) => !branchId || (c as Channel & { branchId?: string }).branchId === branchId);
  const [channelId, setChannelId] = useState("");
  const liveChannel = branchChannels.find((c) => c.id === channelId && c.status === "working");
  const usable = Boolean(branchId && liveChannel && message.trim() && consent && numbers.trim());

  const blast = useMutation({
    mutationFn: () =>
      api.post<BlastResult>("/whatsapp/blast", {
        branchId,
        channelId: liveChannel!.id,
        recipients: numbers.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean),
        body: message,
        consentConfirmed: true,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["whatsapp-campaign"] });
      toast.success(`${result.queued} mesej dimasukkan ke queue`);
      onClose();
      setNumbers(""); setMessage(""); setConsent(false);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("blast.failed"))),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card border-0 bg-card shadow-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">{t("blast.hqSendOnBehalf")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("blast.hqOnBehalfHint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (usable) blast.mutate(); }}>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.branchRequired")} *</Label>
            <Select value={branchId} onValueChange={(v) => { setBranchId(v); setChannelId(""); }}>
              <SelectTrigger className="rounded-xl border-border bg-card px-4 py-2.5"><SelectValue placeholder={t("wa.pickBranchHint")} /></SelectTrigger>
              <SelectContent>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.shortName || b.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {branchId && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {branchChannels.some((c) => c.status === "working")
                ? t("blast.hqChannelReady")
                : t("blast.hqNoChannel")}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("blast.numbersLabel")} *</Label>
            <Textarea rows={3} value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder={"60123456789, 60198765432..."} className="rounded-xl border-border bg-card p-3 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground font-medium">{t("wa.templateBody")} *</Label>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("blast.messageHint")} className="rounded-xl border-border bg-card p-3" />
          </div>
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            {t("blast.consentText")}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border text-foreground hover:bg-muted">{t("common.cancel")}</Button>
            <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!usable || blast.isPending}>
              {blast.isPending ? t("blast.sending") : t("blast.sendCta")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WhatsAppBlast() {
  const { t } = usePrefs();
  const { user, branch } = useAuth();
  const qc = useQueryClient();

  const [mode, setMode] =
    useState<Mode>("scrubbing");

  /* #2: dialog blast atas nama cawangan (HQ sahaja). */
  const [hqCompose, setHqCompose] =
    useState(false);

  const [months, setMonths] =
    useState(6);

  const [selected, setSelected] =
    useState<string[]>([]);

  const [channelId, setChannelId] =
    useState("");

  /* Destination for the {link} tag, filled by the picker — it owns the input so
   * its preview can show the address the patient will actually receive. A second
   * field here would be a duplicate the operator could fill without effect. */
  const [bookingUrl, setBookingUrl] = useState("");

  const [numbers, setNumbers] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [consent, setConsent] =
    useState(false);

  const [lastResult, setLastResult] =
    useState<BlastResult | null>(null);

  const [drafts, setDrafts] =
    useState<ScrubbingMessageDraft[]>([]);

  const [followupConsent, setFollowupConsent] =
    useState(false);

  const [scheduledAt, setScheduledAt] =
    useState("");

  const channelsQuery = useQuery({
    queryKey: ["whatsapp-campaign", "channels"],
    queryFn: () =>
      api.get<Channel[]>(
        "/whatsapp/channels?limit=100",
      ),
  });

  const channels =
    useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);

  const defaultChannelId = channels.find(
    (channel) => channel.status === "working",
  )?.id ?? "";
  const effectiveChannelId = channelId || defaultChannelId;

  const scrubbingQuery = useQuery({
    queryKey: [
      "whatsapp-campaign",
      "scrubbing",
      months,
    ],
    queryFn: () =>
      api.get<ScrubbingCandidate[]>(
        `/marketing/scrubbing-candidates?months=${months}&limit=100`,
      ),
    enabled: mode === "scrubbing",
  });

  const candidates =
    scrubbingQuery.data ?? [];

  const selectedSet =
    useMemo(
      () => new Set(selected),
      [selected],
    );

  const recipients = useMemo(() => {
    const rows = numbers
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    return [...new Set(rows)];
  }, [numbers]);

  /* The picker scopes its query to one branch. `user.branchId` is the operator's
   * own branch; the blast endpoint also enforces this, so the UI cannot widen it. */
  const channelBranchId = (user?.branchId ?? "") as string;

  /* Branch name for the message body (t("blast.branchLabel")). Taken from
   * the session rather than the channel row, because the channel payload does
   * not carry a branch label. */
  const branchLabel = branch?.name ?? "anda";

  const selectedChannel =
    channels.find(
      (channel) =>
        channel.id === effectiveChannelId,
    );

  const remaining =
    lastResult?.remaining ??
    Math.max(
      0,
      50 -
        (selectedChannel?.sentTodayCount ?? 0),
    );

  const blast = useMutation({
    mutationFn: () =>
      api.post<BlastResult>(
        "/whatsapp/blast",
        {
          branchId: user?.branchId,
          channelId: effectiveChannelId,
          recipients,
          body: message,
          consentConfirmed: consent,
          bookingUrl: bookingUrl.trim() || undefined,
          scheduledAt: scheduledAt || undefined,
        },
      ),

    onSuccess: (result) => {
      setLastResult(result);
      setNumbers("");

      qc.invalidateQueries({
        queryKey: [
          "whatsapp-campaign",
          "channels",
        ],
      });

      toast.success(
        `${result.queued} mesej dimasukkan ke queue`,
      );
    },

    onError: (error) => {
      toast.error(
        errorMessage(
          error,
          t("blast.failed"),
        ),
      );
    },
  });

  const generateDrafts = useMutation({
    mutationFn: () =>
      api.post<ScrubbingMessageDraft[]>(
        "/marketing/scrubbing-message-drafts",
        {
          branchId: user?.branchId,
          patientIds: selected,
        },
      ),

    onSuccess: (rows) => {
      setDrafts(rows);
      setFollowupConsent(false);

      if (!rows.length) {
        toast.error(
          t("wa.noFollowUp"),
        );
        return;
      }

      const aiCount = rows.filter(
        (row) => row.source === "ai",
      ).length;

      toast.success(
        aiCount > 0
          ? `${rows.length} mesej follow-up dijana untuk semakan`
          : `${rows.length} mesej fallback dijana untuk semakan`,
      );
    },

    onError: (error) => {
      toast.error(
        errorMessage(
          error,
          t("wa.followUpFailed"),
        ),
      );
    },
  });

  const sendFollowups = useMutation({
    mutationFn: async () => {
      let last: BlastResult | null = null;
      let queued = 0;

      for (const draft of drafts) {
        const result =
          await api.post<BlastResult>(
            "/whatsapp/blast",
            {
              branchId: user?.branchId,
              channelId: effectiveChannelId,
              recipients: [
                draft.contactPhone,
              ],
              body: draft.message.trim(),
              consentConfirmed:
                followupConsent,
            },
          );

        queued += result.queued;
        last = result;
      }

      return {
        queued,
        last,
      };
    },

    onSuccess: ({ queued, last }) => {
      if (last) {
        setLastResult(last);
      }

      setDrafts([]);
      setSelected([]);
      setFollowupConsent(false);

      qc.invalidateQueries({
        queryKey: [
          "whatsapp-campaign",
          "channels",
        ],
      });

      qc.invalidateQueries({
        queryKey: [
          "whatsapp-campaign",
          "scrubbing",
        ],
      });

      toast.success(
        `${queued} mesej follow-up dimasukkan ke WhatsApp queue`,
      );
    },

    onError: (error) => {
      toast.error(
        errorMessage(
          error,
          t("blast.followupStopped"),
        ),
      );
    },
  });

  const updateDraftMessage = (
    patientId: string,
    value: string,
  ) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.patientId === patientId
          ? {
              ...draft,
              message: value.slice(
                0,
                4096,
              ),
            }
          : draft,
      ),
    );
  };

  const togglePatient = (
    patientId: string,
  ) => {
    if (
      !selectedSet.has(patientId) &&
      selected.length >= 50
    ) {
      toast.error(
        t("blast.maxRecipients"),
      );
      return;
    }

    setDrafts([]);
    setFollowupConsent(false);

    setSelected((current) =>
      current.includes(patientId)
        ? current.filter(
            (id) => id !== patientId,
          )
        : [...current, patientId],
    );
  };

  const selectAll = () => {
    const selectable =
      candidates
        .slice(0, 50)
        .map(
          (candidate) =>
            candidate.patientId,
        );

    const allSelected =
      selectable.length > 0 &&
      selectable.every((id) =>
        selectedSet.has(id),
      );

    setDrafts([]);
    setFollowupConsent(false);

    if (allSelected) {
      setSelected([]);
      return;
    }

    setSelected(selectable);

    if (candidates.length > 50) {
      toast.info(
        "50 pesakit pertama sahaja dipilih kerana had penghantaran harian.",
      );
    }
  };

  const followupSendInvalid =
    !effectiveChannelId ||
    drafts.length < 1 ||
    drafts.length > 50 ||
    drafts.some(
      (draft) =>
        !draft.message.trim(),
    ) ||
    !followupConsent ||
    selectedChannel?.status !==
      "working";

  const blastInvalid =
    !effectiveChannelId ||
    recipients.length < 1 ||
    recipients.length > 50 ||
    !message.trim() ||
    !consent ||
    selectedChannel?.status !==
      "working";

  if (user?.role === "hq") {
    /* HQ (#2 pemilik 10 Okt: "HQ Pastikan serba bisa"): board penuh SEMUA
     * cawangan seperti dahulu, DAN butang untuk menghantar blast ATAS NAMA
     * satu cawangan. Tanpa butang ini HQ hanya boleh melihat — sekarang ia
     * boleh bertindak, seperti corak klinikal atas-nama-doktor. */
    return (
      <div className="space-y-6">
        <div className="mb-2">
          <BackLink to="/whatsapp" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-foreground">{t("blast.pageTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("blast.hqBoardDesc")}</p>
          </div>
          <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setHqCompose(true)}>
            <Megaphone className="h-4 w-4 mr-1.5" />{t("blast.hqSendOnBehalf")}
          </Button>
        </div>
        <HqComposeDialog open={hqCompose} onClose={() => setHqCompose(false)} />
        <CampaignHqBoard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <BackLink to="/whatsapp" />
      </div>
      <div>
        <h2 className="text-xl font-extrabold text-foreground">
          {t("blast.pageTitle")}
        </h2>

        <p className="mt-1 text-sm text-muted-foreground">
          {t("blast.pageDesc")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <button
          onClick={() =>
            setMode("scrubbing")
          }
          className={`rounded-lg border p-5 text-left transition ${
            mode === "scrubbing"
              ? "border-border bg-accent shadow-sm"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-teal-100 p-3 text-foreground">
              <Brain className="h-6 w-6" />
            </div>

            <div>
              <p className="font-bold text-foreground">
                {t("blast.aiTab")}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {t("blast.aiTabDesc")}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() =>
            setMode("marketing")
          }
          className={`rounded-lg border p-5 text-left transition ${
            mode === "marketing"
              ? "border-cyan-400 bg-cyan-50 shadow-sm"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-cyan-100 p-3 text-cyan-700">
              <Megaphone className="h-6 w-6" />
            </div>

            <div>
              <p className="font-bold text-foreground">
                {t("blast.blastTab")}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {t("blast.blastTabDesc")}
              </p>
            </div>
          </div>
        </button>
      </div>

      {mode === "scrubbing" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-card p-5 shadow-sm">
              <Users className="h-5 w-5 text-foreground" />

              <p className="mt-3 text-xs font-semibold text-muted-foreground">
                {t("blast.candidates")}
              </p>

              <p className="text-2xl font-bold text-foreground">
                {candidates.length}
              </p>
            </div>

            <div className="rounded-lg bg-card p-5 shadow-sm">
              <Brain className="h-5 w-5 text-cyan-600" />

              <p className="mt-3 text-xs font-semibold text-muted-foreground">
                {t("blast.selected")}
              </p>

              <p className="text-2xl font-bold text-foreground">
                {selected.length}
              </p>
            </div>

            <div className="rounded-lg bg-card p-5 shadow-sm">
              <CalendarDays className="h-5 w-5 text-indigo-600" />

              <p className="mt-3 text-xs font-semibold text-muted-foreground">{t("blast.period")}</p>

              <p className="text-2xl font-bold text-foreground">
                {months} bulan
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label>{t("blast.lastVisitOver")}</Label>

                <select
                  value={months}
                  onChange={(event) => {
                    setMonths(
                      Number(
                        event.target.value,
                      ),
                    );
                    setSelected([]);
                    setDrafts([]);
                    setFollowupConsent(false);
                  }}
                  className="mt-2 block rounded-xl border border-border bg-card px-4 py-2.5 text-sm"
                >
                  <option value={1}>
                    1 bulan
                  </option>

                  <option value={3}>
                    3 bulan
                  </option>

                  <option value={6}>
                    6 bulan
                  </option>

                  <option value={12}>
                    12 bulan
                  </option>

                  <option value={24}>
                    24 bulan
                  </option>
                </select>
              </div>

              {candidates.length > 0 && (
                <Button
                  variant="outline"
                  onClick={selectAll}
                  className="rounded-xl"
                >
                  {selected.length ===
                    Math.min(
                      candidates.length,
                      50,
                    )
                    ? t("wa.clearAll")
                    : t("wa.selectAll")}
                </Button>
              )}
            </div>

            <div className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-700">
              Pesakit yang sudah mempunyai
              appointment akan datang tidak
              dimasukkan dalam senarai.
            </div>

            {scrubbingQuery.isLoading && (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("blast.scanningLong")}</div>
            )}

            {scrubbingQuery.isError && (
              <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-600">
                {errorMessage(
                  scrubbingQuery.error,
                  t("blast.scrubFailed"),
                )}
              </div>
            )}

            {!scrubbingQuery.isLoading &&
              !scrubbingQuery.isError &&
              candidates.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {t("blast.noMatch")}
                </div>
              )}

            <div className="mt-5 space-y-3">
              {candidates.map(
                (candidate) => {
                  const checked =
                    selectedSet.has(
                      candidate.patientId,
                    );

                  return (
                    <button
                      key={
                        candidate.patientId
                      }
                      onClick={() =>
                        togglePatient(
                          candidate.patientId,
                        )
                      }
                      className={`w-full rounded-lg border p-4 text-left transition ${
                        checked
                          ? "border-border bg-accent"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="mt-1 h-4 w-4"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col justify-between gap-2 sm:flex-row">
                            <div>
                              <p className="font-bold text-foreground">
                                {
                                  candidate.name
                                }
                              </p>

                              <p className="text-xs text-muted-foreground">
                                {
                                  candidate.mrn
                                }{" "}
                                ·{" "}
                                {
                                  candidate.contactPhone
                                }
                              </p>
                            </div>

                            <span className="h-fit w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                              {
                                candidate.monthsSinceLastVisit
                              }{" "}
                              bulan
                            </span>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase text-muted-foreground">{t("blast.lastVisit")}</p>

                              <p className="mt-1 text-sm text-foreground">
                                {
                                  candidate.lastVisitDate
                                }
                              </p>
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase text-muted-foreground">{t("blast.treatmentRecord")}</p>

                              <p className="mt-1 text-sm text-foreground">
                                {
                                  candidate.lastTreatment
                                }
                              </p>
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                                {t("blast.suggestion")}
                              </p>

                              <p className="mt-1 text-sm text-foreground">
                                {
                                  candidate.suggestedReason
                                }
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                },
              )}
            </div>

            {selected.length > 0 && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-border bg-accent p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">
                        {selected.length} pesakit
                        dipilih.
                      </p>

                      <p className="mt-1 text-xs text-foreground">
                        AI akan menyediakan
                        draf sahaja. Tiada
                        WhatsApp dihantar
                        sehingga anda semak
                        dan tekan Hantar.
                      </p>
                    </div>

                    <Button
                      onClick={() =>
                        generateDrafts.mutate()
                      }
                      disabled={
                        generateDrafts.isPending ||
                        selected.length < 1 ||
                        selected.length > 50
                      }
                      className="rounded-xl bg-teal-600 hover:bg-teal-700"
                    >
                      <Brain className="mr-2 h-4 w-4" />

                      {generateDrafts.isPending
                        ? t("blast.aiGenerating")
                        : t("wa.generateFollowUp")}
                    </Button>
                  </div>
                </div>

                {drafts.length > 0 && (
                  <div className="rounded-lg border border-border bg-card p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-bold text-foreground">{t("blast.previewMessage")}</h3>

                        <p className="mt-1 text-xs text-muted-foreground">
                          Semak dan edit setiap
                          mesej sebelum masuk
                          WhatsApp queue.
                        </p>
                      </div>

                      <span className="w-fit rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                        {drafts.length} draf
                      </span>
                    </div>

                    <div className="mt-5 space-y-4">
                      {drafts.map(
                        (draft, index) => (
                          <div
                            key={
                              draft.patientId
                            }
                            className="rounded-xl border border-border p-4"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-foreground">
                                  {index + 1}.{" "}
                                  {draft.name}
                                </p>

                                <p className="text-xs text-muted-foreground">
                                  {
                                    draft.contactPhone
                                  }{" "}
                                  · Lawatan terakhir{" "}
                                  {
                                    draft.lastVisitDate
                                  }
                                </p>
                              </div>

                              <span
                                className={
                                  draft.source ===
                                  "ai"
                                    ? "w-fit rounded-full bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700"
                                    : "w-fit rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700"
                                }
                              >
                                {draft.source ===
                                "ai"
                                  ? "AI Generated"
                                  : "Fallback"}
                              </span>
                            </div>

                            <p className="mt-3 text-xs text-muted-foreground">
                              {
                                draft.suggestedReason
                              }
                            </p>

                            <Textarea
                              value={
                                draft.message
                              }
                              onChange={(
                                event,
                              ) =>
                                updateDraftMessage(
                                  draft.patientId,
                                  event.target
                                    .value,
                                )
                              }
                              rows={5}
                              className="mt-3"
                            />

                            <p className="mt-1 text-right text-[11px] text-muted-foreground">
                              {
                                draft.message
                                  .length
                              }
                              /4096
                            </p>
                          </div>
                        ),
                      )}
                    </div>

                    <div className="mt-6 border-t border-border pt-5">
                      <Label>
                        {t("blast.channel")}
                      </Label>

                      <select
                        value={effectiveChannelId}
                        onChange={(event) =>
                          setChannelId(
                            event.target
                              .value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
                      >
                        <option value="">{t("blast.pickChannel")}</option>

                        {channels.map(
                          (channel) => (
                            <option
                              key={
                                channel.id
                              }
                              value={
                                channel.id
                              }
                            >
                              {
                                channel.phone
                              }{" "}
                              -{" "}
                              {
                                channel.status
                              }
                            </option>
                          ),
                        )}
                      </select>

                      <label className="mt-4 flex gap-3 rounded-xl bg-accent p-4">
                        <input
                          type="checkbox"
                          checked={
                            followupConsent
                          }
                          onChange={(
                            event,
                          ) =>
                            setFollowupConsent(
                              event.target
                                .checked,
                            )
                          }
                          className="mt-1 h-4 w-4"
                        />

                        <div>
                          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <ShieldCheck className="h-4 w-4 text-foreground" />{t("blast.sendConfirm")}</p>

                          <p className="mt-1 text-xs text-muted-foreground">
                            Saya telah menyemak
                            draf mesej dan
                            mengesahkan penerima
                            dibenarkan menerima
                            mesej susulan
                            daripada klinik.
                          </p>
                        </div>
                      </label>

                      {drafts.length >
                        remaining && (
                        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
                          Draf dipilih melebihi
                          baki kuota yang
                          dipaparkan hari ini.
                          Kurangkan penerima
                          sebelum menghantar.
                        </div>
                      )}

                      <div className="mt-4 flex justify-end">
                        <Button
                          disabled={
                            followupSendInvalid ||
                            sendFollowups.isPending ||
                            drafts.length >
                              remaining
                          }
                          onClick={() =>
                            sendFollowups.mutate()
                          }
                          className="rounded-xl bg-primary"
                        >
                          <Send className="mr-2 h-4 w-4" />

                          {sendFollowups.isPending
                            ? t("blast.sending")
                            : `Hantar ${drafts.length} Follow-up`}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "marketing" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-card p-5 shadow-sm">
              <Users className="h-5 w-5 text-foreground" />

              <p className="mt-3 text-xs font-semibold text-muted-foreground">
                {t("blast.recipients")}
              </p>

              <p className="text-2xl font-bold text-foreground">
                {recipients.length}/50
              </p>
            </div>

            <div className="rounded-lg bg-card p-5 shadow-sm">
              <Send className="h-5 w-5 text-cyan-600" />

              <p className="mt-3 text-xs font-semibold text-muted-foreground">
                {t("blast.remainingToday")}
              </p>

              <p className="text-2xl font-bold text-foreground">
                {remaining}/50
              </p>
            </div>

            <div className="rounded-lg bg-card p-5 shadow-sm">
              <Radio className="h-5 w-5 text-emerald-600" />

              <p className="mt-3 text-xs font-semibold text-muted-foreground">{t("blast.channelUpper")}</p>

              <p className="text-sm font-bold text-foreground">
                {selectedChannel
                  ? selectedChannel.status ===
                    "working"
                    ? "Connected"
                    : selectedChannel.status
                  : t("wa.notSelected")}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="space-y-5">
              <div>
                <Label>
                  {t("blast.channel")}
                </Label>

                <select
                  value={effectiveChannelId}
                  onChange={(event) =>
                    setChannelId(
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-border px-3 py-2.5 text-sm"
                >
                  <option value="">{t("blast.pickChannel")}</option>

                  {channels.map(
                    (channel) => (
                      <option
                        key={channel.id}
                        value={channel.id}
                      >
                        {channel.phone} -{" "}
                        {channel.status}
                      </option>
                    ),
                  )}
                </select>
              </div>

              {/* Recall picker, choose recipients from patient records. The
                  manual number box below stays for one-off lists. Selecting here
                  only fills the fields; sending still goes through the blast
                  endpoint and its STOP-list gate. */}
              <div className="rounded-lg border border-border bg-muted/60 p-4">
                <RecipientPicker
                  branchId={channelBranchId}
                  branchName={branchLabel}
                  onUse={(selection: RecipientSelection) => {
                    setNumbers(selection.phones.join("\n"));
                    setMessage(selection.body);
                    setBookingUrl(selection.bookingUrl ?? "");
                    toast.success(`$ {selection.phones.length} penerima dipilih`);
                  }}
                />
              </div>

              <div>
                <Label>{t("blast.recipientNumber")}</Label>

                <Textarea
                  value={numbers}
                  onChange={(event) =>
                    setNumbers(
                      event.target.value,
                    )
                  }
                  rows={7}
                  className="mt-2"
                  placeholder={`60123456789
60198765432`}
                />
              </div>

              <div>
                <Label>{t("blast.promoCaption")}</Label>

                <Textarea
                  value={message}
                  onChange={(event) =>
                    setMessage(
                      event.target.value.slice(
                        0,
                        4096,
                      ),
                    )
                  }
                  rows={7}
                  className="mt-2"
                  placeholder={t("blast.promoHint")}
                />
              </div>

              <div className="rounded-xl border-2 border-dashed border-border bg-muted p-8 text-center">
                <Megaphone className="mx-auto h-7 w-7 text-muted-foreground" />

                <p className="mt-3 font-semibold text-foreground">
                  {t("blast.posterTitle")}
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Fungsi upload gambar akan
                  kita sambungkan dengan WAHA
                  media selepas {t("blast.aiTab")}.
                </p>
              </div>

              <label className="flex gap-3 rounded-xl bg-accent p-4">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) =>
                    setConsent(
                      event.target.checked,
                    )
                  }
                  className="mt-1 h-4 w-4"
                />

                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-foreground" />{t("blast.recipientConsent")}</p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    Saya mengesahkan penerima
                    telah memberikan kebenaran
                    menerima mesej daripada
                    klinik.
                  </p>
                </div>
              </label>

              {lastResult && (
                <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                  {lastResult.queued} mesej
                  dimasukkan ke queue. Baki{" "}
                  {lastResult.remaining}/50.
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">
                  {t("blast.schedule")}
                </Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="rounded-xl border-border bg-card px-4 py-2.5"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("blast.scheduleHint")}
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  disabled={
                    blastInvalid ||
                    blast.isPending
                  }
                  onClick={() =>
                    blast.mutate()
                  }
                  className="rounded-xl bg-primary"
                >
                  <Send className="mr-2 h-4 w-4" />

                  {blast.isPending
                    ? t("blast.queuing")
                    : scheduledAt
                      ? `Jadualkan (${recipients.length})`
                      : `Hantar (${recipients.length})`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
