import { usePrefs } from "@/hooks/usePrefs";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Bot,
  Clock,
  Gauge,
  MessageSquareDashed,
  Play,
  ShieldCheck,
  Type,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";

/**
 * Anti-ban settings for the WhatsApp AI receptionist, per branch.
 *
 * Every control here writes straight to `ai_whatsapp_settings`, which the reply
 * engine and the blast scheduler read. The numbers are the whole point: the
 * engine's behaviour is these values, so the panel states them plainly rather
 * than hiding them behind friendlier words.
 */

interface AntibanSettings {
  branchId: string;
  /* The AI switch. DELIBERATELY SEPARATE from antibanEnabled below, which turns
   * the anti-ban BRAKES off — the opposite effect. Two switches, two words. */
  aiEnabled: boolean;
  antibanEnabled: boolean;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  dailyMessageCap: number;
  hourlyMessageCap: number;
  warmupDays: number;
  warmupDailyCap: number;
  escalationKeywords: string;
  maxAiTurns: number;
  escalateOnAiUncertainty: boolean;
  escalationReply: string;
  replyWindowSeconds: number;
  typingIndicatorEnabled: boolean;
  blastScheduleEnabled: boolean;
  blastWindowStartHour: number;
  blastWindowEndHour: number;
  maxBlastPerDay: number;
  blastMinGapSeconds: number;
  blastMaxGapSeconds: number;
  configured: boolean;
  updatedAt: string | null;
}

interface BlastPlan {
  recipients: number;
  perDay: number;
  days: number;
  windowHours: number;
  gapSeconds: number;
  gapLabel: string;
  exceedsDailyCap: boolean;
  note: string;
}

interface SafetyDecision {
  id: string;
  decision: "allowed" | "blocked";
  blockedReason: string | null;
  createdAt: string;
}

/** Reply-pacing presets, matching the clinic's agreed policy. */
const PRESETS: Array<{ label: string; hint: string; min: number; max: number }> = [
  { label: "Pantas", hint: "5 saat", min: 3, max: 5 },
  { label: "Selamat", hint: "10 saat (disyorkan)", min: 8, max: 12 },
  { label: "Sangat Selamat", hint: "20 saat", min: 15, max: 25 },
];

