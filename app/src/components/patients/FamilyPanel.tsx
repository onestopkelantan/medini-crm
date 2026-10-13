/**
 * FamilyPanel — who this patient is related to (Fasa 2A).
 *
 * THE QUESTION THIS SCREEN ANSWERS
 *
 * A receptionist opens a patient and needs one thing: "who is this person to other
 * people?" She is not filling in a form, she is answering a question at the counter,
 * usually with someone standing in front of her. Every extra decision is time a patient
 * waits.
 *
 * So: BUTTONS FIRST. Seven presets cover nearly every entry, one click each. The free-text
 * box exists for the tenth case the presets never predicted — an adopted child, an NGO
 * representative, an aunt — because refusing a relationship the clinic actually has is
 * worse than an extra box.
 *
 * ONE ENTRY, TWO DIRECTIONS
 *
 * Typing "Ibrahim is Ahmad's child" also makes Ibrahim's own screen show "Ahmad — bapa".
 * Staff should never enter the same fact twice; a bond that only exists on one screen is
 * a bond the next person cannot see.
 *
 * The API writes the inverse. This screen only reports whether it did — a custom label
 * has no truthful reverse, and saying so is better than guessing.
 *
 * WHY THE PRESETS COME FROM THE SERVER
 *
 * `GET /patients/relationship-presets` returns the same constant the API validates
 * against. A copied list in the UI is how the expense form ended up offering categories
 * the server had never heard of — nine values, zero matches, every save rejected.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Baby, Info } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Panel } from "@/components/shared";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { age } from "@/lib/format";

/* ------------------------------------------------------------------ types */

interface Preset { type: string; ms: string; en: string }

interface Relationship {
  id: string;
  patientId: string;
  relatedPatientId: string | null;
  relatedName: string | null;
  type: string;
  displayName: string | null;
  mrn: string | null;
  relatedGender: string | null;
  relatedDob: string | null;
  linked: boolean;
}

interface PatientOption { id: string; name: string; mrn: string }

/* ------------------------------------------------------------------ labels */

/** The preset a row's `type` matches, so a stored value renders in the reader's language. */
function presetLabel(presets: Preset[], type: string, lang: "ms" | "en"): string | null {
  const p = presets.find((x) => x.type === type);
  if (p) return lang === "ms" ? p.ms : p.en;
  return null;
}

/** The word shown for a relationship, gender-aware where it matters.
 *
 *  The API stores `parent` for the reverse of `child` because it cannot know whether the
 *  parent is the father or the mother when the entry is made. Here we CAN know — the
 *  linked patient's gender is on the row — so "parent" must never reach the screen. */
function relationshipWord(
  r: Relationship, presets: Preset[], lang: "ms" | "en",
): string {
  const ms = lang === "ms";
  if (r.type === "parent") {
    if (r.relatedGender === "male") return ms ? "bapa" : "father";
    if (r.relatedGender === "female") return ms ? "ibu" : "mother";
    return ms ? "ibu bapa" : "parent";
  }
  return presetLabel(presets, r.type, lang) ?? r.type.replace(/_/g, " ");
}

/* ------------------------------------------------------------------ panel */

