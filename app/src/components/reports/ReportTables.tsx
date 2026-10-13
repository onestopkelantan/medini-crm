import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import { AlertTriangle, FileText, ShieldAlert, Users, MessageSquare } from "lucide-react";

/* ============================================================================
 * ReportTables — five reports over data that already exists (Seksyen 2 Fasa 1).
 *
 * WHY THESE ARE TABLES AND NOT CHARTS
 * Each of these answers a LOOKUP question ("who is allergic to what", "which
 * forms were issued", "who opened records"), and a chart would hide the row a
 * clinician needs. The existing KPI/trend screens are the chart half; this is
 * the list half, and both are needed.
 *
 * TWO DELIBERATE CHOICES WORTH KNOWING
 *
 * 1. The allergy report shows ACTIVE allergies only, severe first. A retired
 *    allergy is history: mixing the two makes a safety list longer and less
 *    useful to the person scanning it before treatment.
 *
 * 2. The forms report INCLUDES cancelled forms. Their serial numbers are consumed
 *    whether or not the document was used, so hiding them would make the report
 *    disagree with the serial counter and the audit trail would look broken.
 * ========================================================================== */

interface NewPatient { patientId: string; mrn: string; name: string; patientType?: string; source?: string; registeredAt?: string }
interface NewPatients { period?: string; rows?: NewPatient[]; total?: number; byDay?: Array<{ date: string; count: number }> }
interface Allergy { allergyId: string; patientName?: string | null; allergen: string; category?: string; severity?: string; reaction?: string; notedAt?: string }
interface Allergies { rows?: Allergy[]; total?: number }
interface WaTpl { templateId: string; name: string; category?: string; active: boolean }
interface WaTemplates { rows?: WaTpl[]; total?: number; active?: number; byCategory?: Array<{ category: string; total: number; active: number }> }
interface AuditRow { actorName?: string | null; actorId?: string; actorRole?: string; action: string; entity: string; n: number; lastAt?: string }
interface AccessAudit { rows?: AuditRow[]; total?: number }
interface FormRow { formId: string; serialNo: string; kind: string; subject?: string; status: string; issuedAt?: string; cancelReason?: string }
interface FormsIssued { rows?: FormRow[]; total?: number; byKind?: Array<{ kind: string; issued: number; cancelled: number }> }

const sevBadge = (s?: string) => (s === "severe" ? "critical" : s === "moderate" ? "high" : "low");

export function NewPatientsReport({ period }: { period: string }) {
  const { t } = usePrefs();
  const q = useQuery({ queryKey: ["rep", "new-patients", period], queryFn: () => api.get<NewPatients>(`/reports/new-patients?period=${period}`) });
  const d = q.data;
  return (
    <Panel title={t("rep.newPatients")} subtitle={t("rep.newPatientsHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground">{d?.total ?? 0}</span>
        <span className="text-xs text-muted-foreground">{t("rep.newPatientsCount")}</span>
      </div>
      {(d?.byDay?.length ?? 0) > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {d!.byDay!.map((x) => (
            <span key={x.date} className="rounded-full bg-accent px-3 py-1 text-xs text-foreground">{x.date} · {x.count}</span>
          ))}
        </div>
      )}
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {(d?.rows ?? []).map((p) => (
          <div key={p.patientId} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.mrn}{p.patientType ? ` · ${p.patientType}` : ""}{p.source ? ` · ${p.source}` : ""}</p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{p.registeredAt ? fmtDate(String(p.registeredAt).slice(0, 10)) : ""}</span>
          </div>
        ))}
        {!q.isLoading && !(d?.rows ?? []).length && <EmptyState title={t("rep.noNewPatients")} description={t("rep.noNewPatientsHint")} icon={<Users className="h-5 w-5" />} />}
      </div>
    </Panel>
  );
}

