import { usePrefs } from "@/hooks/usePrefs";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Waitlist from "@/pages/Waitlist";
import { api, errorMessage } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";

interface Appointment {
  id: string;
  code: string;
  patientName: string;
  doctorId: string | null;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  branchId: string;
}

interface Staff {
  id: string;
  name: string;
  role: string;
}

interface Patient {
  id: string;
  name: string;
  mrn: string;
}

const GRAD = "#54b648";

const statusFlow: Record<string, string[]> = {
  booked: ["confirmed", "cancelled", "no-show"],
  confirmed: ["checked-in", "cancelled", "no-show"],
  "checked-in": ["waiting", "cancelled"],
  waiting: ["in-progress", "cancelled"],
  "in-progress": ["completed"],
  completed: [],
  cancelled: [],
  "no-show": [],
};

const statusStyle: Record<
  string,
  { bg: string; color: string; labelKey?: string; label?: string }
> = {
  booked: {
    bg: "#f8fafc",
    color: "#64748b",
    labelKey: "st.booked",
  },
  confirmed: {
    bg: "#f0fdfa",
    color: "#0d9488",
    labelKey: "st.confirmed",
  },
  "checked-in": {
    bg: "#eff6ff",
    color: "#2563eb",
    labelKey: "st.checkedIn",
  },
  waiting: {
    bg: "#fffbeb",
    color: "#d97706",
    labelKey: "ap.waiting",
  },
  "in-progress": {
    bg: "#f5f3ff",
    color: "#7c3aed",
    labelKey: "st.inProgress",
  },
  completed: {
    bg: "#f0fdfa",
    color: "#0d9488",
    labelKey: "ap.completed",
  },
  cancelled: {
    bg: "#fff1f2",
    color: "#e11d48",
    labelKey: "st.cancelled",
  },
  "no-show": {
    bg: "#fffbeb",
    color: "#d97706",
    labelKey: "ap.noShow",
  },
};

function getBookingSlots(date: string): string[] {
  if (!date) return [];

  const day = new Date(`${date}T00:00:00`).getDay();
  const closingHour = day === 5 || day === 6 ? 17 : 21;
  const slots: string[] = [];

  for (
    let minutes = 10 * 60;
    minutes < closingHour * 60;
    minutes += 30
  ) {
    if (minutes >= 13 * 60 && minutes < 14 * 60) continue;

    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    slots.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  }

  return slots;
}

function malaysiaToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function malaysiaDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));

  value.setUTCDate(value.getUTCDate() + amount);

  return value.toISOString().slice(0, 10);
}

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(
    Date.UTC(year, month - 1, day),
  ).getUTCDay();
}

