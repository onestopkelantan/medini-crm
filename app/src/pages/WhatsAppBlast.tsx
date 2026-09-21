import { useEffect, useMemo, useState } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

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

export default function WhatsAppBlast() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [mode, setMode] =
    useState<Mode>("scrubbing");

  const [months, setMonths] =
    useState(6);

  const [selected, setSelected] =
    useState<string[]>([]);

  const [channelId, setChannelId] =
    useState("");

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

  const channelsQuery = useQuery({
    queryKey: ["whatsapp-campaign", "channels"],
    queryFn: () =>
      api.get<Channel[]>(
        "/whatsapp/channels?limit=100",
      ),
  });

  const channels =
    channelsQuery.data ?? [];

  useEffect(() => {
    if (channelId) return;

    const working = channels.find(
      (channel) =>
        channel.status === "working",
    );

    if (working) {
      setChannelId(working.id);
    }
  }, [channels, channelId]);

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

  useEffect(() => {
    setSelected([]);
    setDrafts([]);
    setFollowupConsent(false);
  }, [months]);

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

  const selectedChannel =
    channels.find(
      (channel) =>
        channel.id === channelId,
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
          channelId,
          recipients,
          body: message,
          consentConfirmed: consent,
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
          "WhatsApp Blast gagal",
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
          "Tiada mesej follow-up dapat dijana.",
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
          "Gagal menjana mesej follow-up",
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
              channelId,
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
          "Penghantaran follow-up terhenti. Semak queue WhatsApp sebelum cuba semula.",
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
        "Maksimum 50 pesakit untuk satu penghantaran.",
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
    !channelId ||
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
    !channelId ||
    recipients.length < 1 ||
    recipients.length > 50 ||
    !message.trim() ||
    !consent ||
    selectedChannel?.status !==
      "working";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-[#0B132B]">
          WhatsApp Campaign
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          AI patient follow-up dan
          marketing blast dalam satu sistem.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <button
          onClick={() =>
            setMode("scrubbing")
          }
          className={`rounded-2xl border p-5 text-left transition ${
            mode === "scrubbing"
              ? "border-teal-400 bg-teal-50 shadow-sm"
              : "border-slate-200 bg-white hover:bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-teal-100 p-3 text-teal-700">
              <Brain className="h-6 w-6" />
            </div>

            <div>
              <p className="font-bold text-slate-800">
                AI Scrubbing
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Analisa rekod pesakit dan
                cari siapa yang perlu
                follow-up.
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() =>
            setMode("marketing")
          }
          className={`rounded-2xl border p-5 text-left transition ${
            mode === "marketing"
              ? "border-cyan-400 bg-cyan-50 shadow-sm"
              : "border-slate-200 bg-white hover:bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-cyan-100 p-3 text-cyan-700">
              <Megaphone className="h-6 w-6" />
            </div>

            <div>
              <p className="font-bold text-slate-800">
                Marketing Blast
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Promosi, poster dan kempen
                kepada pelanggan.
              </p>
            </div>
          </div>
        </button>
      </div>

      {mode === "scrubbing" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <Users className="h-5 w-5 text-teal-600" />

              <p className="mt-3 text-xs font-semibold text-slate-400">
                CALON FOLLOW-UP
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {candidates.length}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <Brain className="h-5 w-5 text-cyan-600" />

              <p className="mt-3 text-xs font-semibold text-slate-400">
                DIPILIH
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {selected.length}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <CalendarDays className="h-5 w-5 text-indigo-600" />

              <p className="mt-3 text-xs font-semibold text-slate-400">
                TEMPOH
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {months} bulan
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label>
                  Last visit melebihi
                </Label>

                <select
                  value={months}
                  onChange={(event) =>
                    setMonths(
                      Number(
                        event.target.value,
                      ),
                    )
                  }
                  className="mt-2 block rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
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
                    ? "Kosongkan Semua"
                    : "Pilih Semua (Maks 50)"}
                </Button>
              )}
            </div>

            <div className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-700">
              Pesakit yang sudah mempunyai
              appointment akan datang tidak
              dimasukkan dalam senarai.
            </div>

            {scrubbingQuery.isLoading && (
              <div className="py-12 text-center text-sm text-slate-400">
                Membaca rekod pesakit...
              </div>
            )}

            {scrubbingQuery.isError && (
              <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-600">
                {errorMessage(
                  scrubbingQuery.error,
                  "AI Scrubbing gagal membaca data",
                )}
              </div>
            )}

            {!scrubbingQuery.isLoading &&
              !scrubbingQuery.isError &&
              candidates.length === 0 && (
                <div className="py-12 text-center text-sm text-slate-400">
                  Tiada pesakit memenuhi
                  kriteria ini.
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
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        checked
                          ? "border-teal-300 bg-teal-50"
                          : "border-slate-100 hover:bg-slate-50"
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
                              <p className="font-bold text-slate-800">
                                {
                                  candidate.name
                                }
                              </p>

                              <p className="text-xs text-slate-400">
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
                              <p className="text-[11px] font-semibold uppercase text-slate-400">
                                Last Visit
                              </p>

                              <p className="mt-1 text-sm text-slate-700">
                                {
                                  candidate.lastVisitDate
                                }
                              </p>
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase text-slate-400">
                                Rekod Rawatan
                              </p>

                              <p className="mt-1 text-sm text-slate-700">
                                {
                                  candidate.lastTreatment
                                }
                              </p>
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase text-slate-400">
                                Cadangan
                              </p>

                              <p className="mt-1 text-sm text-slate-700">
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
                <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-teal-800">
                        {selected.length} pesakit
                        dipilih.
                      </p>

                      <p className="mt-1 text-xs text-teal-700">
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
                        ? "AI sedang menjana..."
                        : "Jana Mesej Follow-up"}
                    </Button>
                  </div>
                </div>

                {drafts.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-bold text-slate-800">
                          Preview Mesej
                        </h3>

                        <p className="mt-1 text-xs text-slate-500">
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
                            className="rounded-xl border border-slate-200 p-4"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-slate-800">
                                  {index + 1}.{" "}
                                  {draft.name}
                                </p>

                                <p className="text-xs text-slate-400">
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

                            <p className="mt-3 text-xs text-slate-500">
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

                            <p className="mt-1 text-right text-[11px] text-slate-400">
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

                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <Label>
                        WhatsApp Channel
                      </Label>

                      <select
                        value={channelId}
                        onChange={(event) =>
                          setChannelId(
                            event.target
                              .value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                      >
                        <option value="">
                          Pilih Channel
                        </option>

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

                      <label className="mt-4 flex gap-3 rounded-xl bg-teal-50 p-4">
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
                          <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <ShieldCheck className="h-4 w-4 text-teal-600" />
                            Pengesahan
                            penghantaran
                          </p>

                          <p className="mt-1 text-xs text-slate-500">
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
                          className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500"
                        >
                          <Send className="mr-2 h-4 w-4" />

                          {sendFollowups.isPending
                            ? "Menghantar ke Queue..."
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
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <Users className="h-5 w-5 text-teal-600" />

              <p className="mt-3 text-xs font-semibold text-slate-400">
                PENERIMA
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {recipients.length}/50
              </p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <Send className="h-5 w-5 text-cyan-600" />

              <p className="mt-3 text-xs font-semibold text-slate-400">
                BAKI HARI INI
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {remaining}/50
              </p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <Radio className="h-5 w-5 text-emerald-600" />

              <p className="mt-3 text-xs font-semibold text-slate-400">
                CHANNEL
              </p>

              <p className="text-sm font-bold text-slate-800">
                {selectedChannel
                  ? selectedChannel.status ===
                    "working"
                    ? "Connected"
                    : selectedChannel.status
                  : "Belum dipilih"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="space-y-5">
              <div>
                <Label>
                  WhatsApp Channel
                </Label>

                <select
                  value={channelId}
                  onChange={(event) =>
                    setChannelId(
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                >
                  <option value="">
                    Pilih Channel
                  </option>

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

              <div>
                <Label>
                  Nombor Penerima
                </Label>

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
                <Label>
                  Caption Promosi
                </Label>

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
                  placeholder="Tulis mesej promosi..."
                />
              </div>

              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <Megaphone className="mx-auto h-7 w-7 text-slate-400" />

                <p className="mt-3 font-semibold text-slate-700">
                  Gambar / Poster Promosi
                </p>

                <p className="mt-1 text-xs text-slate-400">
                  Fungsi upload gambar akan
                  kita sambungkan dengan WAHA
                  media selepas AI Scrubbing.
                </p>
              </div>

              <label className="flex gap-3 rounded-xl bg-teal-50 p-4">
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
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ShieldCheck className="h-4 w-4 text-teal-600" />
                    Pengesahan penerima
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
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

              <div className="flex justify-end">
                <Button
                  disabled={
                    blastInvalid ||
                    blast.isPending
                  }
                  onClick={() =>
                    blast.mutate()
                  }
                  className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500"
                >
                  <Send className="mr-2 h-4 w-4" />

                  {blast.isPending
                    ? "Memasukkan ke Queue..."
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
