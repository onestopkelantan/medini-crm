/**
 * PatientClinicalPanels — the clinical tabs on Patient 360 (Fasa 2A).
 *
 * WHY THESE LIVE HERE AND NOT ON THE CLINICAL PAGE
 *
 * The Clinical page answers "what is happening in the clinic today" — it opens with an
 * appointment picker, because a visit starts from the queue. Patient 360 answers a
 * different question: "what is this person's history". A dentist who has just finished
 * treatment is standing at THIS screen, so the record of the visit must be readable and
 * writable here.
 *
 * Before this file, Patient 360 had six tabs and four of them were not clinical at all.
 * Encounters, the tooth chart, prescriptions, adverse events, referrals, imaging and lab
 * work existed in the API and had no home on the patient's own page. A dentist had to
 * leave the patient to look at the patient.
 *
 * ONE ROW SHAPE, SEVEN SOURCES
 *
 * Every panel below renders `{ id, title, subtitle?, meta?, badge? }` and nothing else.
 * The alternative — a bespoke layout per panel — means seven places to fix when the
 * design changes, and seven chances for the panels to disagree about spacing, empty
 * states and dates. `ClinicalList` is the only renderer.
 *
 * EMPTY IS AN ANSWER, NOT A FAILURE
 *
 * Each panel says WHAT IS MISSING and, where the reader can act, what to do about it.
 * "No encounters" on a patient who has never attended is correct and useful; a blank
 * panel of the same size would read as a loading failure.
 */

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Panel } from "@/components/shared";
import { fmtDate } from "@/lib/format";
import ToothChartPanel from "./ToothChartPanel";
import { ReferralStatusSelect } from "./ClinicalActionPanels";

/* ------------------------------------------------------------------ shapes */

/** The single row shape every clinical panel renders. */
interface Row {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: { text: string; tone?: "neutral" | "ok" | "warn" | "bad" };
}

const TONE: Record<string, string> = {
  neutral: "bg-muted text-foreground border-border",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
};

/** Statuses are grouped, not printed raw: a dentist reads "waiting" faster than
 *  `pending_approval`, and the grouping stays stable if a new status appears. */
function toneFor(status: string | undefined): Row["badge"] {
  const s = (status ?? "").toLowerCase();
  const t = (x: "ok" | "warn" | "bad" | "neutral"): Row["badge"] => ({ text: status ?? "—", tone: x });
  if (["open", "in_progress", "active", "confirmed", "issued", "approved", "scheduled"].includes(s)) return t("ok");
  if (["pending", "draft", "pending_approval", "proposed", "ordered", "submitted"].includes(s)) return t("warn");
  if (["cancelled", "rejected", "no_show", "flagged", "failed", "on_hold"].includes(s)) return t("bad");
  return t("neutral");
}

/* ------------------------------------------------------------------ list */

