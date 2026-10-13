import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader, StatusBadge, Panel, EmptyState } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtDateTime, age, initials } from "@/lib/format";
import { fmtShortDate } from "@/lib/dateFormat";
import {
  Phone, Mail, ArrowLeft, Activity, CalendarDays, ShieldAlert, ClipboardList, Wallet,
  FileSignature, Printer, FileText, Pill, AlertTriangle, Send, Image as ImageIcon, FlaskConical, Users,
} from "lucide-react";
import AllergyPanel, { AllergyBanner } from "@/components/clinical/AllergyPanel";
import TreatmentPlanPanel from "@/components/clinical/TreatmentPlanPanel";
import { PaymentPlanPanel } from "@/components/finance/PaymentPlanPanel";
import ConsentPanel from "@/components/clinical/ConsentPanel";
import { canWriteClinical, canEditPlan, canIssueForm, canManageMasterData, canEditPatient } from "@/lib/permissions";
import { usePrefs } from "@/hooks/usePrefs";
import IssueFormPanel from "@/components/clinical/IssueFormPanel";
import { FamilyPanel } from "@/components/patients/FamilyPanel";
import {
  EncountersPanel, ChartPanel, PrescriptionsPanel, AdversePanel,
  ReferralsPanel, ImagingPanel, LabPanel, AppointmentsPanel,
} from "@/components/clinical/PatientClinicalPanels";
import { useAuth } from "@/hooks/useAuth";

interface Patient {
  id: string; mrn: string; name: string; phone: string | null; email: string | null;
  dob: string | null; gender: string | null; status: string; createdAt: string;
}
interface TimelineEvent {
  id: string; type: string; summary: string; createdAt: string; actorRole?: string;
  /* Which feed the line came from. The two use different vocabularies
   * (`registration` vs `encounter_created`), so the UI would otherwise have to guess
   * from the type string — and would mislabel anything it did not recognise. */
  source?: "patient" | "clinical";
}

