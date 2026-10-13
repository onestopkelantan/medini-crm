/**
 * Forms.tsx — HQ manages the printable form templates (Fasa 1G-c).
 *
 * WHY THIS IS A PAGE AND NOT A TAB
 *
 * Consent templates, medical certificates, PDPA notices and time-off forms share ONE
 * engine (`consent_templates.kind`). Before 1G they could only be created through the
 * consent screen, one family at a time, and MC/PDPA/time-off had no screen at all — the
 * rows simply did not exist, so the form pickers in the clinic showed nothing.
 *
 * A single page per family would mean four places to fix the same bug and four chances to
 * forget the version bump. One page with a family selector keeps the rule visible: these
 * are the SAME KIND of object, and the only difference is what gets printed.
 *
 * WHY PLACEHOLDERS ARE SHOWN LOUDLY
 *
 * The starter body for MC, PDPA and time-off is DELIBERATELY unfinished — the clinic has to
 * supply wording that satisfies an employer and the PDPA 2010. A screen that renders
 * placeholder text like real content would let someone print and hand out a notice that
 * says nothing. So an unfinished body carries a visible badge, on the list AND in the
 * editor, until a human replaces it.
 *
 * VERSIONS ARE APPEND-ONLY
 *
 * Saving a template with an existing title creates the NEXT version; it never edits the
 * old row. A consent record points at the version that was agreed to, and a printed MC
 * already in an employer's file must stay reproducible word for word. The UI therefore
 * says "new version", not "edit", because that is what actually happens.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader, Panel, EmptyState , BackLink } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { fmtShortDateYear } from "@/lib/dateFormat";
import {
  FileText, FileHeart, ShieldCheck, CalendarOff, Plus, AlertTriangle, Lock, Eye,
} from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------- types */

type FormKind = "consent" | "mc" | "pdpa" | "time_off";

interface FormTemplate {
  id: string; kind: FormKind; title: string; body: string;
  version: number; isActive: boolean; createdAt: string;
}

/* A placeholder body is one nobody has written yet. Detected from the marker the server
 * writes, so the badge follows the DATA rather than a guess based on the family. */
