import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, ShieldCheck, Users, Radio } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Channel {
  id: string;
  phone: string;
  sessionName?: string | null;
  status: string;
  healthScore: number;
  sentTodayCount?: number;
  sentTodayDate?: string | null;
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

export default function WhatsAppBlast() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [channelId, setChannelId] = useState("");
  const [numbers, setNumbers] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [lastResult, setLastResult] =
    useState<BlastResult | null>(null);

  const channelsQuery = useQuery({
    queryKey: ["whatsapp-blast", "channels"],
    queryFn: () =>
      api.get<Channel[]>("/whatsapp/channels?limit=100"),
  });

  const channels = channelsQuery.data ?? [];

  useEffect(() => {
    if (channelId) return;

    const working = channels.find(
      (channel) => channel.status === "working",
    );

    if (working) {
      setChannelId(working.id);
    }
  }, [channels, channelId]);

  const recipients = useMemo(() => {
    const values = numbers
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    return [...new Set(values)];
  }, [numbers]);

  const selectedChannel = channels.find(
    (channel) => channel.id === channelId,
  );

  const sentToday = selectedChannel?.sentTodayCount ?? 0;

  const remainingDisplay =
    lastResult?.remaining ??
    Math.max(0, 50 - sentToday);

  const blast = useMutation({
    mutationFn: () =>
      api.post<BlastResult>("/whatsapp/blast", {
        branchId: user?.branchId,
        channelId,
        recipients,
        body: message,
        consentConfirmed: consent,
      }),

    onSuccess: (result) => {
      setLastResult(result);
      setNumbers("");

      qc.invalidateQueries({
        queryKey: ["whatsapp-blast", "channels"],
      });

      toast.success(
        `${result.queued} mesej dimasukkan ke queue WhatsApp`,
      );
    },

    onError: (error) => {
      toast.error(
        errorMessage(
          error,
          "WhatsApp Blast gagal dimasukkan ke queue",
        ),
      );
    },
  });

  const invalid =
    !channelId ||
    recipients.length < 1 ||
    recipients.length > 50 ||
    !message.trim() ||
    !consent ||
    selectedChannel?.status !== "working";

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="text-xl font-extrabold"
          style={{
            color: "#0B132B",
            fontFamily: "'Outfit', sans-serif",
          }}
        >
          WhatsApp Blast
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          Hantar mesej kepada maksimum 50 penerima sehari
          melalui WhatsApp cawangan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-50 p-2 text-teal-600">
              <Users className="h-5 w-5" />
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400">
                Penerima Batch
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {recipients.length}/50
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-50 p-2 text-cyan-600">
              <Send className="h-5 w-5" />
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400">
                Baki Hari Ini
              </p>

              <p className="text-2xl font-bold text-slate-800">
                {remainingDisplay}/50
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <Radio className="h-5 w-5" />
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400">
                Channel
              </p>

              <p className="text-sm font-bold text-slate-800">
                {selectedChannel
                  ? selectedChannel.status === "working"
                    ? "Connected"
                    : selectedChannel.status
                  : "Belum dipilih"}
              </p>

              {selectedChannel && (
                <p className="text-xs text-slate-400">
                  {selectedChannel.phone}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="space-y-5">
          <div>
            <Label>WhatsApp Channel</Label>

            <select
              value={channelId}
              onChange={(event) => {
                setChannelId(event.target.value);
                setLastResult(null);
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">
                Pilih WhatsApp Channel
              </option>

              {channels.map((channel) => (
                <option
                  key={channel.id}
                  value={channel.id}
                >
                  {channel.phone} - {channel.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Nombor Penerima</Label>

              <span
                className={`text-xs font-semibold ${
                  recipients.length > 50
                    ? "text-red-600"
                    : "text-slate-400"
                }`}
              >
                {recipients.length} nombor
              </span>
            </div>

            <Textarea
              value={numbers}
              onChange={(event) =>
                setNumbers(event.target.value)
              }
              rows={9}
              placeholder={`Masukkan satu nombor setiap baris.

Contoh:
60123456789
60198765432
60111222333`}
              className="mt-2 rounded-xl"
            />

            <p className="mt-2 text-xs text-slate-400">
              Boleh paste sehingga 50 nombor. Nombor berulang
              akan dikira sekali sahaja.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Mesej Blast</Label>

              <span className="text-xs text-slate-400">
                {message.length}/4096
              </span>
            </div>

            <Textarea
              value={message}
              onChange={(event) =>
                setMessage(
                  event.target.value.slice(0, 4096),
                )
              }
              rows={7}
              placeholder="Tulis mesej WhatsApp..."
              className="mt-2 rounded-xl"
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50/60 p-4">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) =>
                setConsent(event.target.checked)
              }
              className="mt-1 h-4 w-4"
            />

            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <ShieldCheck className="h-4 w-4 text-teal-600" />
                Pengesahan penerima
              </span>

              <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                Saya mengesahkan penerima ini telah memberikan
                kebenaran untuk menerima mesej WhatsApp daripada
                klinik.
              </span>
            </span>
          </label>

          {recipients.length > 50 && (
            <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-600">
              Maksimum 50 nombor sahaja untuk satu batch.
            </p>
          )}

          {selectedChannel?.autoPausedAt && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
              Channel sedang dalam safety pause. Queue akan
              diteruskan selepas tempoh rehat keselamatan.
            </p>
          )}

          {lastResult && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="font-semibold text-emerald-700">
                Blast berjaya dimasukkan ke queue.
              </p>

              <p className="mt-1 text-sm text-emerald-700">
                {lastResult.queued} penerima · baki hari ini{" "}
                {lastResult.remaining}/50
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => blast.mutate()}
              disabled={invalid || blast.isPending}
              className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-6 text-white hover:from-teal-600 hover:to-cyan-600"
            >
              <Send className="mr-2 h-4 w-4" />

              {blast.isPending
                ? "Memasukkan ke Queue..."
                : `Hantar ke Queue (${recipients.length})`}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
        Penghantaran dibuat secara berperingkat melalui queue
        WhatsApp. Sistem tidak menghantar semua 50 mesej serentak.
        Safety pause digunakan selepas 25 penghantaran sebelum
        penghantaran seterusnya diteruskan.
      </div>
    </div>
  );
}
