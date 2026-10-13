import { usePrefs } from "@/hooks/usePrefs";
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
import { BackLink } from "@/components/shared";
import { useAuth } from "@/hooks/useAuth";

type Row = {
  id: string;
  doctorId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  doctorName: string;
  notes?: string | null;
  /* FASA 6E — present only for HQ, which can see several branches at once and so
   * cannot tell which branch a row belongs to without being told. */
  branchId?: string | null;
  branchName?: string | null;
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
  const { t } = usePrefs();
  const { user } = useAuth();

  /* HQ manages the whole group's rosters; a manager their own branch.
   * Doctor/reception see the calendar read-only. */
  const canManage = user?.role === "branch_manager" || user?.role === "hq";

  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const [hqBranchId, setHqBranchId] = useState<string>("");
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
    queryKey: ["doctor-schedules", hqBranchId],
    queryFn: () =>
      api.get<Row[]>(
        hqBranchId ? `/doctor-schedules?branchId=${hqBranchId}` : "/doctor-schedules",
      ),
  });

  /* FASA 6E — HQ oversees 14 branches and needs to look at one at a time.
   * `enabled` keeps the call away from managers, who have no list to choose from. */
  const branchesQuery = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Array<{ id: string; shortName: string }>>("/admin/branches"),
    enabled: user?.role === "hq",
  });

  const doctorsQuery = useQuery({
    queryKey: ["branch-doctors"],
    queryFn: () =>
      api.get<Doctor[]>("/doctor-registration/doctors/list"),
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

        setMessage(t("ds.updated"));
      } else {
        await api.post(
          "/doctor-schedules",
          payload,
        );

        setMessage(t("ds.added"));
      }

      await query.refetch();

      resetForm();
    } catch (error) {
      setMessage(
        errorMessage(
          error,
          editing
            ? t("ds.updateFailed")
            : t("ds.addFailed"),
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

      setMessage(t("ds.deleted"));

      resetForm();
    } catch (error) {
      setMessage(
        errorMessage(
          error,
          t("ds.deleteFailed"),
        ),
      );
    } finally {
      setDeleting(false);
    }
  };

  const deleteHoliday = (
    date: string,
    reason: string,
  ) => {
    if (!canManage) return;

    const ok = window.confirm(
      `Padam cuti "${reason}" pada ${date}?`,
    );

    if (!ok) return;

    setHolidays((current) => {
      const next = { ...current };
      delete next[date];
      return next;
    });

    setMessage(t("msg.leaveDeleted"));
  };

  return (
    <main className="min-h-full bg-background p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="mb-2"><BackLink to="/appointments" /></div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("ds.title")}
          </h1>

          <p className="mt-1 text-muted-foreground">
            {canManage
              ? t("ds.hintManage")
              : hqBranchId
                ? t("ds.hintBranchView")
                : t("ds.hintAllView")}
          </p>
        </div>

        {/* FASA 6E, HQ only. Managers have one branch, so a picker would be
            a control that cannot change anything. */}
        {user?.role === "hq" && (
          <select
            value={hqBranchId}
            onChange={(e) => setHqBranchId(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground focus:border-border focus:outline-none"
          >
            <option value="">{t("ds.allBranches")}</option>
            {(branchesQuery.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.shortName}
              </option>
            ))}
          </select>
        )}

        {message && (
          <p className="max-w-md text-right text-sm font-medium text-foreground">
            {message}
          </p>
        )}
      </div>

      <section className="rounded-lg bg-card p-4 shadow-sm sm:p-6">
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

          <h2 className="flex items-center gap-2 text-lg font-bold capitalize text-foreground">
            <CalendarDays className="text-foreground" />
            {/* Nama bulan ikut bahasa aplikasi (EN/BM), bukan hard-coded
                ms-MY - pemilik 10 Okt: "tulisan bulan belum sesuai EN/BM". */}
            {t(`mth.${month.getMonth() + 1}`)} {month.getFullYear()}
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
            t("ds.dow0"),
            t("ds.dow1"),
            t("ds.dow2"),
            t("ds.dow3"),
            t("ds.dow4"),
            t("ds.dow5"),
            t("ds.dow6"),
          ].map((d) => (
            <div
              key={d}
              className="border-b bg-muted p-2 text-center text-xs font-bold text-muted-foreground"
            >
              {d}
            </div>
          ))}

          {days.map((day, i) => {
            if (!day) {
              return (
                <div
                  key={i}
                  className="min-h-32 border-b border-r bg-muted/40"
                />
              );
            }

            const date = dateFor(day);
            const schedules =
              schedulesByDate.get(date) ?? [];

            const holidayText =
              holidays[date] ||
              (date === "2026-09-16"
                ? t("ds.malaysiaDay")
                : null);

            return (
              <div
                key={date}
                onClick={() => openNew(date)}
                className={`min-h-32 border-b border-r p-2 text-left align-top ${
                  canManage
                    ? "cursor-pointer hover:bg-accent"
                    : ""
                } ${
                  holidayText
                    ? "bg-yellow-200"
                    : "bg-card"
                }`}
              >
                <div className="mb-2 text-sm font-bold text-foreground">
                  {day}
                </div>

                {/* Discoverability: an empty day used to be a silent click
                 * target — now it SAYS so. The hint appears only for roles
                 * that can act (canManage), and only on days with nothing
                 * scheduled yet, so a full calendar stays clean. */}
                {canManage && schedules.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/70 px-1.5 py-1 text-[10px] text-muted-foreground/80">
                    {t("ds.addCellHint")}
                  </div>
                )}

                {schedules.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(row);
                    }}
                    className={`mb-1 block w-full rounded-md px-1 py-1 text-left text-[10px] leading-tight text-foreground ${
                      canManage
                        ? "hover:bg-accent"
                        : "cursor-default"
                    }`}
                  >
                    <span>
                      {row.startTime.slice(0, 5)}
                      {" - "}
                      {row.endTime.slice(0, 5)}
                      {": "}
                      {row.doctorName}
                      {/* FASA 6E, only HQ sees several branches at once; for a
                          manager every row is already their own branch. */}
                      {user?.role === "hq" && row.branchName ? (
                        <em className="ml-1 not-italic text-[11px] text-muted-foreground">
                          ({row.branchName})
                        </em>
                      ) : null}
                    </span>

                    {canManage && (
                      <Pencil className="ml-1 inline h-3 w-3" />
                    )}
                  </button>
                ))}

                {holidayText && (
                  holidays[date] && canManage ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteHoliday(
                          date,
                          holidayText,
                        );
                      }}
                      className="mb-1 flex w-full items-center justify-between gap-1 rounded-md bg-amber-100 px-1 py-1 text-left text-[10px] font-semibold leading-tight text-amber-900 hover:bg-red-100 hover:text-red-700"
                      title={t("ds.deleteHolidayTip")}
                    >
                      <span>
                        {t("ds.closedPrefix")}: {holidayText}
                      </span>

                      <Trash2 className="h-3 w-3 shrink-0" />
                    </button>
                  ) : (
                    <div className="mb-1 text-[10px] font-semibold leading-tight text-amber-900">
                      {t("ds.closedPrefix")}: {holidayText}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>

      {selected && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-bold">
              {editing
                ? t("ds.editTitle", { d: selected })
                : t("ds.arrangeTitle", { d: selected })}
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
                {t("ds.holiday")}
              </label>
            )}

            {holiday && !editing ? (
              <>
                <label className="mb-2 block text-sm font-medium">
                  {t("ds.holidayReason")}

                  <select
                    value={holidayReason}
                    onChange={(e) =>
                      setHolidayReason(e.target.value)
                    }
                    className="mt-1 w-full rounded-lg border p-2"
                  >
                    <option>{t("ds.reason.public")}</option>
                    <option>{t("ds.reason.state")}</option>
                    <option>{t("ds.reason.doctor")}</option>
                    <option>{t("ds.reason.emergency")}</option>
                    <option>{t("ds.reason.other")}</option>
                  </select>
                </label>

                {holidayReason === t("ds.reason.other") && (
                  <input
                    value={otherReason}
                    onChange={(e) =>
                      setOtherReason(e.target.value)
                    }
                    placeholder={t("ds.otherReasonPh")}
                    className="mb-4 w-full rounded-lg border p-2"
                  />
                )}
              </>
            ) : (
              <>
                <label className="mb-2 block text-sm font-medium">
                  {t("ds.doctor")}

                  <select
                    value={doctor}
                    onChange={(e) =>
                      setDoctor(e.target.value)
                    }
                    className="mt-1 w-full rounded-lg border p-2"
                  >
                    <option value="">
                      {doctorsQuery.isLoading
                        ? t("ds.loadingDoctors")
                        : t("ds.pickDoctor")}
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
                    {t("ds.start")}

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
                    {t("ds.end")}

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
                  placeholder={t("ds.notePh")}
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
                      ? t("common.deleting")
                      : t("ds.delete")}
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={resetForm}
                  disabled={saving || deleting}
                  className="rounded-lg border px-4 py-2"
                >
                  {t("common.cancel")}
                </button>

                <button
                  onClick={saveSchedule}
                  disabled={saving || deleting}
                  className="rounded-lg bg-[#0B132B] px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {saving
                    ? t("common.saving")
                    : editing
                      ? t("common.saveChanges")
                      : t("common.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
