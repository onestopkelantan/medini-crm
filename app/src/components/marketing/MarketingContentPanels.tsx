/**
 * MarketingContentPanels — Segments and Templates (Fasa 2C).
 *
 * WHY THESE TWO, AND NOT A/B TESTING
 *
 * `GET/POST /marketing/segments` and `/marketing/templates` have existed with working
 * validation and storage, and the UI never called either. The tables were empty and the
 * Marketing page offered five tabs that all read live clinic work.
 *
 * A/B testing was in the plan as "confirm first". It is now CONFIRMED ABSENT: there is no
 * variant table, no split column and no code anywhere in the backend. Building a UI for it
 * would mean inventing a schema, and inventing what "variant B" means for a dental recall
 * message is a clinical and marketing decision, not an implementation detail. It is left
 * out and reported, not faked.
 *
 * WHY SEGMENTS MATTER AT ALL
 *
 * A segment is a saved filter: "patients who visited 6-9 months ago and have WhatsApp".
 * Without saving one, every recall is retyped at the moment it is needed, and nobody can
 * tell which combination actually brought people back. The recall feature has always had
 * the rules; it never had the audience definition to point at.
 *
 * SEGMENT FILTERS COME FROM THE SERVER'S VOCABULARY
 *
 * `audienceFilter` is `.strict()` — an unknown key is a 422, not a warning. So the form
 * below offers exactly the keys that schema accepts. The version of this screen that
 * invented `minAge` was rejected on the first save, which is how the rule was learned.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Users, Copy } from "lucide-react";

import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useBranch } from "@/hooks/useBranch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Panel } from "@/components/shared";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ types */

/** Mirrors the server's `audienceFilter`. Every key here is one it accepts; adding a
 *  key it does not know is a 422, so this list is the contract. */
interface Filters {
  statuses?: string[] | null;
  patientType?: string | null;
  hasWhatsapp?: boolean | null;
  minMonthsSinceVisit?: number | null;
  maxMonthsSinceVisit?: number | null;
  limitSample?: number | null;
}

interface Segment { id: string; name: string; filters: Filters; createdAt: string }

interface Template {
  id: string; name: string; channel: string; category: string | null;
  subject: string | null; body: string; variables: string[] | null; status: string;
  createdAt: string;
}

const STATUSES = ["Active", "VIP", "Recall Due", "Inactive"] as const;
const CHANNELS = ["whatsapp", "sms", "email"] as const;

/** Human sentence for a saved filter. A segment called "Recall 6-9m" is clear to the
 *  person who wrote it and meaningless to anyone else — the rule must be readable. */
function describeFilters(f: Filters, t: (k: string) => string): string {
  const parts: string[] = [];
  if (f.statuses?.length) parts.push(f.statuses.join(", "));
  if (f.patientType) parts.push(f.patientType);
  if (f.hasWhatsapp) parts.push(t("mkt.hasWhatsapp"));
  if (f.minMonthsSinceVisit != null && f.maxMonthsSinceVisit != null) {
    parts.push(`${f.minMonthsSinceVisit}–${f.maxMonthsSinceVisit} ${t("mkt.monthsSince")}`);
  } else if (f.minMonthsSinceVisit != null) {
    parts.push(`≥ ${f.minMonthsSinceVisit} ${t("mkt.monthsSince")}`);
  } else if (f.maxMonthsSinceVisit != null) {
    parts.push(`≤ ${f.maxMonthsSinceVisit} ${t("mkt.monthsSince")}`);
  }
  return parts.length ? parts.join(" · ") : t("mkt.allPatients");
}

/* ------------------------------------------------------------------ segments */