export function FamilyPanel({
  patientId, patientName, canEdit,
}: { patientId: string; patientName: string; canEdit: boolean }) {
  const { t, lang } = usePrefs();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Relationship | null>(null);

  const presets = useQuery({
    queryKey: ["patients", "relationship-presets"],
    queryFn: () => api.get<Preset[]>("/patients/relationship-presets"),
    staleTime: 30 * 60_000,
  });

  const family = useQuery({
    queryKey: ["patients", patientId, "relationships"],
    queryFn: () => api.get<Relationship[]>(`/patients/${patientId}/relationships`),
    enabled: !!patientId,
  });

  const rows = family.data ?? [];
  const list = presets.data ?? [];

  /* Children are called out because this is a dental clinic: a child arriving without a
   * parent is a consent problem before it is a clinical one, and the counter needs to
   * know at a glance rather than by reading birth dates. */
  const minors = rows.filter((r) => {
    if (!r.relatedDob) return false;
    return Number.parseInt(age(r.relatedDob), 10) < 18;
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/patients/${patientId}/relationships/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients", patientId, "relationships"] });
      toast.success(t("family.removed"));
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("family.removeFailed"))),
  });

  return (
    <Panel title={t("family.title")}>
      {family.isLoading && <Skeleton className="h-32 w-full" />}

      {!family.isLoading && (
        <>
          {rows.length > 0 && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("family.relatesTo").replace("{name}", patientName)}
              </p>
              <div className="divide-y divide-border">
                {rows.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* The relationship word leads, because that is what the reader
                          is looking for, "anak", not a name they do not recognise. */}
                      <span className="w-28 shrink-0 text-xs font-bold text-foreground">
                        {relationshipWord(r, list, lang)}
                      </span>
                      <span className="min-w-0 truncate text-sm">{r.displayName ?? "—"}</span>
                      {r.mrn && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.mrn}</span>}
                      {r.relatedDob && (
                        <span className="shrink-0 text-xs text-muted-foreground">{age(r.relatedDob)}</span>
                      )}
                      {!r.linked && (
                        <span className="shrink-0 text-[11px] font-semibold text-amber-700">
                          {t("family.notRegistered")}
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => setEditing(r)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title={t("family.edit")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => remove.mutate(r.id)}
                          disabled={remove.isPending}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          title={t("family.remove")}>
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {!rows.length && (
            <EmptyState title={t("family.none")} description={t("family.noneHint")} />
          )}

          {minors.length > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <Baby className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("family.minorNote").replace("{n}", String(minors.length))}
            </p>
          )}

          {canEdit && (
            <div className="mt-4">
              <Button size="sm" onClick={() => setAdding(true)}
                className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-1.5 h-3.5 w-3.5" />{t("family.add")}
              </Button>
            </div>
          )}

          {!canEdit && (
            <p className="mt-3 text-xs text-muted-foreground">{t("family.readOnly")}</p>
          )}
        </>
      )}

      <AddRelationshipDialog
        open={adding}
        onClose={() => setAdding(false)}
        patientId={patientId}
        patientName={patientName}
        presets={list}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("family.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("family.removeHint")
                .replace("{name}", editing?.displayName ?? "")
                .replace("{rel}", editing ? relationshipWord(editing, list, lang) : "")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)} className="rounded-xl">{t("btn.close")}</Button>
            <Button className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              disabled={remove.isPending}
              onClick={() => { if (editing) { remove.mutate(editing.id); setEditing(null); } }}>
              {t("family.remove")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* ------------------------------------------------------------------ dialog */

function AddRelationshipDialog({
  open, onClose, patientId, patientName, presets,
}: {
  open: boolean; onClose: () => void;
  patientId: string; patientName: string; presets: Preset[];
}) {
  const { t, lang } = usePrefs();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [type, setType] = useState("");
  const [custom, setCustom] = useState("");
  const [mode, setMode] = useState<"existing" | "name">("existing");
  const [relatedPatientId, setRelatedPatientId] = useState("");
  const [relatedName, setRelatedName] = useState("");
  const [search, setSearch] = useState("");

  /* Candidates to link. Excludes the patient themself — "Ahmad is Ahmad's father" is
   * never a fact, and offering it invites a click that produces a nonsensical record. */
  const people = useQuery({
    queryKey: ["patients", "for-relationship", search],
    queryFn: () => api.get<PatientOption[]>(`/patients?q=${encodeURIComponent(search)}&limit=50`),
    enabled: open && mode === "existing",
    staleTime: 30_000,
  });
  const options = (people.data ?? []).filter((p) => p.id !== patientId);

  const chosen = type || custom.trim();
  const canSave = chosen.length >= 2 && (
    (mode === "existing" && !!relatedPatientId) || (mode === "name" && relatedName.trim().length >= 2)
  );

  const save = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/relationships`, {
      type: chosen,
      relatedPatientId: mode === "existing" ? relatedPatientId : null,
      relatedName: mode === "name" ? relatedName.trim() : null,
      /* Scope fields: `patients:edit` is branch-scoped and fail-closed, so a write must
       * name the branch itself. Omitting them returns 403 blaming the ROLE while the
       * real cause is a missing field. */
      branchId: user?.branchId ?? null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients", patientId, "relationships"] });
      qc.invalidateQueries({ queryKey: ["patients", patientId, "timeline"] });
      toast.success(t("family.added"));
      onClose();
      setType(""); setCustom(""); setRelatedPatientId(""); setRelatedName(""); setSearch("");
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("family.addFailed"))),
  });

  /* Whether the server will write the reverse. Shown BEFORE saving, so the user knows
   * what will appear on the other person's screen — including when nothing will. */
  const isPreset = presets.some((p) => p.type === chosen);
  const willMirror = isPreset && mode === "existing";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card max-h-[90vh] max-w-lg overflow-y-auto rounded-lg border-0 bg-card shadow-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            {t("family.whoIs").replace("{name}", patientName)}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("family.whoIsHint")}
          </DialogDescription>
        </DialogHeader>

        {/* ---- presets ---- */}
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("family.common")}
          </Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const on = type === p.type && !custom.trim();
              return (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => { setType(p.type); setCustom(""); }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    on ? "border-primary/40 bg-teal-50 text-foreground" : "border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {lang === "ms" ? p.ms : p.en}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- free text ---- */}
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("family.other")}
          </Label>
          <Input
            value={custom}
            onChange={(e) => { setCustom(e.target.value); if (e.target.value.trim()) setType(""); }}
            placeholder={t("family.otherHint")}
            className="mt-1.5 rounded-xl border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {custom.trim()
              ? t("family.customNote")
              : t("family.otherNote")}
          </p>
        </div>

        <div className="h-px bg-border" />

        {/* ---- existing or name-only ---- */}
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("family.who")}
          </Label>

          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")}
                className="mt-1 h-4 w-4" />
              <span className="flex-1">
                <span className="text-sm font-medium text-foreground">{t("family.alreadyRegistered")}</span>
                {mode === "existing" && (
                  <span className="mt-1.5 block">
                    <Input value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("family.searchPlaceholder")}
                      className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
                    {options.length > 0 && (
                      <span className="mt-1 block max-h-40 overflow-y-auto rounded-xl border border-border">
                        {options.map((o) => (
                          <button key={o.id} type="button"
                            onClick={() => setRelatedPatientId(o.id)}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                              relatedPatientId === o.id ? "bg-teal-50 font-semibold" : ""
                            }`}>
                            <span>{o.name}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{o.mrn}</span>
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" checked={mode === "name"} onChange={() => setMode("name")}
                className="mt-1 h-4 w-4" />
              <span className="flex-1">
                <span className="text-sm font-medium text-foreground">{t("family.notYetRegistered")}</span>
                {mode === "name" && (
                  <span className="mt-1.5 block">
                    <Input value={relatedName} onChange={(e) => setRelatedName(e.target.value)}
                      placeholder={t("family.namePlaceholder")}
                      className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
                  </span>
                )}
              </span>
            </label>
          </div>
        </div>

        {/* What will happen on the OTHER screen, stated before saving, not after. */}
        {chosen.length >= 2 && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {willMirror ? t("family.willMirror") : t("family.willNotMirror")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl border-border">{t("btn.close")}</Button>
          <Button
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? t("family.saving") : t("family.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FamilyPanel;
