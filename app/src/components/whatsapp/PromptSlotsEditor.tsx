import { usePrefs } from "@/hooks/usePrefs";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
  Wand2,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Panel, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";

/**
 * Prompt slots editor — tiga versi prompt per cawangan, satu aktif.
 *
 * Sebab ada tiga: operator boleh tulis versi berbeza, uji dalam Playground,
 * kemudian tukar mana yang hidup tanpa perlu taip semula. Slot aktif itulah
 * yang digunakan bot untuk menjawab pesakit.
 *
 * Versi dihantar balik bila menyimpan supaya dua orang yang edit serentak
 * tidak menindih kerja satu sama lain — backend menolak dan minta muat semula.
 */

export interface PromptSlot {
  slot: number;
  name: string;
  prompt: string;
  version: number;
  isActive: boolean;
  configured: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface SlotListResult {
  branchId: string;
  maxSlots: number;
  slots: PromptSlot[];
}

const MIN_PROMPT = 20;
const MAX_PROMPT = 20000;

function slotEndpoint(branchId: string, slot?: number) {
  /* `/activate` is a PATH segment, so it must be added BEFORE the query
   * string — appending it after `?branchId=` produces
   * `/prompt-slots/1?branchId=<uuid>/activate`, which routes nowhere (404). */
  const path =
    slot === undefined
      ? "/whatsapp/prompt-slots"
      : `/whatsapp/prompt-slots/${slot}`;
  return `${path}?branchId=${encodeURIComponent(branchId)}`;
}

function activateEndpoint(branchId: string, slot: number) {
  return `/whatsapp/prompt-slots/${slot}/activate?branchId=${encodeURIComponent(branchId)}`;
}

/* ------------------------------------------------------------------ */
/* One slot card                                                       */
/* ------------------------------------------------------------------ */

function SlotCard({
  branchId,
  slot,
  onTest,
  busy,
}: {
  branchId: string;
  slot: PromptSlot;
  onTest: (slot: PromptSlot) => void;
  busy: boolean;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  /* Local draft lives only while editing. On open we snapshot the slot, so a
   * refetch underneath never rewrites what the operator is typing; on save or
   * cancel we drop the draft and fall back to the server value. */
  const [draft, setDraft] = useState<{ name: string; prompt: string } | null>(null);

  const name = draft?.name ?? slot.name;
  const prompt = draft?.prompt ?? slot.prompt;

  function openEditor() {
    setDraft({ name: slot.name, prompt: slot.prompt });
    setEditing(true);
  }

  function closeEditor() {
    setDraft(null);
    setEditing(false);
  }

  const trimmed = prompt.trim();
  const valid = trimmed.length >= MIN_PROMPT && trimmed.length <= MAX_PROMPT;
  const nameValid = name.trim().length >= 1 && name.trim().length <= 64;

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["whatsapp-prompt-slots", branchId] });
  }

  const save = useMutation({
    mutationFn: () =>
      api.put<PromptSlot>(slotEndpoint(branchId, slot.slot), {
        name: name.trim(),
        prompt: trimmed,
        version: slot.version,
      }),
    onSuccess: () => {
      toast.success(`Slot ${slot.slot} disimpan.`);
      closeEditor();
      refresh();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("ps.saveFailed"))),
  });

  const applyPreset = useMutation({
    mutationFn: () =>
      api.post<PromptSlot>(`/whatsapp/prompt-slots/presets/${slot.slot}/apply`, { branchId }),
    onSuccess: () => {
      toast.success(t("msg.presetLoaded"));
      refresh();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.presetFailed"))),
  });

  const activate = useMutation({
    mutationFn: () => api.post<PromptSlot>(activateEndpoint(branchId, slot.slot)),
    onSuccess: () => {
      toast.success(`Slot ${slot.slot} kini aktif, bot akan guna prompt ini.`);
      refresh();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.slotActivateFailed"))),
  });

  const remove = useMutation({
    mutationFn: () => api.del<{ slot: number }>(slotEndpoint(branchId, slot.slot)),
    onSuccess: () => {
      toast.success(`Slot ${slot.slot} dipadam.`);
      refresh();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("msg.slotDeleteFailed"))),
  });

  const pending = save.isPending || activate.isPending || remove.isPending || busy;

  function confirmDelete() {
    if (
      window.confirm(
        `Padam Slot ${slot.slot}? Teks prompt ini akan hilang dan tidak boleh dikembalikan.`,
      )
    ) {
      remove.mutate();
    }
  }

  return (
    <div
      className={
        "rounded-lg border p-4 transition-colors " +
        (slot.isActive
          ? "border-border bg-accent/40"
          : "border-border bg-card")
      }
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
              Slot {slot.slot}
            </span>

            {slot.isActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-medium text-white">
                <CheckCircle2 className="h-3 w-3" />
                Aktif
              </span>
            )}

            {!slot.configured && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Kosong
              </span>
            )}
          </div>

          <p className="mt-1.5 truncate text-sm font-semibold text-foreground">
            {slot.configured ? slot.name || `Prompt ${slot.slot}` : `Prompt ${slot.slot} belum ditulis`}
          </p>

          {slot.configured && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Versi {slot.version}
              {" · "}
              {slot.updatedAt ? t("ps.updatedAt", { t: fmtDateTime(slot.updatedAt) }) : t("common.notSaved")}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Boss #3, built-in voice presets on slots 2 (Santai) and 3
              (Profesional), offered before anything is written; once
              configured, the operator edits their own text. Lands
              INACTIVE, activating is a separate deliberate step. */}
          {(slot.slot === 2 || slot.slot === 3) && !slot.configured && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              disabled={pending}
              onClick={() => applyPreset.mutate()}
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              {slot.slot === 2 ? "Guna Preset Santai" : "Guna Preset Profesional"}
            </Button>
          )}
          {slot.configured && !slot.isActive && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              disabled={pending}
              onClick={() => activate.mutate()}
            >
              {activate.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Aktifkan
            </Button>
          )}

          {slot.configured && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={pending}
                onClick={() => onTest(slot)}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Uji
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={pending}
                onClick={() => (editing ? closeEditor() : openEditor())}
              >
                {editing ? (
                  <>
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Tutup
                  </>
                ) : (
                  <>
                    <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </>
                )}
              </Button>
            </>
          )}

          {slot.configured && !slot.isActive && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl border-red-200 text-red-600 hover:bg-red-50"
              disabled={pending}
              onClick={confirmDelete}
            >
              {remove.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Padam
            </Button>
          )}

          {!slot.configured && (
            <Button
              type="button"
              size="sm"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={pending}
              onClick={() => openEditor()}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Tulis Prompt
            </Button>
          )}
        </div>
      </div>

      {/* Preview (collapsed) */}
      {slot.configured && !editing && (
        <p className="mt-3 line-clamp-3 whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs leading-6 text-muted-foreground">
          {slot.prompt}
        </p>
      )}

      {/* Editor */}
      {editing && (
        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor={`slot-name-${slot.slot}`}
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Nama slot
            </label>
            <input
              id={`slot-name-${slot.slot}`}
              value={name}
              maxLength={64}
              disabled={save.isPending}
              onChange={(e) =>
                setDraft((d) => ({ name: e.target.value, prompt: d?.prompt ?? slot.prompt }))
              }
              placeholder={`cth. Versi sopan, Versi ringkas, Versi promosi`}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor={`slot-prompt-${slot.slot}`}
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Arahan bot
            </label>
            <textarea
              id={`slot-prompt-${slot.slot}`}
              value={prompt}
              rows={16}
              maxLength={MAX_PROMPT}
              spellCheck={false}
              disabled={save.isPending}
              onChange={(e) =>
                setDraft((d) => ({ name: d?.name ?? slot.name, prompt: e.target.value }))
              }
              placeholder={t("wa.se.fullPromptPh")}
              className="w-full resize-y rounded-xl border border-border bg-card p-3 text-sm leading-7 text-foreground outline-none focus:border-border focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Minimum {MIN_PROMPT} aksara. Simpan dahulu, kemudian uji dalam
                Playground sebelum aktifkan.
              </span>
              <span className={valid ? "" : "font-medium text-amber-700"}>
                {prompt.length.toLocaleString()} / {MAX_PROMPT.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!valid || !nameValid || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              disabled={save.isPending}
              onClick={() => {
                closeEditor();
              }}
            >
              Batal
            </Button>

            {!valid && (
              <span className="text-xs text-amber-700">
                {prompt.trim().length < MIN_PROMPT
                  ? `Perlu sekurang-kurangnya ${MIN_PROMPT} aksara.`
                  : `Melebihi ${MAX_PROMPT.toLocaleString()} aksara.`}
              </span>
            )}
            {valid && !nameValid && (
              <span className="text-xs text-amber-700">
                Beri nama slot supaya senang dikenal pasti.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Slot aktif tidak boleh dipadam */}
      {slot.isActive && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
          Bot sedang menggunakan prompt ini. Aktifkan slot lain dahulu sebelum
          memadamnya.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slots list                                                          */
/* ------------------------------------------------------------------ */

export function PromptSlotsEditor({
  branchId,
  onTest,
}: {
  branchId: string;
  onTest: (slot: PromptSlot) => void;
}) {
  const { t } = usePrefs();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["whatsapp-prompt-slots", branchId],
    queryFn: () =>
      api.get<SlotListResult>(
        `/whatsapp/prompt-slots?branchId=${encodeURIComponent(branchId)}`,
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) {
    return (
      <Panel>
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Panel>
    );
  }

  if (query.isError) {
    return (
      <Panel>
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm text-red-700">
            {errorMessage(query.error, t("ps.promptLoadFailed"))}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 rounded-xl"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Cuba semula
          </Button>
        </div>
      </Panel>
    );
  }

  const slots = query.data?.slots ?? [];
  const active = slots.find((s) => s.isActive);
  const configured = slots.filter((s) => s.configured).length;

  return (
    <div className="space-y-4">
      {/* Status ringkas */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              Prompt WhatsApp
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tulis hingga tiga versi prompt. Uji setiap satu, kemudian aktifkan
              yang terbaik, itulah yang bot guna untuk menjawab pesakit.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {active ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-3 py-1 text-xs font-medium text-white">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aktif: {active.name || `Slot ${active.slot}`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                Belum ada prompt aktif
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {configured}/{slots.length} slot berisi
            </span>
          </div>
        </div>

        {!active && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Bot belum mempunyai prompt aktif untuk cawangan ini. Tulis sekurang-kurangnya
            satu slot dan tekan <strong>{t("wa.se.activate")}</strong> sebelum membenarkan AI menjawab
            pesakit, tanpa prompt aktif, bot tidak tahu apa yang perlu dikatakan.
          </div>
        )}
      </Panel>

      {/* Slot cards */}
      {slots.length === 0 ? (
        <Panel>
          <EmptyState
            title={t("ps.noSlotTitle")}
            description={t("ps.noSlot")}
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {slots.map((slot) => (
            <SlotCard
              key={slot.slot}
              branchId={branchId}
              slot={slot}
              onTest={onTest}
              busy={query.isFetching}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={query.isFetching}
          onClick={() => qc.invalidateQueries({ queryKey: ["whatsapp-prompt-slots", branchId] })}
        >
          <RefreshCw
            className={
              "mr-2 h-4 w-4" + (query.isFetching ? " animate-spin" : "")
            }
          />
          Muat semula
        </Button>
      </div>
    </div>
  );
}