export function SegmentsPanel({ canWrite }: { canWrite: boolean }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const segments = useQuery({
    queryKey: ["marketing", "segments"],
    queryFn: () => api.get<Segment[]>("/marketing/segments"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/marketing/segments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "segments"] });
      toast.success(t("mkt.segmentRemoved"));
    },
    /* Deleting a segment the server does not allow is not worth a red toast; the row
     * stays and the screen is still correct. Silence here would hide a real failure, so
     * the message is shown — but the wording does not accuse the user of a mistake. */
    onError: (e: unknown) => toast.error(errorMessage(e, t("mkt.cannotRemove"))),
  });

  const rows = segments.data ?? [];

  return (
    <Panel title={t("mkt.tabSegments")}>
      {segments.isLoading && <Skeleton className="h-32 w-full" />}

      {!segments.isLoading && rows.length > 0 && (
        <div className="divide-y divide-border">
          {rows.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />{s.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{describeFilters(s.filters ?? {}, t)}</p>
              </div>
              {canWrite && (
                <button type="button" onClick={() => remove.mutate(s.id)} disabled={remove.isPending}
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  title={t("mkt.remove")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!segments.isLoading && !rows.length && (
        <EmptyState title={t("mkt.noSegments")} description={t("mkt.noSegmentsHint")} />
      )}

      {canWrite && (
        <div className="mt-4">
          <Button size="sm" onClick={() => setAdding(true)}
            className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-1.5 h-3.5 w-3.5" />{t("mkt.addSegment")}
          </Button>
        </div>
      )}

      <NewSegmentDialog open={adding} onClose={() => setAdding(false)} />
    </Panel>
  );
}

function NewSegmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();

  /* A SEGMENT BELONGS TO A BRANCH, AND HQ HAS NONE OF ITS OWN.
   *
   * `useBranch()` returns null for HQ whenever "All Branches" is selected — which is the
   * DEFAULT. Guarding Save on it therefore disabled the button for the one role that can
   * create segments, with no visible reason. Fixing the guard alone would only hide the
   * need: an audience filter with no branch is not a smaller filter, it is undefined — so
   * the dialog ASKS, and the answer becomes the target.
   *
   * A branch user never sees the picker; their branch is already determined. */
  const { branchId: userBranchId } = useBranch();
  const branches = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Array<{ id: string; name?: string; shortName?: string; fullName?: string }>>("/admin/branches"),
    enabled: !userBranchId,
    staleTime: 10 * 60_000,
  });
  const [pickedBranch, setPickedBranch] = useState("");
  const effectiveBranchId = userBranchId ?? pickedBranch;

  const [name, setName] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [hasWhatsapp, setHasWhatsapp] = useState(false);
  const [minM, setMinM] = useState("");
  const [maxM, setMaxM] = useState("");
  const [preview, setPreview] = useState<number | null>(null);

  const buildFilters = (): Filters => {
    const f: Filters = {};
    if (statuses.length) f.statuses = statuses;
    if (hasWhatsapp) f.hasWhatsapp = true;
    if (minM.trim()) f.minMonthsSinceVisit = Number(minM);
    if (maxM.trim()) f.maxMonthsSinceVisit = Number(maxM);
    return f;
  };

  /* Preview BEFORE saving. "How many people will this reach" is the only question that
   * makes a filter meaningful — a segment that matches nobody is a mistake worth seeing
   * now, not after a campaign has been scheduled against it. */
  /* THE PREVIEW TAKES THE FILTER KEYS AT THE TOP LEVEL, NOT NESTED.
   *
   * `previewAudience` parses its body with `audienceFilter` — the same `.strict()` object
   * that `segments.filters` uses, but applied to the WHOLE body. Sending
   * `{ branchId, filters: {...} }` therefore fails with "Unrecognized key(s): filters,
   * branchId": the server is looking for `statuses`, `hasWhatsapp`, … as siblings of
   * `branchId`, not inside a `filters` box. Two shapes for one vocabulary is exactly the
   * kind of seam that passes review and fails on the first click. */
  const runPreview = useMutation({
    mutationFn: () => api.post<{ count?: number }>("/marketing/audience/preview", {
      ...buildFilters(),
      branchId: effectiveBranchId,
    }),
    onSuccess: (d) => setPreview(d?.count ?? 0),
    onError: (e: unknown) => toast.error(errorMessage(e, t("mkt.previewFailed"))),
  });

  const save = useMutation({
    mutationFn: () => api.post("/marketing/segments", {
      branchId: effectiveBranchId, name: name.trim(), filters: buildFilters(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "segments"] });
      toast.success(t("mkt.segmentSaved"));
      onClose();
      setName(""); setStatuses([]); setHasWhatsapp(false); setMinM(""); setMaxM(""); setPreview(null);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("mkt.segmentFailed"))),
  });

  const toggleStatus = (s: string) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card max-h-[90vh] max-w-lg overflow-y-auto rounded-lg border-0 bg-card shadow-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">{t("mkt.newSegment")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("mkt.newSegmentHint")}
          </DialogDescription>
        </DialogHeader>

        {!userBranchId && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("mkt.whichBranch")} *</Label>
            <Select value={pickedBranch} onValueChange={setPickedBranch}>
              <SelectTrigger className="rounded-xl border-border bg-background px-3 py-2 text-sm">
                <SelectValue placeholder={t("mkt.pickBranch")} />
              </SelectTrigger>
              <SelectContent>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.shortName ?? b.fullName ?? b.name ?? b.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t("mkt.whichBranchHint")}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground">{t("mkt.segmentName")} *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("mkt.segmentNameHint")}
            className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground">{t("mkt.segmentStatus")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => {
              const on = statuses.includes(s);
              return (
                <button key={s} type="button" onClick={() => toggleStatus(s)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    on ? "border-primary/40 bg-teal-50 text-foreground" : "border-border bg-background text-foreground hover:bg-muted"
                  }`}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground">{t("mkt.segmentRecall")}</Label>
          <div className="grid grid-cols-2 gap-3">
            <Input value={minM} onChange={(e) => setMinM(e.target.value)} inputMode="numeric"
              placeholder={t("mkt.minMonths")}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            <Input value={maxM} onChange={(e) => setMaxM(e.target.value)} inputMode="numeric"
              placeholder={t("mkt.maxMonths")}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
          <p className="text-[11px] text-muted-foreground">{t("mkt.recallHint")}</p>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={hasWhatsapp} onChange={(e) => setHasWhatsapp(e.target.checked)}
            className="h-4 w-4 rounded border-border" />
          <span className="text-sm text-foreground">{t("mkt.onlyWhatsapp")}</span>
        </label>

        {preview !== null && (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {t("mkt.previewResult").replace("{n}", String(preview))}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => runPreview.mutate()} disabled={runPreview.isPending}
            className="rounded-xl border-border">
            {runPreview.isPending ? t("mkt.checking") : t("mkt.checkCount")}
          </Button>
          <Button
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={name.trim().length < 2 || !effectiveBranchId || save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? t("mkt.saving") : t("mkt.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ templates */

export function TemplatesPanel({ canWrite }: { canWrite: boolean }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | null>(null);
  const [adding, setAdding] = useState(false);

  const templates = useQuery({
    queryKey: ["marketing", "templates"],
    queryFn: () => api.get<Template[]>("/marketing/templates"),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/marketing/templates/${id}/duplicate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "templates"] });
      toast.success(t("mkt.templateDuplicated"));
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("mkt.templateFailed"))),
  });

  const rows = templates.data ?? [];

  return (
    <Panel title={t("mkt.tabTemplates")}>
      {templates.isLoading && <Skeleton className="h-32 w-full" />}

      {!templates.isLoading && rows.length > 0 && (
        <div className="divide-y divide-border">
          {rows.map((tp) => (
            <div key={tp.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{tp.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tp.channel.toUpperCase()}{tp.category ? ` · ${tp.category}` : ""}{tp.subject ? ` · ${tp.subject}` : ""}
                </p>
                {/* The body is the substance. Showing one line of it lets the reader
                    recognise the message without opening every template. */}
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{tp.body}</p>
                {tp.variables?.length ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {tp.variables.map((v) => (
                      <span key={v} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{`{{${v}}}`}</span>
                    ))}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                  {tp.status}
                </span>
                {canWrite && (
                  <>
                    <button type="button" onClick={() => setEditing(tp)}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted">
                      {t("mkt.edit")}
                    </button>
                    <button type="button" onClick={() => duplicate.mutate(tp.id)} disabled={duplicate.isPending}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      title={t("mkt.duplicate")}>
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!templates.isLoading && !rows.length && (
        <EmptyState title={t("mkt.noTemplates")} description={t("mkt.noTemplatesHint")} />
      )}

      {canWrite && (
        <div className="mt-4">
          <Button size="sm" onClick={() => setAdding(true)}
            className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-1.5 h-3.5 w-3.5" />{t("mkt.addTemplate")}
          </Button>
        </div>
      )}

      <TemplateDialog open={adding} onClose={() => setAdding(false)} template={null} />
      <TemplateDialog open={!!editing} onClose={() => setEditing(null)} template={editing} />
    </Panel>
  );
}

function TemplateDialog({
  open, onClose, template,
}: { open: boolean; onClose: () => void; template: Template | null }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  /* Same rule as segments: HQ has no branch of its own, so the dialog asks rather than
   * leaving Save disabled for the role that can actually create templates. */
  const { branchId: userBranchId } = useBranch();
  const branches = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Array<{ id: string; name?: string; shortName?: string; fullName?: string }>>("/admin/branches"),
    enabled: !userBranchId,
    staleTime: 10 * 60_000,
  });
  const [pickedBranch, setPickedBranch] = useState("");
  const effectiveBranchId = userBranchId ?? pickedBranch;

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<string>("whatsapp");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [varsRaw, setVarsRaw] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  /* Seed once per template — a background refetch must not overwrite typing. */
  const key = template?.id ?? "__new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setName(template?.name ?? "");
    setChannel(template?.channel ?? "whatsapp");
    setCategory(template?.category ?? "");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setVarsRaw((template?.variables ?? []).join(", "));
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const save = useMutation({
    mutationFn: () => {
      const variables = varsRaw.split(",").map((v) => v.trim()).filter(Boolean);
      const payload = {
        branchId: effectiveBranchId,
        name: name.trim(),
        channel,
        category: category.trim() || null,
        /* `subject` is email-only on the server; sending it for WhatsApp would store a
         * field that channel never shows. */
        subject: channel === "email" ? (subject.trim() || null) : null,
        body: body.trim(),
        variables: variables.length ? variables : null,
      };
      return template
        ? api.patch(`/marketing/templates/${template.id}`, payload)
        : api.post("/marketing/templates", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "templates"] });
      toast.success(template ? t("mkt.templateUpdated") : t("mkt.templateCreated"));
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t("mkt.templateFailed"))),
  });

  /** Variables mentioned in the body but not declared. The server stores the declared
   *  list; a `{{name}}` in the text that is not in it will render literally on the
   *  patient's phone. Warning now is cheaper than a patient reading `{{nama}}`. */
  const declared = varsRaw.split(",").map((v) => v.trim()).filter(Boolean);
  const mentioned = Array.from(body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1]!);
  const undeclared = [...new Set(mentioned)].filter((v) => !declared.includes(v));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="glass-card max-h-[90vh] max-w-xl overflow-y-auto rounded-lg border-0 bg-card shadow-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            {template ? t("mkt.editTemplate") : t("mkt.newTemplate")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("mkt.templateHint")}
          </DialogDescription>
        </DialogHeader>

        {!userBranchId && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("mkt.whichBranch")} *</Label>
            <Select value={pickedBranch} onValueChange={setPickedBranch}>
              <SelectTrigger className="rounded-xl border-border bg-background px-3 py-2 text-sm">
                <SelectValue placeholder={t("mkt.pickBranch")} />
              </SelectTrigger>
              <SelectContent>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.shortName ?? b.fullName ?? b.name ?? b.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("mkt.templateName")} *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("mkt.channel")}</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="rounded-xl border-border bg-background px-3 py-2 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">{t("mkt.category")}</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder={t("mkt.categoryHint")}
              className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          </div>
          {channel === "email" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">{t("mkt.subject")}</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)}
                className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground">{t("mkt.body")} *</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            placeholder={t("mkt.bodyHint")}
            className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground">{t("mkt.variables")}</Label>
          <Input value={varsRaw} onChange={(e) => setVarsRaw(e.target.value)}
            placeholder={t("mkt.variablesExample")}
            className="rounded-xl border-border bg-background px-3 py-2 text-sm" />
          <p className="text-[11px] text-muted-foreground">{t("mkt.variablesHint")}</p>
        </div>

        {undeclared.length > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("mkt.undeclared").replace("{vars}", undeclared.map((v) => `{{${v}}}`).join(", "))}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl border-border">{t("btn.close")}</Button>
          <Button
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={name.trim().length < 2 || body.trim().length < 1 || !effectiveBranchId || save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? t("mkt.saving") : t("mkt.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