export default function Patient360() {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const { id } = useParams();
  const patient = useQuery({ queryKey: ["patients", id], queryFn: () => api.get<Patient>(`/patients/${id}`), enabled: !!id });
  const timeline = useQuery({
    /* `limit` is explicit: the API caps the MERGED feed, so asking for more is how a
     * long-standing patient's early history (registration) stays in the list — the
     * default would push it off the end. */
    queryKey: ["patients", id, "timeline"],
    queryFn: () => api.get<TimelineEvent[]>(`/patients/${id}/timeline?limit=200`),
    enabled: !!id,
  });
  const events = timeline.data ?? [];
  /* Oldest event = when the relationship with the clinic began. Shown in the header so
   * the span of the history is visible without scrolling to the bottom. */
  const first = events.length ? events[events.length - 1] : null;

  /* Event colour by SOURCE, not by type. There are 8+ clinical types and the list
   * grows; a per-type palette would need editing every time the backend adds one.
   * Two sources cover every line, and the legend explains them once. */
  const eventStyle: Record<string, { dot: string; tag: string; label: string }> = {
    patient:  { dot: "bg-emerald-500", tag: "bg-emerald-50 text-emerald-700 border-emerald-200", label: t("journey.registration") },
    clinical: { dot: "bg-sky-500",     tag: "bg-sky-50 text-sky-700 border-sky-200",             label: t("journey.clinical") },
  };
  const styleOf = (src?: string) => eventStyle[src ?? "clinical"] ?? eventStyle.clinical;

  if (patient.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (!patient.data) return <EmptyState title={t("p360.notFound")} />;
  const p = patient.data;

  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title={p.name}
        description={`${p.mrn} · Registered ${fmtDate(p.createdAt)}`}
        actions={<Link to="/patients"><span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-emerald-600"><ArrowLeft className="h-4 w-4" />{t("p360.back")}</span></Link>}
      />

      {/* Safety surface: rendered whether or not the allergy tab is ever opened.
          Null for a patient with no blocking allergy, so it is not wallpaper. */}
      {id && <AllergyBanner patientId={id} />}

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16"><AvatarFallback className="bg-primary text-primary-foreground text-xl">{initials(p.name)}</AvatarFallback></Avatar>
            <div>
              <p className="text-lg font-bold text-foreground">{p.name}</p>
              <p className="text-sm text-muted-foreground">{age(p.dob)} · {p.gender ?? "—"}</p>
              <div className="mt-1.5"><StatusBadge status={p.status === "Active" ? "completed" : "cancelled"} /></div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-4 min-w-[280px]">
            <div className="flex items-start gap-2.5">
              <Phone className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-[11px] text-muted-foreground uppercase font-medium">Phone</p><p className="text-sm font-medium text-foreground truncate">{p.phone ?? "—"}</p></div>
            </div>
            <div className="flex items-start gap-2.5">
              <Mail className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-[11px] text-muted-foreground uppercase font-medium">Email</p><p className="text-sm font-medium text-foreground truncate">{p.email ?? "—"}</p></div>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="journey">
        <TabsList className="bg-card border-border">
          <TabsTrigger value="journey"><Activity className="h-3.5 w-3.5 mr-1.5" />Journey</TabsTrigger>
          <TabsTrigger value="appointments"><CalendarDays className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabAppointmentsPlain")}</TabsTrigger>
          <TabsTrigger value="plans"><ClipboardList className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabPlansPlain")}</TabsTrigger>
          <TabsTrigger value="payments"><Wallet className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabPayments")}</TabsTrigger>
          <TabsTrigger value="encounters"><FileText className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabEncounters")}</TabsTrigger>
          <TabsTrigger value="chart"><Activity className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabChart")}</TabsTrigger>
          <TabsTrigger value="prescriptions"><Pill className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabPrescriptions")}</TabsTrigger>
          <TabsTrigger value="adverse"><AlertTriangle className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabAdverse")}</TabsTrigger>
          <TabsTrigger value="referrals"><Send className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabReferrals")}</TabsTrigger>
          <TabsTrigger value="imaging"><ImageIcon className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabImaging")}</TabsTrigger>
          <TabsTrigger value="lab"><FlaskConical className="h-3.5 w-3.5 mr-1.5" />{t("p360.tabLab")}</TabsTrigger>
          <TabsTrigger value="family"><Users className="h-3.5 w-3.5 mr-1.5" />{t("family.tab")}</TabsTrigger>
          <TabsTrigger value="forms"><Printer className="h-3.5 w-3.5 mr-1.5" />{t("form.title")}</TabsTrigger>
          <TabsTrigger value="consent"><FileSignature className="h-3.5 w-3.5 mr-1.5" />{t("consent.title")}</TabsTrigger>
          <TabsTrigger value="allergies"><ShieldAlert className="h-3.5 w-3.5 mr-1.5" />{t("allergy.title")}</TabsTrigger>
        </TabsList>

        <TabsContent value="journey" className="mt-4">
          <Panel title={t("journey.title")}>
            {timeline.isLoading && <Skeleton className="h-40 w-full" />}

            {!timeline.isLoading && (
              <>
                {/* A count and a legend first: the reader needs to know the history is
                    COMPLETE before reading it. A list with no total reads like a page
                    that failed to load more. */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{events.length}</span>{" "}
                    {t("journey.count")}
                    {first && <span className="ml-2 text-xs">{t("journey.since")} {fmtShortDate(lang, first.createdAt)}</span>}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />{t("journey.registration")}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-sky-500" />{t("journey.clinical")}
                    </span>
                  </div>
                </div>

                <div className="relative max-h-[520px] space-y-5 overflow-y-auto pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-px before:bg-border">
                  {events.map((ev) => {
                    const st = styleOf(ev.source);
                    return (
                      <div key={ev.id} className="relative flex gap-4">
                        <div className={`absolute -left-6 top-1 h-4 w-4 rounded-full ring-4 ring-card ${st.dot}`} />
                        <div className="flex-1 pb-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{ev.summary}</p>
                            <span className="text-xs text-muted-foreground">{fmtDateTime(ev.createdAt)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.tag}`}>
                              {st.label}
                            </span>
                            <span className="text-xs capitalize text-muted-foreground">
                              {t(`evt.${ev.type ?? "event"}`)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!events.length && <EmptyState title={t("journey.empty")} description={t("journey.emptyHint")} />}
              </>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="appointments" className="mt-4">
          {/* Was a placeholder saying a per-patient appointments endpoint was a future
              refinement. It is not: `GET /appointments?patientId=` returns 14 rows today.
              The endpoint existed and never got a caller. */}
          {id && <AppointmentsPanel patientId={id} />}
        </TabsContent>

        <TabsContent value="encounters" className="mt-4">
          {id && <EncountersPanel patientId={id} />}
        </TabsContent>

        <TabsContent value="chart" className="mt-4">
          {id && <ChartPanel patientId={id} canEdit={canWriteClinical(user?.role)} />}
        </TabsContent>

        <TabsContent value="prescriptions" className="mt-4">
          {id && <PrescriptionsPanel patientId={id} />}
        </TabsContent>

        <TabsContent value="adverse" className="mt-4">
          {id && <AdversePanel patientId={id} />}
        </TabsContent>

        <TabsContent value="referrals" className="mt-4">
          {id && <ReferralsPanel patientId={id} canEdit={canWriteClinical(user?.role)} />}
        </TabsContent>

        <TabsContent value="imaging" className="mt-4">
          {id && <ImagingPanel patientId={id} />}
        </TabsContent>

        <TabsContent value="lab" className="mt-4">
          {id && <LabPanel patientId={id} />}
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <Panel>
            {/* Plans need an ENCOUNTER to be created (the write path requires one),
                but READING a patient's plans does not, so the panel is shown to
                every role and offers "new" only to a doctor. */}
            {id && <TreatmentPlanPanel patientId={id} canEdit={canEditPlan(user?.role)} />}
          </Panel>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <Panel>
            {/* P4: the patient's instalment plans. Reading needs finance:view; the
                money actions inside are gated by role server-side too, the panel is
                shown, the buttons are not, for roles that cannot move money. */}
            {id && <PaymentPlanPanel patientId={id} />}
          </Panel>
        </TabsContent>

        <TabsContent value="family" className="mt-4">
          {id && <FamilyPanel patientId={id} patientName={p.name} canEdit={canEditPatient(user?.role)} />}
        </TabsContent>

        <TabsContent value="forms" className="mt-4">
          <Panel>
            {/* Issuing is a doctor/counter act with branch scope: the panel is shown to
                everyone so the patient's issued forms are visible, and the issue control
                appears only where the role can use it. */}
            {id && (
              <IssueFormPanel
                patientId={id}
                patientName={p.name}
                patientMrn={p.mrn}
                branchName={""}
                canIssue={canIssueForm(user?.role)}
              />
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="consent" className="mt-4">
          <Panel>
            {/* Consent is INSERT-only (ADR-009): the screen offers record + print and
                deliberately no edit/delete. Only a doctor may record (`assertDoctor`);
                only HQ may add a template (`assertHq`). */}
            {id && (
              <ConsentPanel
                patientId={id}
                patientName={p.name}
                patientMrn={p.mrn}
                canWrite={canWriteClinical(user?.role)}
                isHq={canManageMasterData(user?.role)}
                clinicName={t("consent.clinicName")}
              />
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="allergies" className="mt-4">
          <Panel>
            {/* `canEdit` is the role that may WRITE: per ROLE_DOMAIN_MATRIX
                `clinical:create` is the doctor role alone. Showing the button to a
                role the server will refuse is a control that fails on submit. */}
            {id && <AllergyPanel patientId={id} canEdit={canWriteClinical(user?.role)} />}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
