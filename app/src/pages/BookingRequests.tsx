import { usePrefs } from "@/hooks/usePrefs";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, MessageSquare, Moon, Stethoscope, Sun, User } from "lucide-react";

import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/shared";

/**
 * Rekod Booking AI — what the WhatsApp assistant booked, and when.
 *
 * WHAT THIS SCREEN IS, AND IS NOT
 *
 * It is NOT a work queue. The AI books end to end — patient, appointment,
 * confirmation — so nothing arrives `pending` and there is nothing to approve.
 * The Confirm/Reject buttons that used to live here approved a decision that had
 * already been made, and on the confirm path sent the patient "DISAHKAN" without
 * creating the appointment. That path is gone.
 *
 * It IS the receipt. Three things live only here:
 *
 *   1. WHEN the patient asked. A booking taken at 1:47am is the clinic's whole
 *      advantage over one that opens at nine, and an appointment row cannot show
 *      it — an appointment has a date, not a moment of arrival.
 *   2. WHAT the patient said, in their own words. Nobody should have to open the
 *      WhatsApp Hub and scroll a chat to answer "what did they ask for?".
 *   3. WHAT WAS BOOKED — the doctor and the appointment code, read back from the
 *      appointment itself rather than from the request, because those can differ
 *      (the patient asked for 3pm and took 3:30).
 *
 * Deliberately short: complaint, time, doctor. That is the list the clinic asked
 * for, and the full conversation is one click away in WhatsApp Hub when it is
 * actually needed.
 */

interface BookingRecord {
  id: string;
  contact_phone: string;
  patient_name: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  treatment: string | null;
  branch_name: string | null;
  raw_message: string | null;
  status: string;
  created_at: string;
  linkedAppointmentId: string | null;
  appointmentCode: string | null;
  doctor_name: string | null;
}

/** Clinic hours from the booking prompt: outside these is the telling number. */
const OPEN_HOUR = 9;
const CLOSE_HOUR = 21;

function outsideHours(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getHours();
  return h < OPEN_HOUR || h >= CLOSE_HOUR;
}

function whenLabel(iso: string, lang: "ms" | "en" = "ms"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const loc = lang === "ms" ? "ms-MY" : "en-GB";
  const day = d.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${time} · ${day}`;
}

export default function BookingRequests() {
  const { t, lang } = usePrefs();
  const { data, isLoading } = useQuery({
    queryKey: ["booking-requests"],
    queryFn: () => api.get<BookingRecord[]>("/booking-requests"),
  });

  const rows = data ?? [];
  const night = rows.filter((r) => outsideHours(r.created_at)).length;
  const linked = rows.filter((r) => r.linkedAppointmentId).length;
  const unlinked = rows.length - linked;

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <BackLink to="/appointments" />
      </div>
      <div>
        <h2 className="text-xl font-extrabold text-foreground">{t("br.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("br.subtitle")}
        </p>
      </div>

      {/* Ringkasan, "luar waktu" ialah nombor yang penting. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<CalendarDays className="h-5 w-5" />}
          label={t("br.statRecorded")}
          value={rows.length}
          tint="teal"
        />
        <Stat
          icon={<Moon className="h-5 w-5" />}
          label={t("br.statAfterHours", { o: OPEN_HOUR, c: CLOSE_HOUR - 12 })}
          value={night}
          tint="blue"
        />
        <Stat
          icon={<Stethoscope className="h-5 w-5" />}
          label={unlinked > 0 ? t("br.unlinked", { n: unlinked }) : t("br.allLinked")}
          value={linked}
          tint={unlinked > 0 ? "amber" : "slate"}
        />
      </div>

      {/* Apa yang pembantu buat, bukan apa yang pesakit taip. */}
      <div className="rounded-lg border border-border bg-accent/60 px-5 py-4">
        <p className="text-sm font-semibold text-foreground">
          {t("br.autoLine1")}
        </p>
        <p className="mt-1 text-xs text-foreground">
          {t("br.autoLine2")}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-foreground">
            <MessageSquare className="h-6 w-6" />
          </div>
          <p className="font-semibold text-foreground">{t("br.none")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("br.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((b) => {
            const night = outsideHours(b.created_at);
            return (
              <div
                key={b.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                        night ? "bg-indigo-50 text-indigo-600" : "bg-accent text-foreground"
                      }`}
                      title={night ? t("br.afterHoursTip") : undefined}
                    >
                      {night ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-[15px] text-foreground">
                        {b.patient_name || "(tiada nama)"}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {b.contact_phone}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {whenLabel(b.created_at, lang)}
                        </span>
                      </p>
                    </div>
                  </div>

                  {b.linkedAppointmentId ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-[11px] font-bold text-foreground">
                      <Stethoscope className="h-3 w-3" />
                      {b.appointmentCode ?? t("br.created")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                      Tiada appointment
                    </span>
                  )}
                </div>

                {/* Tiga fakta yang clinic minta: sakit apa, pukul berapa, doktor siapa. */}
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Fact label={t("br.treatment")} value={b.treatment} />
                  <Fact
                    label={t("br.requested")}
                    value={
                      b.preferred_date || b.preferred_time
                        ? [b.preferred_date, b.preferred_time].filter(Boolean).join(" · ")
                        : null
                    }
                  />
                  <Fact label={t("br.doctor")} value={b.doctor_name} />
                </div>

                {b.raw_message && (
                  <p className="mt-3 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
                    “{b.raw_message.slice(0, 180)}{b.raw_message.length > 180 ? "…" : ""}”
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-muted px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

function Stat({
  icon, label, value, tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tint: "teal" | "blue" | "amber" | "slate";
}) {
  const tones = {
    teal: "bg-accent text-foreground",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-muted text-muted-foreground",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className={`inline-flex rounded-xl p-2.5 ${tones[tint]}`}>{icon}</div>
      <p className="mt-3 text-2xl font-extrabold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
