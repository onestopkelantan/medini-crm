import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { usePrefs } from "@/hooks/usePrefs";
import { Panel, EmptyState, StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CalendarClock, Clock, UserCheck, Ban, AlertTriangle, Coffee, Timer } from "lucide-react";
import { useState } from "react";

/* ============================================================================
 * AiBookingPanels — apa yang AI TAHU semasa menempah temujanji.
 *
 * KONTEKS YANG J UJUR (baca ini sebelum mengubah apa-apa di sini)
 *
 * Dua enjin menentukan cara AI menempah, dan kedua-duanya dipanggil dari webhook
 * WhatsApp dengan benar-benar:
 *
 *   slot-finder.ts        (250 baris) — mencari slot yang BENAR-BENAR kosong
 *   doctor-continuity.ts  (212 baris) — doktor mana yang pesakit biasa jumpa
 *
 * TETAPI: nilai yang mengawalnya (tempoh temujanji, jarak slot, berapa pilihan
 * ditawarkan, waktu rehat) adalah MALAR dalam kod — bukan tetapan yang disimpan.
 * Webhook menghantar `limit: 2`, dan slot-finder memakai 30 minit + rehat
 * 13:00–14:00 secara lalai.
 *
 * Jadi panel ini READ-ONLY dengan sengaja. Ia memberitahu operator APA yang AI
 * akan lakukan hari ini, supaya tingkah laku itu tidak lagi tersembunyi. Ia
 * TIDAK berpura-pura boleh mengubahnya — memaparkan input yang tidak disimpan
 * adalah lebih teruk daripada tiada input: operator menaip, menekan Simpan, dan
 * tiada apa-apa berubah tanpa penjelasan.
 * ========================================================================== */

interface BookingRecord {
  id: string; contactPhone?: string; patientName?: string | null;
  preferredDate?: string | null; preferredTime?: string | null;
  treatment?: string | null; branchName?: string | null; status: string;
  createdAt?: string; appointmentCode?: string | null; doctorName?: string | null;
}

/** Nilai yang diguna pakai slot-finder, dinyatakan dari kod supaya operator nampak. */
const SLOT_BEHAVIOUR = [
  { key: "ai.bk.duration", value: "30 min", icon: <Timer className="h-4 w-4" /> },
  { key: "ai.bk.step", value: "30 min", icon: <Clock className="h-4 w-4" /> },
  { key: "ai.bk.offered", value: "2", icon: <CalendarClock className="h-4 w-4" /> },
  { key: "ai.bk.break", value: "13:00 – 14:00", icon: <Coffee className="h-4 w-4" /> },
];

export function BookingBehaviourPanel() {
  const { t } = usePrefs();
  return (
    <Panel title={t("ai.bk.behaviour")} subtitle={t("ai.bk.behaviourHint")} className="glass-card bg-card border border-border shadow-sm rounded-lg p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SLOT_BEHAVIOUR.map((b) => (
          <div key={b.key} className="rounded-xl border border-border bg-accent/30 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {b.icon}{t(b.key)}
            </div>
            <p className="mt-1 text-lg font-bold text-foreground">{b.value}</p>
          </div>
        ))}
      </div>

      {/* AMARAN JUJUR: nilai-nilai di atas ialah MALAR dalam kod hari ini. */}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <div className="text-amber-800 dark:text-amber-200">
          <p className="font-medium">{t("ai.bk.readOnlyTitle")}</p>
          <p className="mt-0.5">{t("ai.bk.readOnlyHint")}</p>
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-start gap-2">
          <UserCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" />
          <div>
            <p className="font-medium text-foreground">{t("ai.bk.continuityTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("ai.bk.continuityHint")}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Ban className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">{t("ai.bk.neverInventTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("ai.bk.neverInventHint")}</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function BookingRecordsPanel() {
  const { t } = usePrefs();
  const [status, setStatus] = useState("");
  const bookings = useQuery({
    queryKey: ["ai", "bookings", status],
    queryFn: () => api.get<BookingRecord[]>(`/booking-requests${status ? `?status=${status}` : ""}`),
  });
  const rows = bookings.data ?? [];
  return (
    <Panel
      title={t("ai.bk.records")}
      subtitle={t("ai.bk.recordsHint")}
      className="glass-card bg-card border border-border shadow-sm rounded-lg p-5"
      action={
        <div className="flex gap-1">
          {["", "confirmed", "pending", "rejected"].map((s) => (
            <Button key={s || "all"} size="sm" variant={status === s ? "default" : "outline"}
              className={`text-xs rounded-xl ${status === s ? "bg-primary text-primary-foreground" : "border-border text-foreground"}`}
              onClick={() => setStatus(s)}>
              {s === "" ? t("ai.bk.all") : s}
            </Button>
          ))}
        </div>
      }
    >
      {bookings.isLoading && <Skeleton className="h-40 w-full" />}
      {bookings.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(bookings.error, t("ai.loadFailed"))}</p>}
      <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
        {rows.map((b) => (
          <div key={b.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{b.patientName ?? b.contactPhone ?? "—"}</p>
              <StatusBadge status={b.status} className="rounded-full px-3 py-1 text-xs" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {b.preferredDate ?? "—"} {b.preferredTime ?? ""}{b.treatment ? ` · ${b.treatment}` : ""}
              {b.branchName ? ` · ${b.branchName}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {b.doctorName ? `${t("ai.bk.doctor")} ${b.doctorName}` : t("ai.bk.noDoctor")}
              {b.appointmentCode ? ` · ${b.appointmentCode}` : ""}
              {b.createdAt ? ` · ${new Date(b.createdAt).toLocaleString()}` : ""}
            </p>
          </div>
        ))}
        {bookings.isSuccess && !rows.length && (
          <EmptyState title={t("ai.bk.noRecords")} description={t("ai.bk.noRecordsHint")} icon={<CalendarClock className="h-5 w-5" />} />
        )}
      </div>
    </Panel>
  );
}