const isPlaceholder = (body: string) => /^\[(TEKS|NOTIS|BORANG) BELUM DIISI/.test(body.trim());

const KINDS: { key: FormKind; labelKey: string; icon: typeof FileText; hintKey: string }[] = [
  { key: "mc", labelKey: "form.mc", icon: FileHeart, hintKey: "form.mcHint" },
  { key: "pdpa", labelKey: "form.pdpa", icon: ShieldCheck, hintKey: "form.pdpaHint" },
  { key: "time_off", labelKey: "form.timeOff", icon: CalendarOff, hintKey: "form.timeOffHint" },
  { key: "consent", labelKey: "form.consent", icon: FileText, hintKey: "form.consentHint" },
];

/* -------------------------------------------------------------------- page */

export default function Forms() {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FormKind>("mc");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<FormTemplate | null>(null);

  /* HQ writes the wording; everyone with clinical:view reads it. The page is reachable by
   * any role, but the create control is not — a control that always fails on submit is
   * worse than no control, because it wastes the attempt. */
  const isHq = user?.role === "hq";

  const templates = useQuery({
    queryKey: ["form-templates", kind, isHq],
    /* activeOnly=false for HQ so a retired version stays visible as history. Non-HQ get
     * only the active ones — offering a superseded notice invites issuing it. */
    queryFn: () => api.get<FormTemplate[]>(
      `/clinical/forms/templates?kind=${kind}&activeOnly=${isHq ? "false" : "true"}`,
    ),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (b: { title: string; body: string }) =>
      api.post("/clinical/forms/templates", { kind, title: b.title, body: b.body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["form-templates"] });
      setCreating(false);
      toast.success(t("form.saved"));
    },
    onError: (e) => toast.error(errorMessage(e, t("form.saveFailed"))),
  });

  const rows = templates.data ?? [];
  const unfinished = rows.filter((r) => isPlaceholder(r.body)).length;
  const active = KINDS.find((k) => k.key === kind)!;

  return (
    <div className="space-y-5">
      <PageHeader title={t("form.title")} description={t("form.subtitle")} />      <PageHeader title={t("form.title")} description={t("form.subtitle")} actions={<BackLink to="/clinical" />} />

      {/* ---- family selector ---- */}
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const on = k.key === kind;
          return (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                on ? "border-primary bg-primary text-primary-foreground"
                   : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}>
              <Icon className="h-4 w-4" />{t(k.labelKey)}
            </button>
          );
        })}
      </div>

      <Panel title={t(active.labelKey)} >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t(active.hintKey)}</p>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">{rows.length}</span>
              <span className="text-muted-foreground">{t("form.versionCount")}</span>
              {/* An unfinished family is stated in the header, not buried in a row, this is
                  the fact someone needs before they print anything. */}
              {unfinished > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />{unfinished} {t("form.unfinished")}
                </span>
              )}
            </div>
            {isHq && (
              <Button size="sm" className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-4 w-4" />{t("form.newVersion")}
              </Button>
            )}
          </div>

          {templates.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState
              title={t("form.none")}
              /* Say WHO can fix it and WHAT is missing, so the reader knows the next step
                 instead of just knowing that something is absent. */
              description={isHq ? t("form.noneHq") : t("form.noneOther")}
            />
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {rows.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                      {r.title}
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                        v{r.version}
                      </span>
                      {!r.isActive && (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                          <Lock className="h-2.5 w-2.5" />{t("form.retired")}
                        </span>
                      )}
                      {isPlaceholder(r.body) && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-2.5 w-2.5" />{t("form.unfinished")}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtShortDateYear(lang, r.createdAt)}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 rounded-lg text-xs"
                    onClick={() => setViewing(r)}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" />{t("form.view")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* ---- create a new version ---- */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("form.newVersion")}, {t(active.labelKey)}</DialogTitle>
            <DialogDescription>{t("form.newVersionHint")}</DialogDescription>
          </DialogHeader>
          <Editor saving={create.isPending} t={t}
            initialTitle={rows[0]?.title ?? ""}
            onSubmit={(b) => create.mutate(b)} />
        </DialogContent>
      </Dialog>

      {/* ---- read a template in full ---- */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.title} <span className="font-mono text-xs text-muted-foreground">v{viewing?.version}</span></DialogTitle>
            <DialogDescription>{t("form.viewHint")}</DialogDescription>
          </DialogHeader>
          {viewing && isPlaceholder(viewing.body) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />{t("form.placeholderWarn")}
              </p>
              <p className="mt-1">{t("form.placeholderWarnBody")}</p>
            </div>
          )}
          <pre className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-3.5 text-xs leading-relaxed text-foreground">
            {viewing?.body}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

function Editor({
  saving, t, initialTitle, onSubmit,
}: {
  saving: boolean; t: (k: string) => string; initialTitle: string;
  onSubmit: (b: { title: string; body: string }) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState("");

  /* Mirrors the server rule (body >= 10) so the form refuses before a round trip; the
   * server stays the authority. The title is required because it is how the next reader
   * finds the form. */
  const tooShort = body.trim().length < 10;
  const blocked = saving || title.trim().length < 2 || tooShort;

  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <Label htmlFor="ftitle">{t("form.fieldTitle")}</Label>
          <Input id="ftitle" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t("form.fieldTitlePh")} className="mt-1.5" />
          {/* The version rule, said where it matters. "Save" reads as overwrite; this does
              not overwrite, and a user who believes it does will avoid using it. */}
          <p className="mt-1 text-xs text-muted-foreground">{t("form.titleHint")}</p>
        </div>
        <div>
          <Label htmlFor="fbody">{t("form.fieldBody")}</Label>
          <Textarea id="fbody" value={body} onChange={(e) => setBody(e.target.value)}
            rows={12} placeholder={t("form.fieldBodyPh")} className="mt-1.5 font-mono text-xs" />
          <p className={`mt-1 text-xs ${tooShort && body.length > 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {tooShort && body.length > 0 ? t("form.bodyTooShort") : t("form.bodyHint")}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={blocked}
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onSubmit({ title: title.trim(), body: body.trim() })}>
          {saving ? "…" : t("form.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
