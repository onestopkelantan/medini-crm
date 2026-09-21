import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type Row = {
  id: string;
  doctorId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  doctorName: string;
  notes?: string | null;
};

type Doctor = {
  id: string;
  name: string;
  role: string;
  status?: string;
};

type HolidayMap = Record<string, string>;

const pad = (n: number) => String(n).padStart(2, "0");

export default function DoctorSchedule() {
  const { user } = useAuth();

  const canManage = user?.role === "branch_manager";

  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const [doctor, setDoctor] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("17:00");
  const [note, setNote] = useState("");

  const [holiday, setHoliday] = useState(false);
  const [holidayReason, setHolidayReason] =
    useState("Public Holiday");
  const [otherReason, setOtherReason] = useState("");

  const [holidays, setHolidays] = useState<HolidayMap>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("doctor-schedule-holidays") || "{}",
      );
    } catch {
      return {};
    }
  });

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const query = useQuery({
    queryKey: ["doctor-schedules"],
    queryFn: () =>
      api.get<Row[]>("/doctor-schedules"),
  });

  const doctorsQuery = useQuery({
    queryKey: ["branch-doctors"],
    queryFn: () =>
      api.get<Doctor[]>("/appointments/doctors/list"),
  });

  const doctors = (doctorsQuery.data ?? []).filter(
    (d) => d.role.toLowerCase() === "doctor",
  );

  useEffect(() => {
    localStorage.setItem(
      "doctor-schedule-holidays",
      JSON.stringify(holidays),
    );
  }, [holidays]);

  const schedulesByDate = useMemo(() => {
    const map = new Map<string, Row[]>();

    for (const row of query.data ?? []) {
      const rows = map.get(row.scheduleDate) ?? [];
      rows.push(row);
      map.set(row.scheduleDate, rows);
    }

    return map;
  }, [query.data]);

  const days = useMemo(() => {
    const first = new Date(
      month.getFullYear(),
      month.getMonth(),
      1,
    ).getDay();

    const total = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();

    return [
      ...Array(first).fill(null),
      ...Array.from({ length: total }, (_, i) => i + 1),
    ];
  }, [month]);

  const dateFor = (day: number) =>
    `${month.getFullYear()}-${pad(
      month.getMonth() + 1,
    )}-${pad(day)}`;

  const resetForm = () => {
    setSelected(null);
    setEditing(null);
    setDoctor("");
    setStart("10:00");
    setEnd("17:00");
    setNote("");
    setHoliday(false);
    setHolidayReason("Public Holiday");
    setOtherReason("");
  };

  const openNew = (date: string) => {
    if (!canManage) return;

    setEditing(null);
    setSelected(date);
    setDoctor("");
    setStart("10:00");
    setEnd("17:00");
    setNote("");
    setHoliday(false);
  };

  const openEdit = (row: Row) => {
    if (!canManage) return;

    setEditing(row);
    setSelected(row.scheduleDate);
    setDoctor(row.doctorId);
    setStart(row.startTime.slice(0, 5));
    setEnd(row.endTime.slice(0, 5));
    setNote(row.notes ?? "");
    setHoliday(false);
  };

  const saveSchedule = async () => {
    if (!selected || !canManage) return;

    if (holiday && !editing) {
      const reason =
        holidayReason === "Lain-lain"
          ? otherReason.trim()
          : holidayReason;

      if (!reason) {
        setMessage("Sila masukkan sebab cuti.");
        return;
      }

      setHolidays((current) => ({
        ...current,
        [selected]: reason,
      }));

      setMessage(
        `Cuti (${reason}) disimpan pada kalendar.`,
      );

      resetForm();
      return;
    }

    if (!doctor) {
      setMessage("Sila pilih doktor.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        doctorId: doctor,
        scheduleDate: selected,
        startTime: start,
        endTime: end,
        notes: note || null,
      };

      if (editing) {
        await api.patch(
          `/doctor-schedules/${editing.id}`,
          payload,
        );

        setMessage("Jadual doktor berjaya dikemaskini.");
      } else {
        await api.post(
          "/doctor-schedules",
          payload,
        );

        setMessage("Jadual doktor berjaya ditambah.");
      }

      await query.refetch();

      resetForm();
    } catch (error) {
      setMessage(
        errorMessage(
          error,
          editing
            ? "Jadual gagal dikemaskini."
            : "Jadual gagal ditambah.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async () => {
    if (!editing || !canManage) return;

    const ok = window.confirm(
      `Padam jadual ${editing.doctorName} pada ${editing.scheduleDate}?`,
    );

    if (!ok) return;

    setDeleting(true);
    setMessage("");

    try {
      await api.del(
        `/doctor-schedules/${editing.id}`,
      );

      await query.refetch();

      setMessage("Jadual doktor berjaya dipadam.");

      resetForm();
    } catch (error) {
      setMessage(
        errorMessage(
          error,
          "Jadual doktor gagal dipadam.",
        ),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="min-h-full bg-[#F4F7FA] p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B132B]">
            Jadual Doktor
          </h1>

          <p className="mt-1 text-slate-500">
            {canManage
              ? "Klik tarikh untuk tambah jadual. Klik jadual doktor untuk edit atau padam."
              : "Paparan jadual doktor cawangan."}
          </p>
        </div>

        {message && (
          <p className="max-w-md text-right text-sm font-medium text-teal-700">
            {message}
          </p>
        )}
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() =>
              setMonth(
                new Date(
                  month.getFullYear(),
                  month.getMonth() - 1,
                  1,
                ),
              )
            }
            className="rounded-lg border p-2"
          >
            <ChevronLeft />
          </button>

          <h2 className="flex items-center gap-2 text-lg font-bold capitalize text-[#0B132B]">
            <CalendarDays className="text-teal-500" />
            {month.toLocaleDateString("ms-MY", {
              month: "long",
              year: "numeric",
            })}
          </h2>

          <button
            onClick={() =>
              setMonth(
                new Date(
                  month.getFullYear(),
                  month.getMonth() + 1,
                  1,
                ),
              )
            }
            className="rounded-lg border p-2"
          >
            <ChevronRight />
          </button>
        </div>

        <div className="grid grid-cols-7 overflow-hidden rounded-xl border">
          {[
            "Ahad",
            "Isnin",
            "Selasa",
            "Rabu",
            "Khamis",
            "Jumaat",
            "Sabtu",
          ].map((d) => (
            <div
              key={d}
              className="border-b bg-slate-50 p-2 text-center text-xs font-bold text-slate-500"
            >
              {d}
            </div>
          ))}

          {days.map((day, i) => {
            if (!day) {
              return (
                <div
                  key={i}
                  className="min-h-32 border-b border-r bg-slate-50/40"
                />
              );
            }

            const date = dateFor(day);
            const schedules =
              schedulesByDate.get(date) ?? [];

            const holidayText =
              holidays[date] ||
              (date === "2026-09-16"
                ? "Hari Malaysia"
                : null);

            return (
              <div
                key={date}
                onClick={() => openNew(date)}
                className={`min-h-32 border-b border-r p-2 text-left align-top ${
                  canManage
                    ? "cursor-pointer hover:bg-teal-50"
                    : ""
                } ${
                  holidayText
                    ? "bg-yellow-200"
                    : "bg-white"
                }`}
              >
                <div className="mb-2 text-sm font-bold text-slate-700">
                  {day}
                </div>

                {schedules.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(row);
                    }}
                    className={`mb-1 block w-full rounded-md px-1 py-1 text-left text-[10px] leading-tight text-slate-700 ${
                      canManage
                        ? "hover:bg-teal-100"
                        : "cursor-default"
                    }`}
                  >
                    <span>
                      {row.startTime.slice(0, 5)}
                      {" - "}
                      {row.endTime.slice(0, 5)}
                      {": "}
                      {row.doctorName}
                    </span>

                    {canManage && (
                      <Pencil className="ml-1 inline h-3 w-3" />
                    )}
                  </button>
                ))}

                {holidayText && (
                  <div className="mb-1 text-[10px] font-semibold leading-tight text-amber-900">
                    CUTI: {holidayText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {selected && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold">
              {editing
                ? `Edit Jadual ${selected}`
                : `Atur ${selected}`}
            </h3>

            {!editing && (
              <label className="mb-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={holiday}
                  onChange={(e) =>
                    setHoliday(e.target.checked)
                  }
                />
                Cuti
              </label>
            )}

            {holiday && !editing ? (
              <>
                <label className="mb-2 block text-sm font-medium">
                  Sebab cuti

                  <select
                    value={holidayReason}
                    onChange={(e) =>
                      setHolidayReason(e.target.value)
                    }
                    className="mt-1 w-full rounded-lg border p-2"
                  >
                    <option>Public Holiday</option>
                    <option>Cuti umum negeri</option>
                    <option>Cuti doktor</option>
                    <option>Cuti kecemasan</option>
                    <option>Lain-lain</option>
                  </select>
                </label>

                {holidayReason === "Lain-lain" && (
                  <input
                    value={otherReason}
                    onChange={(e) =>
                      setOtherReason(e.target.value)
                    }
                    placeholder="Tulis sebab cuti"
                    className="mb-4 w-full rounded-lg border p-2"
                  />
                )}
              </>
            ) : (
              <>
                <label className="mb-2 block text-sm font-medium">
                  Doktor

                  <select
                    value={doctor}
                    onChange={(e) =>
                      setDoctor(e.target.value)
                    }
                    className="mt-1 w-full rounded-lg border p-2"
                  >
                    <option value="">
                      {doctorsQuery.isLoading
                        ? "Memuatkan doktor..."
                        : "Pilih doktor"}
                    </option>

                    {doctors.map((d) => (
                      <option
                        key={d.id}
                        value={d.id}
                      >
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="mb-3 flex gap-2">
                  <label className="flex-1 text-sm">
                    Mula

                    <input
                      type="time"
                      value={start}
                      onChange={(e) =>
                        setStart(e.target.value)
                      }
                      className="mt-1 w-full rounded-lg border p-2"
                    />
                  </label>

                  <label className="flex-1 text-sm">
                    Tamat

                    <input
                      type="time"
                      value={end}
                      onChange={(e) =>
                        setEnd(e.target.value)
                      }
                      className="mt-1 w-full rounded-lg border p-2"
                    />
                  </label>
                </div>

                <input
                  value={note}
                  onChange={(e) =>
                    setNote(e.target.value)
                  }
                  placeholder="Catatan (pilihan)"
                  className="mb-4 w-full rounded-lg border p-2"
                />
              </>
            )}

            <div className="flex items-center justify-between gap-2">
              <div>
                {editing && (
                  <button
                    onClick={deleteSchedule}
                    disabled={deleting || saving}
                    className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />

                    {deleting
                      ? "Memadam..."
                      : "Padam Jadual"}
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={resetForm}
                  disabled={saving || deleting}
                  className="rounded-lg border px-4 py-2"
                >
                  Batal
                </button>

                <button
                  onClick={saveSchedule}
                  disabled={saving || deleting}
                  className="rounded-lg bg-[#0B132B] px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {saving
                    ? "Menyimpan..."
                    : editing
                      ? "Simpan Perubahan"
                      : "Simpan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