export function AllergiesReport() {
  const { t } = usePrefs();
  const q = useQuery({ queryKey: ["rep", "allergies"], queryFn: () => api.get<Allergies>("/reports/allergies") });
  const rows = q.data?.rows ?? [];
  return (
    <Panel title={t("rep.allergies")} subtitle={t("rep.allergiesHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <span>{t("rep.allergiesActiveOnly")}</span>
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {rows.map((a) => (
          <div key={a.allergyId} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{a.allergen}{a.category ? ` · ${a.category}` : ""}</p>
              <p className="text-xs text-muted-foreground">{a.patientName ?? "—"}{a.reaction ? ` · ${a.reaction}` : ""}</p>
            </div>
            <StatusBadge status={sevBadge(a.severity)} statusText={a.severity ?? "—"} className="rounded-full px-3 py-1 text-xs shrink-0" />
          </div>
        ))}
        {!q.isLoading && !rows.length && <EmptyState title={t("rep.noAllergies")} description={t("rep.noAllergiesHint")} icon={<AlertTriangle className="h-5 w-5" />} />}
      </div>
    </Panel>
  );
}

export function WhatsAppTemplatesReport() {
  const { t } = usePrefs();
  const q = useQuery({ queryKey: ["rep", "wa-templates"], queryFn: () => api.get<WaTemplates>("/reports/whatsapp-templates") });
  const d = q.data;
  return (
    <Panel title={t("rep.waTemplates")} subtitle={t("rep.waTemplatesHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-2xl font-bold text-foreground">{d?.total ?? 0}</span>
        <span className="text-xs text-muted-foreground">{t("rep.waTotal")}</span>
        <span className="text-sm font-semibold text-emerald-600">{d?.active ?? 0}</span>
        <span className="text-xs text-muted-foreground">{t("rep.waActive")}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(d?.byCategory ?? []).map((c) => (
          <span key={c.category} className="rounded-full bg-accent px-3 py-1 text-xs text-foreground">
            {c.category} · {c.active}/{c.total}
          </span>
        ))}
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {(d?.rows ?? []).slice(0, 40).map((x) => (
          <div key={x.templateId} className="py-2 flex items-center justify-between gap-3">
            <p className="text-sm text-foreground truncate">{x.name}</p>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">{x.category ?? "—"}</span>
              <StatusBadge status={x.active ? "done" : "pending"} statusText={x.active ? t("rep.active") : t("rep.inactive")} className="rounded-full px-2.5 py-0.5 text-xs" />
            </div>
          </div>
        ))}
        {!q.isLoading && !(d?.rows ?? []).length && <EmptyState title={t("rep.noWaTemplates")} description={t("rep.noWaTemplatesHint")} icon={<MessageSquare className="h-5 w-5" />} />}
      </div>
    </Panel>
  );
}

export function AccessAuditReport({ period }: { period: string }) {
  const { t } = usePrefs();
  const q = useQuery({ queryKey: ["rep", "access-audit", period], queryFn: () => api.get<AccessAudit>(`/reports/access-audit?period=${period}`) });
  const rows = q.data?.rows ?? [];
  return (
    <Panel title={t("rep.accessAudit")} subtitle={t("rep.accessAuditHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      <p className="mb-3 text-xs text-muted-foreground">{t("rep.accessAuditCounted")}</p>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {rows.map((a, i) => (
          <div key={`${a.actorId}-${a.action}-${i}`} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{a.actorName ?? a.actorId?.slice(0, 8) ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{a.action} · {a.entity}{a.actorRole ? ` · ${a.actorRole}` : ""}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-foreground">{a.n}×</p>
              <p className="text-xs text-muted-foreground">{a.lastAt ? String(a.lastAt).slice(0, 10) : ""}</p>
            </div>
          </div>
        ))}
        {!q.isLoading && !rows.length && <EmptyState title={t("rep.noAccessAudit")} description={t("rep.noAccessAuditHint")} />}
      </div>
    </Panel>
  );
}

export function FormsIssuedReport({ period }: { period: string }) {
  const { t } = usePrefs();
  const q = useQuery({ queryKey: ["rep", "forms-issued", period], queryFn: () => api.get<FormsIssued>(`/reports/forms-issued?period=${period}`) });
  const d = q.data;
  return (
    <Panel title={t("rep.formsIssued")} subtitle={t("rep.formsIssuedHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      <div className="mb-3 flex flex-wrap gap-2">
        {(d?.byKind ?? []).map((k) => (
          <span key={k.kind} className="rounded-full bg-accent px-3 py-1 text-xs text-foreground">
            {k.kind.toUpperCase()} · {k.issued} {t("rep.issued")}{k.cancelled ? ` · ${k.cancelled} ${t("rep.cancelled")}` : ""}
          </span>
        ))}
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {(d?.rows ?? []).map((f) => (
          <div key={f.formId} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-mono text-foreground truncate">{f.serialNo}</p>
              <p className="text-xs text-muted-foreground">{f.subject ?? "—"}{f.cancelReason ? ` · ${f.cancelReason}` : ""}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={f.status === "cancelled" ? "cancelled" : "done"} statusText={f.status === "cancelled" ? t("rep.cancelled") : t("rep.issued")} className="rounded-full px-2.5 py-0.5 text-xs" />
              <span className="text-xs text-muted-foreground">{f.issuedAt ? fmtDate(String(f.issuedAt).slice(0, 10)) : ""}</span>
            </div>
          </div>
        ))}
        {!q.isLoading && !(d?.rows ?? []).length && <EmptyState title={t("rep.noForms")} description={t("rep.noFormsHint")} icon={<FileText className="h-5 w-5" />} />}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("rep.formsCancelledNote")}</p>
    </Panel>
  );
}
