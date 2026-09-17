import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
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

const GRAD = "linear-gradient(135deg, #0DC9B7, #12B5E5)";

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
  { bg: string; color: string; label: string }
> = {
  booked: {
    bg: "#f8fafc",
    color: "#64748b",
    label: "Ditempah",
  },
  confirmed: {
    bg: "#f0fdfa",
    color: "#0d9488",
    label: "Disahkan",
  },
  "checked-in": {
    bg: "#eff6ff",
    color: "#2563eb",
    label: "Daftar Masuk",
  },
  waiting: {
    bg: "#fffbeb",
    color: "#d97706",
    label: "Menunggu",
  },
  "in-progress": {
    bg: "#f5f3ff",
    color: "#7c3aed",
    label: "Sedang Rawat",
  },
  completed: {
    bg: "#f0fdfa",
    color: "#0d9488",
    label: "Selesai",
  },
  cancelled: {
    bg: "#fff1f2",
    color: "#e11d48",
    label: "Dibatal",
  },
  "no-show": {
    bg: "#fffbeb",
    color: "#d97706",
    label: "Tak Hadir",
  },
};

const statusLabel: Record<string, string> = {
  confirmed: "Sahkan",
  waiting: "Menunggu",
  cancelled: "Batal",
  "no-show": "Tak Hadir",
  "checked-in": "Daftar Masuk",
  "in-progress": "Mula Rawat",
  completed: "Selesai",
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

function getWeekDates(date: string): string[] {
  const current = new Date(`${date}T00:00:00`);
  const start = new Date(current);

  start.setDate(current.getDate() - current.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(start);

    value.setDate(start.getDate() + index);

    return value.toISOString().slice(0, 10);
  });
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
  changeStatus: any;
}) {
  const st = statusStyle[a.status] ?? {
    bg: "#f8fafc",
    color: "#64748b",
    label: a.status,
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
      <b className="w-14 text-sm text-slate-700">
        {a.scheduledTime.slice(0, 5)}
      </b>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#0B132B]">
          {a.patientName}
        </p>

        <p className="text-xs text-slate-400">
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
        {st.label}
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
            className="rounded-full border border-slate-200 px-2 py-1 text-[10px] text-slate-600"
          >
            {statusLabel[next] ?? next}
          </button>
        ))}
      </div>
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
  const { user } = useAuth();
  const qc = useQueryClient();

  /*
   * Senarai pesakit.
   *
   * Buat masa sekarang kita ikut API asal sistem:
   * maksimum 100 pesakit dimuatkan.
   */
  const patients = useQuery({
    queryKey: ["patients", "all"],
    queryFn: () =>
      api.get<Patient[]>("/patients?limit=100"),
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
   * Carian pesakit.
   */
  const [patientSearch, setPatientSearch] =
    useState("");

  /*
   * Filter pesakit berdasarkan:
   * 1. Nama
   * 2. MRN
   */
  const filteredPatients = (
    patients.data ?? []
  ).filter((patient) => {
    const keyword = patientSearch
      .trim()
      .toLowerCase();

    if (!keyword) {
      return true;
    }

    return (
      patient.name
        ?.toLowerCase()
        .includes(keyword) ||
      patient.mrn
        ?.toLowerCase()
        .includes(keyword)
    );
  });

  const selectedPatient = (
    patients.data ?? []
  ).find(
    (patient) =>
      patient.id === form.patientId,
  );

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
      const patient = (
        patients.data ?? []
      ).find(
        (p) =>
          p.id === form.patientId,
      );

      return api.post<Appointment>(
        "/appointments",
        {
          patientId:
            form.patientId,

          patientName:
            patient?.name ?? "",

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
        "Appointment ditempah",
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

      onClose();
    },

    onError: (e: unknown) =>
      toast.error(
        errorMessage(
          e,
          "Tempahan gagal",
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
            Tempah Appointment
          </DialogTitle>

          <DialogDescription>
            Pilih pesakit, tarikh dan slot
            masa yang tersedia.
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
              Pesakit *
            </Label>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

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
                  }
                }}
                placeholder="Cari nama atau MRN pesakit..."
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
                      ? "Memuatkan pesakit..."
                      : "Pilih pesakit daripada hasil carian"
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
                  <div className="px-3 py-5 text-center text-sm text-slate-400">
                    Pesakit tidak
                    dijumpai
                  </div>
                )}
              </SelectContent>
            </Select>

            {patientSearch.trim() &&
              !form.patientId && (
                <p className="text-xs text-slate-400">
                  {
                    filteredPatients.length
                  }{" "}
                  pesakit dijumpai
                </p>
              )}

            {selectedPatient && (
              <div className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2">
                <p className="text-xs text-slate-500">
                  Pesakit dipilih
                </p>

                <p className="text-sm font-semibold text-teal-700">
                  {
                    selectedPatient.name
                  }
                  {selectedPatient.mrn
                    ? ` — ${selectedPatient.mrn}`
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
              Doktor
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
                <SelectValue placeholder="Tetapkan doktor (pilihan)" />
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
                Tarikh *
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
                Masa *
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
                        ? "Pilih slot masa"
                        : "Pilih tarikh dahulu"
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
                          ? " — Penuh"
                          : " — Tersedia"}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Ahad–Khamis:
            10:00–21:00 ·
            Jumaat–Sabtu:
            10:00–17:00 · Rehat:
            13:00–14:00
          </p>

          {/* ============================= */}
          {/* NOTA */}
          {/* ============================= */}

          <div className="space-y-1.5">
            <Label>
              Nota
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
              Batal
            </Button>

            <Button
              type="submit"
              style={{
                background: GRAD,
              }}
              className="text-white"
              disabled={
                book.isPending ||
                !form.patientId ||
                !form.scheduledDate ||
                !form.scheduledTime
              }
            >
              {book.isPending
                ? "Menempah..."
                : "Tempah"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Appointments() {
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
    >("day");

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(() =>
    new Date()
      .toISOString()
      .slice(0, 10),
  );

  const pageSize = 20;

  const list = useQuery({
    queryKey: [
      "appointments",
      "list",
      page,
    ],

    queryFn: () =>
      api.get<Appointment[]>(
        `/appointments?limit=${pageSize}&offset=${
          (page - 1) *
          pageSize
        }`,
      ),
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
          "Status dikemaskini",
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
            "Kemaskini gagal",
          ),
        ),
    });

  const rows =
    list.data ?? [];

  const weekDates =
    getWeekDates(
      selectedDate,
    );

  const displayRows =
    view === "day"
      ? rows.filter(
          (appointment) =>
            appointment.scheduledDate.slice(
              0,
              10,
            ) ===
            selectedDate,
        )
      : view === "week"
        ? rows.filter(
            (appointment) =>
              weekDates.includes(
                appointment.scheduledDate.slice(
                  0,
                  10,
                ),
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
        "Tarikh",
        "Masa",
        "Nama Pesakit",
        "Kod",
        "Status",
      ];

      const lines =
        displayRows.map(
          (appointment) => [
            appointment.scheduledDate,
            appointment.scheduledTime,
            appointment.patientName,
            appointment.code,
            statusStyle[
              appointment.status
            ]?.label ??
              appointment.status,
          ],
        );

      const csv = [
        header,
        ...lines,
      ]
        .map((row) =>
          row
            .map(
              (value) =>
                `"${String(
                  value,
                ).replace(
                  /"/g,
                  '""',
                )}"`,
            )
            .join(","),
        )
        .join("\n");

      const blob =
        new Blob(
          [`\ufeff${csv}`],
          {
            type: "text/csv;charset=utf-8;",
          },
        );

      const url =
        URL.createObjectURL(
          blob,
        );

      const link =
        document.createElement(
          "a",
        );

      link.href = url;

      link.download =
        `appointments-${selectedDate}.csv`;

      link.click();

      URL.revokeObjectURL(
        url,
      );

      toast.success(
        "Senarai appointment berjaya dieksport",
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
              color:
                "#0B132B",

              fontFamily:
                "'Outfit', sans-serif",
            }}
          >
            Appointments
          </h1>

          <p className="mt-0.5 text-sm text-slate-400">
            {
              displayRows.length
            }{" "}
            appointments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={
              exportAppointments
            }
            className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600"
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
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition"
              style={{
                background:
                  GRAD,

                boxShadow:
                  "0 6px 16px -4px rgba(13,201,183,.4)",
              }}
            >
              <CalendarPlus className="h-4 w-4" />

              Tempah Appointment
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                "day",
                "week",
                "month",
                "list",
                "queue",
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
                  className="rounded-full border px-4 py-2 text-[13px] font-semibold capitalize transition"
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

                          boxShadow:
                            "0 6px 16px -4px rgba(13,201,183,.35)",
                        }
                      : {
                          background:
                            "white",

                          borderColor:
                            "#e2e8f0",

                          color:
                            "#64748b",
                        }
                  }
                >
                  {
                    item
                  }
                </button>
              ),
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-500"
              onClick={() =>
                setSelectedDate(
                  new Date(
                    new Date(
                      selectedDate,
                    ).setDate(
                      new Date(
                        selectedDate,
                      ).getDate() -
                        1,
                    ),
                  )
                    .toISOString()
                    .slice(
                      0,
                      10,
                    ),
                )
              }
            >
              ‹
            </button>

            <span className="min-w-[120px] text-center text-sm font-semibold text-slate-600">
              {
                selectedDate
              }
            </span>

            <button
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-500"
              onClick={() =>
                setSelectedDate(
                  new Date(
                    new Date(
                      selectedDate,
                    ).setDate(
                      new Date(
                        selectedDate,
                      ).getDate() +
                        1,
                    ),
                  )
                    .toISOString()
                    .slice(
                      0,
                      10,
                    ),
                )
              }
            >
              ›
            </button>

            <button
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600"
              onClick={() =>
                setSelectedDate(
                  new Date()
                    .toISOString()
                    .slice(
                      0,
                      10,
                    ),
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
                className="h-20 w-full rounded-2xl"
              />
            ),
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-[#0B132B]">
            {view ===
            "day"
              ? `Day Schedule — ${dateLabel(
                  selectedDate,
                )}`
              : view ===
                  "week"
                ? "Week View"
                : view ===
                    "month"
                  ? `Month View — ${selectedDate.slice(
                      0,
                      7,
                    )}`
                  : view ===
                      "list"
                    ? "List View"
                    : "Today's Queue"}
          </h2>

          {view ===
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
                    d
                      .toISOString()
                      .slice(
                        0,
                        10,
                      );

                  const items =
                    rows.filter(
                      (
                        a,
                      ) =>
                        a.scheduledDate.slice(
                          0,
                          10,
                        ) ===
                        key,
                    );

                  return (
                    <div
                      key={
                        i
                      }
                      className="min-h-24 rounded-xl border border-slate-100 p-2"
                    >
                      <b className="text-xs text-slate-500">
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
                            className="mt-1 truncate rounded bg-teal-50 px-1 text-[10px] text-teal-700"
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
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map(
                (d) => (
                  <div
                    key={
                      d
                    }
                    className="min-h-40 rounded-xl border border-slate-100 p-2"
                  >
                    <p className="mb-3 text-center text-xs font-bold text-slate-500">
                      {dateLabel(
                        d,
                      )}
                    </p>

                    {rows
                      .filter(
                        (
                          a,
                        ) =>
                          a.scheduledDate.slice(
                            0,
                            10,
                          ) ===
                          d,
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
                ),
              )}
            </div>
          ) : view ===
            "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-slate-400">
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
                        className="border-b border-slate-100"
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

                        <td className="p-3 text-slate-400">
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
                          {statusStyle[
                            a
                              .status
                          ]
                            ?.label ??
                            a.status}
                        </td>

                        <td className="p-3">
                          <AppointmentCard
                            a={
                              a
                            }
                            changeStatus={
                              changeStatus
                            }
                          />
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
                      : a.scheduledDate.slice(
                          0,
                          10,
                        ) ===
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
        <p className="text-sm text-slate-400">
          Halaman {page}
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

            Sebelum
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
            Seterusnya

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