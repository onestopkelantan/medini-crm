/**
 * ToothChartPanel — the Chart tab inside Clinical (Fasa 1B).
 *
 * WHY A PATIENT PICKER AND NOT "THE CHART OF THE ENCOUNTER"
 *
 * The chart is CONTINUOUS per patient (the user's decision): a dentist wants to
 * see the mouth as it stands today, not one visit's snapshot. But a dentist
 * arrives at this screen from a visit, so the panel accepts an active encounter
 * and uses it as the WRITE target — that is the discipline the backend keeps
 * (`tooth_records.encounter_id` is NOT NULL and every change is a dated event).
 *
 * Read = patient-level. Write = encounter-level. That split is the whole design,
 * and getting it backwards would either lose the audit trail or show a dentist
 * only the teeth charted in the last twenty minutes.
 *
 * The patient list is deliberately the SAME endpoint and shape Patients.tsx
 * uses, so a patient the user can find there is one they can chart here.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToothChart from "@/components/clinical/ToothChart";

interface PatientRow {
  id: string; mrn: string; name: string; dob: string | null;
}

interface Props {
  /** When a doctor has an encounter open, charting writes to it. */
  encounterId?: string | null;
  /** The patient that encounter belongs to, if one is open. */
  encounterPatientId?: string | null;
  canEdit?: boolean;
}

export default function ToothChartPanel({ encounterId, encounterPatientId, canEdit }: Props) {
  const { t } = usePrefs();
  const [picked, setPicked] = useState<string>("");

  /* Only needed when no encounter is open — this is the "chart any patient"
   * path, which is how a receptionist or a dentist between visits works. */
  const patients = useQuery({
    queryKey: ["patients", "for-chart"],
    queryFn: () => api.get<PatientRow[]>("/patients?limit=200"),
    enabled: !encounterPatientId,
    staleTime: 60_000,
  });

  const patientId = encounterPatientId ?? picked;

  const selected = useMemo(
    () => (patients.data ?? []).find((p) => p.id === patientId) ?? null,
    [patients.data, patientId],
  );

  if (!patientId) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{t("chart.selectPatient")}</p>
        {patients.isLoading ? (
          <Skeleton className="h-10 w-full max-w-md" />
        ) : (
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger className="max-w-md rounded-lg">
              <SelectValue placeholder={t("chart.selectPatient")} />
            </SelectTrigger>
            <SelectContent>
              {(patients.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.mrn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {encounterPatientId ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {selected ? `${selected.name} · ${selected.mrn}` : "…"}
          </span>
          {/* PEMILIH PESAKIT SENTIASA KELIHATAN (aduan pemilik: susah tukar
           * pesakit selepas satu dipilih). Dropdown sebenar - segera, tiada
           * langkah tambahan. */}
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger className="max-w-xs rounded-lg">
              <SelectValue placeholder={t("chart.selectPatient")} />
            </SelectTrigger>
            <SelectContent>
              {(patients.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.mrn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Charting needs an open encounter: every change is a dated clinical
          event, and without one there is nothing to attribute it to. Say so
          plainly rather than letting the Save button fail on submit. */}
      {canEdit && !encounterId && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("chart.openEncounterFirst")}
        </p>
      )}

      <ToothChart patientId={patientId} encounterId={encounterId} canEdit={canEdit && !!encounterId} />
    </div>
  );
}