function getWeekDates(date: string): string[] {
  const start = addDays(
    date,
    -dayOfWeek(date),
  );

  return Array.from(
    { length: 7 },
    (_, index) =>
      addDays(start, index),
  );
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AppointmentCard({
  a,
  changeStatus,
}: {
  a: Appointment;
  changeStatus: { mutate: (vars: { id: string; status: string }) => void };
}) {
  const { t } = usePrefs();
  const st = statusStyle[a.status] ?? {
    bg: "#f8fafc",
    color: "#64748b",
    label: a.status,
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <b className="w-14 text-sm text-foreground">
        {a.scheduledTime.slice(0, 5)}
      </b>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">
          {a.patientName}
        </p>

        <p className="text-xs text-muted-foreground">
          {a.code}
        </p>
      </div>

      <span
        className="rounded-full px-3 py-1 text-[11px] font-bold"
        style={{
          background: st.bg,
          color: st.color,
        }}
      >
        {t(st.labelKey!)}
      </span>

      <div className="flex gap-1">
        {(statusFlow[a.status] ?? []).map((next) => (
          <button
            key={next}
            onClick={() =>
              changeStatus.mutate({
                id: a.id,
                status: next,
              })
            }
            className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground"
          >
            {t(statusStyle[next]?.labelKey ?? "") || next}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
 * Kartu MINGGU/SEHARI — versi VERTIKAL padat.
 *
 * Kartu biasa direka bentuk mendatar (masa | nama | badge | butang) dan
 * dipaksa masuk lajur minggu yang sempit: badge bertindih dengan teks, nama
 * terpotong jadi "AP r 0013", butang menyembul keluar lajur (tangkapan
 * layar pemilik 10 Okt). Versi ini susun menegak: masa + nama di atas,
 * badge penuh di baris sendiri, butang tindakan di bawah — semua muat
 * dalam lebar satu lajur minggu tanpa overflow.
 * ========================================================================== */
function AppointmentCardCompact({
  a,
  changeStatus,
}: {
  a: Appointment;
  changeStatus: { mutate: (vars: { id: string; status: string }) => void };
}) {
  const { t } = usePrefs();
  const st = statusStyle[a.status] ?? {
    bg: "#f8fafc",
    color: "#64748b",
    label: a.status,
  };

  return (
    <div className="mb-1.5 rounded-lg border border-border bg-card p-2">
      <div className="flex items-center justify-between gap-1">
        <b className="shrink-0 text-[11px] text-foreground">
          {a.scheduledTime.slice(0, 5)}
        </b>
        <span
          className="truncate rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: st.bg, color: st.color }}
        >
          {t(st.labelKey!)}
        </span>
      </div>
      <p className="mt-1 truncate text-[12px] font-semibold text-foreground" title={a.patientName}>
        {a.patientName}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">{a.code}</p>
      {(statusFlow[a.status] ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(statusFlow[a.status] ?? []).map((next) => (
            <button
              key={next}
              onClick={() => changeStatus.mutate({ id: a.id, status: next })}
              className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-accent"
            >
              {t(statusStyle[next]?.labelKey ?? "") || next}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BookingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = usePrefs();
  const { user } = useAuth();
  const qc = useQueryClient();

  /*
   * Carian pesakit terus ke database.
   * Ini menggantikan kaedah lama yang hanya
   * memuatkan 100 pesakit pertama.
   */
  const [patientSearch, setPatientSearch] =
    useState("");

  const [patientQuery, setPatientQuery] =
    useState("");

  const [
    selectedPatient,
    setSelectedPatient,
  ] = useState<Patient | null>(null);

  /*
   * Debounce supaya API tidak dipanggil
   * pada setiap keystroke terlalu cepat.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPatientQuery(
        patientSearch.trim(),
      );
    }, 300);

    return () =>
      window.clearTimeout(timer);
  }, [patientSearch]);

  const patients = useQuery({
    queryKey: [
      "patients",
      "appointment-search",
      patientQuery,
    ],

    queryFn: () => {
      const params =
        new URLSearchParams({
          limit: "50",
        });

      if (patientQuery.length >= 2) {
        params.set(
          "q",
          patientQuery,
        );
      }

      return api.get<Patient[]>(
        `/patients?${params.toString()}`,
      );
    },

    enabled:
      open &&
      (
        patientQuery.length === 0 ||
        patientQuery.length >= 2
      ),
  });

  const doctors = useQuery({
    queryKey: ["admin", "doctors"],
    queryFn: async () =>
      (
        await api.get<Staff[]>(
          "/admin/staff?role=doctor",
        )
      ).filter((s) => s.role === "doctor"),
    enabled: user?.role === "hq",
  });

  const [form, setForm] = useState({
    patientId: "",
    doctorId: "",
    scheduledDate: "",
    scheduledTime: "",
    notes: "",
  });

  /*
   * Backend telah melakukan carian
   * berdasarkan nama, MRN, telefon dan IC.
   */
  const filteredPatients =
    patients.data ?? [];

  const slots = getBookingSlots(
    form.scheduledDate,
  );

  const dayAppointments = useQuery({
    queryKey: [
      "appointments",
      "slots",
      form.scheduledDate,
    ],

    queryFn: () =>
      api.get<Appointment[]>(
        `/appointments?dateFrom=${form.scheduledDate}&dateTo=${form.scheduledDate}&limit=100`,
      ),

    enabled: Boolean(form.scheduledDate),
  });

  const occupiedSlots = new Set(
    (dayAppointments.data ?? [])
      .filter(
        (appointment) =>
          ![
            "cancelled",
            "no-show",
          ].includes(
            appointment.status,
          ),
      )
      .map((appointment) =>
        appointment.scheduledTime.slice(
          0,
          5,
        ),
      ),
  );

  const book = useMutation({
    mutationFn: () => {
      return api.post<Appointment>(
        "/appointments",
        {
          patientId:
            form.patientId,

          patientName:
            selectedPatient?.name ?? "",

          doctorId:
            form.doctorId || null,

          scheduledDate:
            form.scheduledDate,

          scheduledTime:
            form.scheduledTime,

          notes:
            form.notes || null,
        },
      );
    },

    onSuccess: () => {
      toast.success(
        t("ap.booked"),
      );

      qc.invalidateQueries({
        queryKey: ["appointments"],
      });

      /*
       * Kosongkan semula borang
       * selepas berjaya tempah.
       */
      setForm({
        patientId: "",
        doctorId: "",
        scheduledDate: "",
        scheduledTime: "",
        notes: "",
      });

      setPatientSearch("");
      setPatientQuery("");
      setSelectedPatient(null);

      onClose();
    },

    onError: (e: unknown) =>
      toast.error(
        errorMessage(
          e,
          t("ap.bookFailed"),
        ),
      ),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onClose}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("ap.newCta")}
          </DialogTitle>

          <DialogDescription>
            {t("ap.newCtaDesc")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();

            book.mutate();
          }}
        >
          {/* ============================= */}
          {/* PESAKIT + SEARCH */}
          {/* ============================= */}

          <div className="space-y-1.5">
            <Label>
              {t("ap.patientLabel")} *
            </Label>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                type="text"
                value={patientSearch}
                onChange={(e) => {
                  setPatientSearch(
                    e.target.value,
                  );

                  /*
                   * Jika staf mula menaip
                   * carian baru selepas memilih
                   * pesakit, kosongkan pilihan lama
                   * supaya tak tersalah tempah
                   * kepada pesakit sebelumnya.
                   */
                  if (form.patientId) {
                    setForm({
                      ...form,
                      patientId: "",
                    });

                    setSelectedPatient(
                      null,
                    );
                  }
                }}
                placeholder={t("ap.searchPatient")}
                className="pl-9"
                autoComplete="off"
              />
            </div>

            <Select
              value={form.patientId}
              onValueChange={(value) => {
                const selected = (
                  patients.data ?? []
                ).find(
                  (patient) =>
                    patient.id === value,
                );

                setForm({
                  ...form,
                  patientId: value,
                });

                setSelectedPatient(
                  selected ?? null,
                );

                /*
                 * Paparkan nama pesakit
                 * yang telah dipilih pada
                 * kotak carian.
                 */
                if (selected) {
                  setPatientSearch(
                    selected.name,
                  );
                }
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    patients.isLoading
                      ? t("ap.loadingPatients")
                      : t("ap.pickPatient")
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {filteredPatients.length >
                0 ? (
                  filteredPatients.map(
                    (patient) => (
                      <SelectItem
                        key={
                          patient.id
                        }
                        value={
                          patient.id
                        }
                      >
                        {patient.name}
                        {patient.mrn
                          ? ` (${patient.mrn})`
                          : ""}
                      </SelectItem>
                    ),
                  )
                ) : (
                  <div className="px-3 py-5 text-center text-sm text-muted-foreground">
                    Pesakit tidak
                    dijumpai
                  </div>
                )}
              </SelectContent>
            </Select>

            {patientSearch.trim() &&
              !form.patientId && (
                <p className="text-xs text-muted-foreground">
                  {
                    filteredPatients.length
                  }{" "}
                  pesakit dijumpai
                </p>
              )}

            {selectedPatient && (
              <div className="rounded-lg border border-border bg-accent px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Pesakit dipilih
                </p>

                <p className="text-sm font-semibold text-foreground">
                  {
                    selectedPatient.name
                  }
                  {selectedPatient.mrn
                    ? `, ${selectedPatient.mrn}`
                    : ""}
                </p>
              </div>
            )}
          </div>

          {/* ============================= */}
          {/* DOKTOR */}
          {/* ============================= */}

          <div className="space-y-1.5">
            <Label>
              {t("ap.doctorLabel")}
            </Label>

            <Select
              value={form.doctorId}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  doctorId: v,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("ap.setDoctor")} />
              </SelectTrigger>

              <SelectContent>
                {(doctors.data ?? []).map(
                  (d) => (
                    <SelectItem
                      key={d.id}
                      value={d.id}
                    >
                      {d.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {/* ============================= */}
          {/* TARIKH + MASA */}
          {/* ============================= */}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                {t("ap.dateLabel")} *
              </Label>

              <Input
                required
                type="date"
                value={
                  form.scheduledDate
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    scheduledDate:
                      e.target.value,

                    scheduledTime: "",
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("ap.timeLabel")} *
              </Label>

              <Select
                value={
                  form.scheduledTime
                }
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    scheduledTime: v,
                  })
                }
                disabled={
                  !form.scheduledDate
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      form.scheduledDate
                        ? t("ap.pickSlot")
                        : t("ap.pickDateFirst")
                    }
                  />
                </SelectTrigger>

                <SelectContent>
                  {slots.map(
                    (slot) => (
                      <SelectItem
                        key={slot}
                        value={slot}
                        disabled={occupiedSlots.has(
                          slot,
                        )}
                      >
                        {slot}
                        {occupiedSlots.has(
                          slot,
                        )
                          ? ", Penuh"
                          : ", Tersedia"}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("ap.hoursLine")}
          </p>

          {/* ============================= */}
          {/* NOTA */}
          {/* ============================= */}

          <div className="space-y-1.5">
            <Label>
              {t("ap.noteLabel")}
            </Label>

            <Input
              value={form.notes}
              onChange={(e) =>
                setForm({
                  ...form,
                  notes:
                    e.target.value,
                })
              }
            />
          </div>

          {/* ============================= */}
          {/* BUTTON */}
          {/* ============================= */}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>

            <Button
              type="submit"
              className="btn-brand"
              disabled={
                book.isPending ||
                !form.patientId ||
                !form.scheduledDate ||
                !form.scheduledTime
              }
            >
              {book.isPending
                ? t("ap.booking")
                : t("ap.bookCta")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Appointments() {
  const { t } = usePrefs();
  const { user } = useAuth();

  const qc = useQueryClient();

  const [page, setPage] =
    useState(1);

  const [
    showBook,
    setShowBook,
  ] = useState(false);

  const [view, setView] =
    useState<
      | "day"
      | "week"
      | "month"
      | "list"
      | "queue"
      | "waitlist"
    >("day");

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(() =>
    malaysiaToday(),
  );

  const pageSize = 20;

  const weekDates =
    getWeekDates(
      selectedDate,
    );

  const list = useQuery({
    queryKey: [
      "appointments",
      "list",
      page,
      view,
      selectedDate,
    ],

    queryFn: () => {
      const params =
        new URLSearchParams({
          limit: String(pageSize),
          offset: String(
            (page - 1) *
              pageSize,
          ),
        });

      if (view === "day") {
        params.set(
          "dateFrom",
          selectedDate,
        );
        params.set(
          "dateTo",
          selectedDate,
        );
      }

      if (view === "week") {
        params.set(
          "dateFrom",
          weekDates[0],
        );
        params.set(
          "dateTo",
          weekDates[6],
        );
      }

      return api.get<Appointment[]>(
        `/appointments?${params.toString()}`,
      );
    },
  });

  const changeStatus =
    useMutation({
      mutationFn: ({
        id,
        status,
      }: {
        id: string;
        status: string;
      }) =>
        api.patch(
          `/appointments/${id}/status`,
          {
            status,
          },
        ),

      onSuccess: () => {
        toast.success(
          t("ap.statusUpdated"),
        );

        qc.invalidateQueries({
          queryKey: [
            "appointments",
          ],
        });
      },

      onError: (
        e: unknown,
      ) =>
        toast.error(
          errorMessage(
            e,
            t("msg.updateFailedShort"),
          ),
        ),
    });

  const rows =
    list.data ?? [];

  const displayRows =
    view === "day"
      ? rows.filter(
          (appointment) =>
            malaysiaDateKey(appointment.scheduledDate) ===
            selectedDate,
        )
      : view === "week"
        ? rows.filter(
            (appointment) =>
              weekDates.includes(
                malaysiaDateKey(appointment.scheduledDate),
              ),
          )
        : rows;

  const hasMore =
    rows.length === pageSize;

  const canBook = [
    "hq",
    "branch_manager",
    "branch_admin",
    "receptionist",
  ].includes(
    user?.role ?? "",
  );

  const exportAppointments =
    () => {
      const header = [
        t("ap.colDate"),
        t("ap.colTime"),
        t("ap.colPatient"),
        "Kod",
        t("ap.colStatus"),
      ];

      const lines =
        displayRows.map(
          (appointment) => [
            appointment.scheduledDate,
            appointment.scheduledTime,
            appointment.patientName,
            appointment.code,
            statusStyle[appointment.status]?.labelKey
              ? t(statusStyle[appointment.status]!.labelKey!)
              : appointment.status,
          ],
        );

      /* Escaping, BOM and download plumbing now live in `lib/csv.ts`, shared with
       * the Reports and Finance exports. Behaviour is unchanged — the helper is
       * the same code that used to sit inline here, with a test on it. */
      downloadCsv(
        `appointments-${selectedDate}.csv`,
        [header, ...lines],
      );

      toast.success(
        t("msg.exportDone"),
      );
    };

  return (
    <div
      className="space-y-6"
      style={{
        animation:
          "fadeIn .25s ease",
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            className="text-[24px] font-bold"
            style={{
              color: "hsl(var(--foreground))",

              fontFamily:
                "'Outfit', sans-serif",
            }}
          >
            {t("ap.title")}
          </h1>

          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("ap.subtitle", { n: displayRows.length })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={
              exportAppointments
            }
            className="rounded-full border border-border bg-card px-4 py-2.5 text-[13px] font-semibold text-muted-foreground"
          >
            Export
          </button>

          {canBook && (
            <button
              onClick={() =>
                setShowBook(
                  true,
                )
              }
              className="btn-brand inline-flex items-center gap-2 px-4 py-2.5"
            >
              <CalendarPlus className="h-4 w-4" />

              {t("ap.newCta")}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                "day",
                "week",
                "month",
                "list",
                "queue",
                "waitlist",
              ] as const
            ).map(
              (item) => (
                <button
                  key={
                    item
                  }
                  onClick={() =>
                    setView(
                      item,
                    )
                  }
                  className="rounded-md border px-4 py-2 text-[13px] font-semibold capitalize transition"
                  style={
                    view ===
                    item
                      ? {
                          background:
                            GRAD,

                          borderColor:
                            "transparent",

                          color:
                            "white",
                        }
                      : {
                          /* Inactive pill: theme tokens, not hardcoded white —
                           * white pills leaked light-mode into dark. */
                          background: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          color: "hsl(var(--muted-foreground))",
                        }
                  }
                >
                  {t(
                    `ap.view.${item}`,
                  )}
                </button>
              ),
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-border bg-card px-3 py-2 text-muted-foreground"
              onClick={() =>
                setSelectedDate(
                  addDays(
                    selectedDate,
                    -1,
                  ),
                )
              }
            >
              ‹
            </button>

            <span className="min-w-[120px] text-center text-sm font-semibold text-muted-foreground">
              {
                selectedDate
              }
            </span>

            <button
              className="rounded-full border border-border bg-card px-3 py-2 text-muted-foreground"
              onClick={() =>
                setSelectedDate(
                  addDays(
                    selectedDate,
                    1,
                  ),
                )
              }
            >
              ›
            </button>

            <button
              className="rounded-full border border-border bg-card px-4 py-2 text-[13px] font-semibold text-muted-foreground"
              onClick={() =>
                setSelectedDate(
                  malaysiaToday(),
                )
              }
            >
              Today
            </button>
          </div>
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({
            length: 6,
          }).map(
            (_, i) => (
              <Skeleton
                key={i}
                className="h-20 w-full rounded-lg"
              />
            ),
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-foreground">
            {view ===
            "day"
              ? `Day Schedule, ${dateLabel(
                  selectedDate,
                )}`
              : view ===
                  "week"
                ? "Week View"
                : view ===
                    "month"
                  ? `Month View, ${selectedDate.slice(
                      0,
                      7,
                    )}`
                  : view ===
                      "list"
                    ? "List View"
                    : view ===
                      "waitlist"
                    ? t("wl.title")
                    : "Today's Queue"}
          </h2>

          {view ===
          "waitlist" ? (
            /* The waitlist IS appointments work — one screen, one mental model.
             * The component stays its own file; only the view is embedded. */
            <Waitlist />
          ) : view ===
          "month" ? (
            <div className="grid grid-cols-7 gap-2">
              {Array.from(
                {
                  length:
                    35,
                },
                (
                  _,
                  i,
                ) => {
                  const d =
                    new Date(
                      `${selectedDate.slice(
                        0,
                        7,
                      )}-01T00:00:00`,
                    );

                  d.setDate(
                    i -
                      d.getDay() +
                      1,
                  );

                  const key =
                    `${d.getFullYear()}-${String(
                      d.getMonth() + 1,
                    ).padStart(2, "0")}-${String(
                      d.getDate(),
                    ).padStart(2, "0")}`;

                  const items =
                    rows.filter(
                      (
                        a,
                      ) =>
                        malaysiaDateKey(a.scheduledDate) ===
                        key,
                    );

                  return (
                    <div
                      key={
                        i
                      }
                      className="min-h-24 rounded-xl border border-border p-2"
                    >
                      <b className="text-xs text-muted-foreground">
                        {d.getMonth() ===
                        new Date(
                          `${selectedDate.slice(
                            0,
                            7,
                          )}-01T00:00:00`,
                        ).getMonth()
                          ? d.getDate()
                          : ""}
                      </b>

                      {items.map(
                        (
                          a,
                        ) => (
                          <p
                            key={
                              a.id
                            }
                            className="mt-1 truncate rounded bg-accent px-1 text-[10px] text-foreground"
                          >
                            {a.scheduledTime.slice(
                              0,
                              5,
                            )}{" "}
                            {
                              a.patientName
                            }
                          </p>
                        ),
                      )}
                    </div>
                  );
                },
              )}
            </div>
          ) : view ===
            "week" ? (
            <div className="overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-7 gap-2">
              {weekDates.map(
                (d) => (
                  <div
                    key={
                      d
                    }
                    className="min-h-40 rounded-xl border border-border p-2"
                  >
                    <p className="mb-2 text-center text-xs font-bold text-muted-foreground">
                      {dateLabel(
                        d,
                      )}
                    </p>

                    {rows
                      .filter(
                        (
                          a,
                        ) =>
                          malaysiaDateKey(a.scheduledDate) ===
                          d,
                      )
                      .map(
                        (
                          a,
                        ) => (
                          <AppointmentCardCompact
                            key={
                              a.id
                            }
                            a={
                              a
                            }
                            changeStatus={
                              changeStatus
                            }
                          />
                        ),
                      )}
                  </div>
                ),
              )}
            </div>
            </div>
          ) : view ===
            "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="p-3">
                      Time
                    </th>

                    <th className="p-3">
                      Patient
                    </th>

                    <th className="p-3">
                      MRN /
                      Code
                    </th>

                    <th className="p-3">
                      Doctor
                    </th>

                    <th className="p-3">
                      Status
                    </th>

                    <th className="p-3">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {displayRows.map(
                    (
                      a,
                    ) => (
                      <tr
                        key={
                          a.id
                        }
                        className="border-b border-border"
                      >
                        <td className="p-3 font-semibold">
                          {a.scheduledTime.slice(
                            0,
                            5,
                          )}
                        </td>

                        <td className="p-3 font-semibold">
                          {
                            a.patientName
                          }
                        </td>

                        <td className="p-3 text-muted-foreground">
                          {
                            a.code
                          }
                        </td>

                        <td className="p-3">
                          {a.doctorId
                            ? "Assigned"
                            : "—"}
                        </td>

                        <td className="p-3">
                          {statusStyle[a.status]?.labelKey
                          ? t(statusStyle[a.status]!.labelKey!)
                          : a.status}
                        </td>

                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {(statusFlow[a.status] ?? []).map((next) => (
                              <button
                                key={next}
                                onClick={() => changeStatus.mutate({ id: a.id, status: next })}
                                className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                              >
                                {t(statusStyle[next]?.labelKey ?? "") || next}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {displayRows
                .filter(
                  (
                    a,
                  ) =>
                    view ===
                    "queue"
                      ? [
                          "checked-in",
                          "waiting",
                          "in-progress",
                        ].includes(
                          a.status,
                        )
                      : malaysiaDateKey(a.scheduledDate) ===
                        selectedDate,
                )
                .map(
                  (
                    a,
                  ) => (
                    <AppointmentCard
                      key={
                        a.id
                      }
                      a={
                        a
                      }
                      changeStatus={
                        changeStatus
                      }
                    />
                  ),
                )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("ap.pageN", { n: page })}
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={
              page <= 1
            }
            onClick={() =>
              setPage(
                page - 1,
              )
            }
          >
            <ChevronLeft className="h-4 w-4" />

            {t("pt.previous")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={
              !hasMore
            }
            onClick={() =>
              setPage(
                page + 1,
              )
            }
          >
            {t("pt.next")}

            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <BookingDialog
        open={showBook}
        onClose={() =>
          setShowBook(
            false,
          )
        }
      />
    </div>
  );
}