function ClinicalList({
  rows, loading, emptyTitle, emptyHint, action,
}: {
  rows: Row[];
  loading: boolean;
  emptyTitle: string;
  emptyHint: string;
  /** Rendered inside the empty state — "here is what to do about it". */
  action?: ReactNode;
}) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!rows.length) return <EmptyState title={emptyTitle} description={emptyHint} />;

  return (
    <div className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{r.title}</p>
            {r.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{r.subtitle}</p>}
            {r.meta && <p className="mt-0.5 text-xs text-muted-foreground">{r.meta}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {r.badge && (
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${TONE[r.badge.tone ?? "neutral"]}`}>
                {r.badge.text.replace(/_/g, " ")}
              </span>
            )}
            {action}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ encounters */

interface Encounter {
  id: string; encounterCode: string; status: string; chiefComplaint: string | null;
  startedAt: string | null; completedAt: string | null; createdAt: string;
}

export function EncountersPanel({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["clinical", "encounters", patientId],
    queryFn: () => api.get<Encounter[]>(`/clinical/encounters?patientId=${patientId}&limit=50`),
    enabled: !!patientId,
  });
  const rows = (q.data ?? []).map<Row>((e) => ({
    id: e.id,
    title: e.chiefComplaint?.trim() || t("p360.encounterNoComplaint"),
    subtitle: e.encounterCode,
    meta: e.completedAt
      ? `${t("p360.opened")} ${fmtDate(e.startedAt ?? e.createdAt)} · ${t("p360.closed")} ${fmtDate(e.completedAt)}`
      : `${t("p360.opened")} ${fmtDate(e.startedAt ?? e.createdAt)}`,
    badge: toneFor(e.status),
  }));
  return (
    <Panel title={t("p360.tabEncounters")}>
      <ClinicalList rows={rows} loading={q.isLoading}
        emptyTitle={t("p360.noEncounters")} emptyHint={t("p360.noEncountersHint")} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ prescriptions */

interface Prescription { id: string; medication: string | null; dosage: string | null; frequency: string | null; duration: string | null; status?: string; createdAt: string }

export function PrescriptionsPanel({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["clinical", "prescriptions", patientId],
    queryFn: () => api.get<Prescription[]>(`/clinical/prescriptions?patientId=${patientId}`),
    enabled: !!patientId,
  });
  const rows = (q.data ?? []).map<Row>((p) => ({
    id: p.id,
    title: p.medication?.trim() || t("clinical.prescription"),
    subtitle: [p.dosage, p.frequency, p.duration].filter(Boolean).join(" · ") || undefined,
    meta: fmtDate(p.createdAt),
    badge: toneFor(p.status),
  }));
  return (
    <Panel title={t("p360.tabPrescriptions")}>
      <ClinicalList rows={rows} loading={q.isLoading}
        emptyTitle={t("p360.noPrescriptions")} emptyHint={t("p360.noPrescriptionsHint")} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ adverse */

interface AdverseEvent { id: string; description: string | null; severity: string | null; status?: string; createdAt: string }

export function AdversePanel({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["clinical", "adverse", patientId],
    queryFn: () => api.get<AdverseEvent[]>(`/clinical/adverse-events?patientId=${patientId}`),
    enabled: !!patientId,
  });
  const rows = (q.data ?? []).map<Row>((a) => ({
    id: a.id,
    title: a.description?.trim() || t("clinical.adverseEvent"),
    meta: fmtDate(a.createdAt),
    badge: a.severity
      ? { text: a.severity, tone: /sever|life/i.test(a.severity) ? "bad" : "warn" }
      : toneFor(a.status),
  }));
  return (
    <Panel title={t("p360.tabAdverse")}>
      <ClinicalList rows={rows} loading={q.isLoading}
        emptyTitle={t("p360.noAdverse")} emptyHint={t("p360.noAdverseHint")} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ referrals */

interface Referral { id: string; status: string; reason: string | null; referredTo: string | null; createdAt: string }

export function ReferralsPanel({ patientId, canEdit }: { patientId: string; canEdit: boolean }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["clinical", "referrals", patientId],
    queryFn: () => api.get<Referral[]>(`/clinical/referrals?patientId=${patientId}`),
    enabled: !!patientId,
  });
  const rows = (q.data ?? []).map<Row>((r) => ({
    id: r.id,
    title: r.referredTo?.trim() || t("clinical.referral"),
    subtitle: r.reason ?? undefined,
    meta: fmtDate(r.createdAt),
    badge: toneFor(r.status),
  }));
  return (
    <Panel title={t("p360.tabReferrals")}>
      {rows.length > 0 && !canEdit && (
        <p className="mb-2 text-xs text-muted-foreground">{t("p360.readOnly")}</p>
      )}
      <ClinicalList rows={rows} loading={q.isLoading}
        emptyTitle={t("p360.noReferrals")} emptyHint={t("p360.noReferralsHint")}
        action={canEdit ? <ReferralStatusSelect id={rows[0]?.id ?? ""} status="pending" /> : undefined} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ imaging */

interface Imaging { id: string; kind: string | null; fileName: string | null; takenAt: string | null; createdAt: string }

export function ImagingPanel({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["clinical", "imaging", patientId],
    queryFn: () => api.get<Imaging[]>(`/clinical/imaging?patientId=${patientId}`),
    enabled: !!patientId,
  });
  const rows = (q.data ?? []).map<Row>((m) => ({
    id: m.id,
    title: m.fileName?.trim() || m.kind?.trim() || t("p360.imaging"),
    meta: fmtDate(m.takenAt ?? m.createdAt),
    badge: m.kind ? { text: m.kind, tone: "neutral" } : undefined,
  }));
  return (
    <Panel title={t("p360.tabImaging")}>
      <ClinicalList rows={rows} loading={q.isLoading}
        emptyTitle={t("p360.noImaging")} emptyHint={t("p360.noImagingHint")} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ lab */

interface LabCase { id: string; labVendor: string | null; workDescription: string | null; dueDate: string | null; status: string; createdAt: string }

export function LabPanel({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["operations", "lab-cases", patientId],
    queryFn: () => api.get<LabCase[]>(`/operations/lab-cases/for-patient/${patientId}`),
    enabled: !!patientId,
    retry: false,
  });

  /* A 403 is not an error worth shouting about: the counter and the dentist have no
   * operations access, and "you cannot see this" on a patient tab is noise. The panel
   * simply reports that there is nothing for them here. */
  const forbidden = (q.error as { status?: number } | null)?.status === 403;

  const rows = (q.data ?? []).map<Row>((c) => ({
    id: c.id,
    title: c.workDescription?.trim() || c.labVendor?.trim() || t("p360.labCase"),
    subtitle: c.labVendor ?? undefined,
    meta: c.dueDate ? `${t("p360.due")} ${fmtDate(c.dueDate)}` : fmtDate(c.createdAt),
    badge: toneFor(c.status),
  }));
  return (
    <Panel title={t("p360.tabLab")}>
      <ClinicalList rows={rows} loading={q.isLoading && !forbidden}
        emptyTitle={t("p360.noLab")}
        emptyHint={forbidden ? t("p360.labRestricted") : t("p360.noLabHint")} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ chart */

export function ChartPanel({ patientId, canEdit }: { patientId: string; canEdit: boolean }) {
  const { t } = usePrefs();
  return (
    <Panel title={t("p360.tabChart")}>
      {/* The existing odontogram, reused rather than rebuilt. It already handles the
          "which patient" case via `encounterPatientId`, which is how the counter charts
          a patient between visits. */}
      <ToothChartPanel encounterId={null} encounterPatientId={patientId} canEdit={canEdit} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ appointments */

interface Appointment {
  id: string; code: string; scheduledDate: string; scheduledTime: string;
  status: string; doctorId: string | null; treatmentRef: string | null;
}

export function AppointmentsPanel({ patientId }: { patientId: string }) {
  const { t } = usePrefs();
  const q = useQuery({
    queryKey: ["appointments", "patient", patientId],
    queryFn: () => api.get<Appointment[]>(`/appointments?patientId=${patientId}&limit=100`),
    enabled: !!patientId,
  });

  /* Split into what is still coming and what has passed. A single list ordered by date
   * buries the next appointment under years of history — and "when is she next in" is
   * the question the counter opens this tab to answer. */
  const all = q.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter((a) => a.scheduledDate >= today);
  const past = all.filter((a) => a.scheduledDate < today);

  const toRow = (a: Appointment): Row => ({
    id: a.id,
    title: `${fmtDate(a.scheduledDate)} · ${a.scheduledTime}`,
    subtitle: a.code,
    meta: a.treatmentRef ?? undefined,
    badge: toneFor(a.status),
  });

  return (
    <Panel title={t("p360.tabAppointments")}>
      {q.isLoading ? <Skeleton className="h-32 w-full" /> : (
        <>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("p360.upcoming")} ({upcoming.length})
          </p>
          <ClinicalList rows={upcoming.map(toRow)} loading={false}
            emptyTitle={t("p360.noUpcoming")} emptyHint={t("p360.noUpcomingHint")} />

          {past.length > 0 && (
            <>
              <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("p360.past")} ({past.length})
              </p>
              <ClinicalList rows={past.map(toRow)} loading={false}
                emptyTitle={t("p360.noPast")} emptyHint="" />
            </>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            <Link to="/appointments" className="underline underline-offset-2 hover:text-foreground">
              {t("p360.manageAppointments")}
            </Link>
          </p>
        </>
      )}
    </Panel>
  );
}