export default function AntibanSettingsPanel({ branchId }: { branchId: string }) {
const { t, lang } = usePrefs();

  /* Who may change these settings. Both hq and branch_manager hold ai:edit —
   * the manager is the one in the clinic when the AI says something wrong — but
   * a role without it must see that, not meet a 403 after filling a form. */
  const { user } = useAuth();
  const canEdit = user?.role === "hq" || user?.role === "branch_manager";

  const qc = useQueryClient();
  const [draftState, setDraftState] = useState<{ branchId: string; value: AntibanSettings } | null>(null);
  const draft = draftState?.branchId === branchId ? draftState.value : null;
  /** Blast calculator inputs — the operator's own numbers, not saved settings. */
  const [calcRecipients, setCalcRecipients] = useState(1400);
  const [calcDays, setCalcDays] = useState(14);

  const settings = useQuery({
    queryKey: ["antiban", branchId],
    queryFn: () => api.get<AntibanSettings>(`/ai/whatsapp-settings?branchId=${branchId}`),
    enabled: Boolean(branchId),
  });

  const decisions = useQuery({
    queryKey: ["antiban", "decisions", branchId],
    queryFn: () =>
      api.get<SafetyDecision[]>(
        `/whatsapp/safety-decisions?branchId=${branchId}&limit=20`,
      ).catch(() => []),
    enabled: Boolean(branchId),
  });

  /* Server state is the source of truth. `draft` only exists after the operator
   * changes a field; otherwise we render directly from the query. This avoids
   * mirroring query state through effects and preserves unsaved edits across a
   * background refetch. */
  const values = draft ?? settings.data ?? null;

  const save = useMutation({
    mutationFn: (values: AntibanSettings) =>
      api.put<AntibanSettings>(`/ai/whatsapp-settings?branchId=${branchId}`, {
        aiEnabled: values.aiEnabled,
        antibanEnabled: values.antibanEnabled,
        minDelaySeconds: values.minDelaySeconds,
        maxDelaySeconds: values.maxDelaySeconds,
        dailyMessageCap: values.dailyMessageCap,
        hourlyMessageCap: values.hourlyMessageCap,
        warmupDays: values.warmupDays,
        warmupDailyCap: values.warmupDailyCap,
        escalationKeywords: values.escalationKeywords,
        maxAiTurns: values.maxAiTurns,
        escalateOnAiUncertainty: values.escalateOnAiUncertainty,
        escalationReply: values.escalationReply,
      }),
    onSuccess: (saved) => {
      toast.success(t("anti.saved"));
      setDraftState({ branchId, value: saved });
      qc.invalidateQueries({ queryKey: ["antiban", branchId] });
    },
    onError: (e) => toast.error(errorMessage(e, t("anti.saveFailed"))),
  });

  /** Live preview of the blast spacing for the numbers the operator typed. */
  const preview = useQuery({
    queryKey: ["antiban", "blast-preview", branchId, calcRecipients, calcDays],
    queryFn: () =>
      api.get<BlastPlan>(
        `/ai/whatsapp-settings/blast/preview?recipients=${calcRecipients}&days=${calcDays}&branchId=${branchId}`,
      ),
    enabled: Boolean(branchId) && calcRecipients > 0,
  });

  const dirty = useMemo(() => {
    if (!draft || !settings.data) return false;
    return JSON.stringify(draft) !== JSON.stringify(settings.data);
  }, [draft, settings.data]);

  if (settings.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loadingSettings")}</p>;
  }

  if (settings.isError || !values) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">{t("anti.loadFailed")}</p>
        <p className="mt-1">
          Pilih satu cawangan dahulu. Tetapan anti-ban disimpan per cawangan.
        </p>
      </div>
    );
  }

  const set = <K extends keyof AntibanSettings>(key: K, value: AntibanSettings[K]) =>
    setDraftState((d) => ({
      branchId,
      value: { ...(d?.branchId === branchId ? d.value : values), [key]: value },
    }));

  const activePreset = PRESETS.find(
    (p) => values.minDelaySeconds >= p.min && values.maxDelaySeconds <= p.max,
  );

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-100 p-2.5 text-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold text-foreground">{t("wa.ab.title")}</p>
            <p className="text-xs text-muted-foreground">
              Melindungi nombor WhatsApp daripada disekat Meta
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={values.configured ? "default" : "secondary"}>
            {values.configured ? "Dikonfigurasi" : "Guna nilai lalai"}
          </Badge>
          <Switch
            checked={values.antibanEnabled}
            disabled={!canEdit}
            onCheckedChange={(v) => set("antibanEnabled", v)}
            aria-label={t("wa.ab.enableHint")}
          />
        </div>
      </div>

      {!values.antibanEnabled && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Perlindungan anti-ban <strong>dimatikan</strong>. Bot akan membalas serta-merta
            tanpa sela masa. Ini meningkatkan risiko nombor disekat WhatsApp.
          </p>
        </div>
      )}

      {!canEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Anda boleh <strong>lihat</strong> tetapan ini tetapi tidak mengubahnya.
            Hubungi HQ untuk menukar sela masa atau mematikan AI.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------ AI switch --- */}
      {/* Placed ABOVE the anti-ban switch, and worded differently on purpose.
          "Perlindungan Anti-Ban" governs the brakes; this governs whether the AI
          speaks at all. An operator must not confuse the two, they point in
          opposite directions. */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-xl p-2.5 ${values.aiEnabled ? "bg-cyan-100 text-cyan-700" : "bg-muted text-muted-foreground"}`}>
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-foreground">{t("anti.aiReply")}</p>
              <p className="text-xs text-muted-foreground">
                {values.aiEnabled
                  ? "AI menjawab WhatsApp pesakit untuk cawangan ini"
                  : "AI berhenti, semua mesej perlu dijawab oleh staf"}
              </p>
            </div>
          </div>
          <Switch
            checked={values.aiEnabled}
            disabled={!canEdit}
            onCheckedChange={(v) => set("aiEnabled", v)}
            aria-label={t("wa.ab.enableAi")}
          />
        </div>

        {!values.aiEnabled && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>
                {t("anti.aiOffLine1")}
              </p>
              <p className="mt-1">
                {t("anti.aiOffLine2")}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- reply pacing */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-foreground" />
          <h3 className="font-bold text-foreground">{t("anti.replyDelay")}</h3>
        </header>
        <p className="mt-1 text-xs text-muted-foreground">
          Berapa lama bot menunggu sebelum membalas. Lebih lama = lebih selamat
          daripada dikesan sebagai mesin.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={activePreset?.label === p.label ? "default" : "outline"}
              onClick={() => {
                set("minDelaySeconds", p.min);
                set("maxDelaySeconds", p.max);
              }}
            >
              {p.label}
              <span className="ml-2 text-[11px] opacity-70">{p.hint}</span>
            </Button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <Label>{t("wa.ab.minDelay")}</Label>
            <span className="font-mono font-semibold text-foreground">
              {values.minDelaySeconds}s
            </span>
          </div>
          <Slider
            value={[Math.min(values.minDelaySeconds, 25)]}
            min={3}
            max={25}
            step={1}
            onValueChange={([v]) => {
              const min = v ?? 3;
              set("minDelaySeconds", min);
              /* Keep the range coherent: a minimum above the maximum would be
               * rejected by the API, so the ceiling follows it up. */
              if (values.maxDelaySeconds < min) set("maxDelaySeconds", min);
            }}
          />

          <div className="flex items-center justify-between text-sm">
            <Label>{t("wa.ab.maxDelay")}</Label>
            <span className="font-mono font-semibold text-foreground">
              {values.maxDelaySeconds}s
            </span>
          </div>
          <Slider
            value={[Math.min(values.maxDelaySeconds, 25)]}
            min={3}
            max={25}
            step={1}
            onValueChange={([v]) => {
              const max = v ?? 3;
              if (max < values.minDelaySeconds) {
                /* Move the floor down with it rather than letting the pair
                 * become invalid. */
                set("minDelaySeconds", max);
              }
              set("maxDelaySeconds", max);
            }}
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Bot akan membalas antara{" "}
          <strong>
            {values.minDelaySeconds}–{values.maxDelaySeconds} saat
          </strong>{" "}
          selepas mesej terakhir pesakit.
        </p>
      </section>

      {/* ------------------------------------------- coalescing + typing */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <MessageSquareDashed className="h-4 w-4 text-foreground" />
          <h3 className="font-bold text-foreground">{t("anti.batchTyping")}</h3>
        </header>

        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between text-sm">
              <Label>{t("wa.ab.window")}</Label>
              <span className="font-mono font-semibold text-foreground">
                {values.replyWindowSeconds}s
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Kalau pesakit hantar beberapa mesej berturut-turut, bot menunggu
              selama ini dan menjawab semuanya <strong>sekali</strong>.
            </p>
            <Slider
              className="mt-2"
              value={[values.replyWindowSeconds]}
              min={5}
              max={30}
              step={1}
              onValueChange={([v]) => set("replyWindowSeconds", v ?? 10)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-muted p-3">
            <div className="flex items-start gap-2">
              <Type className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("anti.typingSim")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Pesakit nampak status menaip 5–10 saat sebelum balasan tiba
                </p>
              </div>
            </div>
            <Switch
              checked={values.typingIndicatorEnabled}
              onCheckedChange={(v) => set("typingIndicatorEnabled", v)}
              aria-label={t("wa.ab.typing")}
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ blast calculator */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-600" />
          <h3 className="font-bold text-foreground">{t("wa.ab.blastCalc")}</h3>
        </header>
        <p className="mt-1 text-xs text-muted-foreground">
          Masukkan bilangan penerima dan tempoh promosi. Sistem kira sela masa
          paling selamat secara automatik.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="calc-recipients">{t("anti.recipientCount")}</Label>
            <Input
              id="calc-recipients"
              type="number"
              min={1}
              max={1000000}
              value={calcRecipients}
              onChange={(e) =>
                setCalcRecipients(Math.max(1, Number(e.target.value) || 1))
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="calc-days">{t("wa.ab.promoDays")}</Label>
            <Input
              id="calc-days"
              type="number"
              min={1}
              max={365}
              value={calcDays}
              onChange={(e) => setCalcDays(Math.max(1, Number(e.target.value) || 1))}
              className="mt-2"
            />
          </div>
        </div>

        {preview.data && (
          <div
            className={`mt-4 rounded-xl border p-4 ${
              preview.data.exceedsDailyCap
                ? "border-red-200 bg-red-50"
                : "border-border bg-accent"
            }`}
          >
            {preview.data.exceedsDailyCap ? (
              <div className="flex items-start gap-2 text-sm text-red-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">{t("wa.ab.overDaily")}</p>
                  <p className="mt-1">{preview.data.note}</p>
                </div>
              </div>
            ) : (
              <div className="text-sm text-teal-900">
                <p className="font-bold">
                  {preview.data.perDay} mesej sehari
                </p>
                <p className="mt-1">
                  Setiap <strong>{preview.data.gapLabel}</strong>, dalam tetingkap{" "}
                  {values.blastWindowStartHour}:00–{values.blastWindowEndHour}:00
                </p>
                <p className="mt-1 text-xs opacity-80">
                  {preview.data.days} hari · {preview.data.windowHours} jam sehari ·
                  had {values.maxBlastPerDay}/hari
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="blast-start">{t("wa.ab.start")}</Label>
            <Input
              id="blast-start"
              type="number"
              min={0}
              max={23}
              value={values.blastWindowStartHour}
              onChange={(e) =>
                set("blastWindowStartHour", Math.min(23, Math.max(0, Number(e.target.value) || 0)))
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="blast-end">{t("wa.ab.end")}</Label>
            <Input
              id="blast-end"
              type="number"
              min={1}
              max={24}
              value={values.blastWindowEndHour}
              onChange={(e) =>
                set("blastWindowEndHour", Math.min(24, Math.max(1, Number(e.target.value) || 1)))
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="blast-cap">{t("wa.ab.dailyCap")}</Label>
            <Input
              id="blast-cap"
              type="number"
              min={1}
              max={100}
              value={values.maxBlastPerDay}
              onChange={(e) =>
                /* 100 is the agreed ceiling: above it the risk of a Meta
                 * restriction rises faster than the campaign finishes. */
                set("maxBlastPerDay", Math.min(100, Math.max(1, Number(e.target.value) || 1)))
              }
              className="mt-2"
            />
          </div>
        </div>
        {values.blastWindowStartHour < 8 || values.blastWindowEndHour > 22 ? (
          <p className="mt-2 text-xs text-amber-700">
            ⚠️ Waktu di luar 08:00–22:00. Mesej promosi di luar waktu ini boleh
            mengganggu pesakit dan meningkatkan risiko disekat.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------- escalation */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="font-bold text-foreground">{t("wa.ab.escalate")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Bila bot berhenti dan serahkan perbualan kepada staff.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="esc-keywords">{t("wa.ab.escKeywords")}</Label>
            <Input
              id="esc-keywords"
              value={values.escalationKeywords}
              onChange={(e) => set("escalationKeywords", e.target.value)}
              className="mt-2"
              placeholder={t("wa.ab.escKeywordsPh")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="esc-turns">{t("wa.ab.maxTurns")}</Label>
              <Input
                id="esc-turns"
                type="number"
                min={1}
                max={50}
                value={values.maxAiTurns}
                onChange={(e) =>
                  set("maxAiTurns", Math.max(1, Number(e.target.value) || 1))
                }
                className="mt-2"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted p-3">
              <p className="text-sm font-semibold text-foreground">
                Eskalasi bila AI tidak pasti
              </p>
              <Switch
                checked={values.escalateOnAiUncertainty}
                onCheckedChange={(v) => set("escalateOnAiUncertainty", v)}
                aria-label={t("wa.ab.escUnsure")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="esc-reply">{t("anti.escalationReply")}</Label>
            <Textarea
              id="esc-reply"
              rows={3}
              value={values.escalationReply}
              onChange={(e) => set("escalationReply", e.target.value)}
              className="mt-2"
            />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- safety record */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-bold text-foreground">{t("anti.blockLog")}</h3>
        </header>
        <p className="mt-1 text-xs text-muted-foreground">
          Mesej yang dihalang oleh enjin keselamatan, dan sebabnya.
        </p>

        {decisions.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (decisions.data ?? []).length === 0 ? (
          <p className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            Tiada sekatan direkod. Ini keadaan yang baik.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {(decisions.data ?? []).slice(0, 10).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl border border-border p-2.5 text-xs"
              >
                <Badge variant={d.decision === "blocked" ? "destructive" : "secondary"}>
                  {d.decision === "blocked" ? "Disekat" : "Dibenarkan"}
                </Badge>
                <span className="text-muted-foreground">{d.blockedReason ?? "—"}</span>
                <span className="text-muted-foreground">
                  {new Date(d.createdAt).toLocaleString("ms-MY")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------------------------------- save */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
        <p className="text-xs text-muted-foreground">
          {dirty
            ? t("anti.unsavedChanges")
            : values.updatedAt
              ? t("ps.updatedAt", { t: new Date(values.updatedAt).toLocaleString(lang === "ms" ? "ms-MY" : "en-GB") })
              : t("common.notSaved")}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => settings.data && setDraftState({ branchId, value: settings.data })}
          >
            Set semula
          </Button>
          <Button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => values && save.mutate(values)}
          >
            <Play className="mr-2 h-4 w-4" />
            {save.isPending ? t("common.saving") : t("anti.saveSettings")}
          </Button>
        </div>
      </div>
    </div>
  );
}
