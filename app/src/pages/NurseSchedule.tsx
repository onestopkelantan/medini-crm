import { usePrefs } from "@/hooks/usePrefs";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { BackLink } from "@/components/shared";
import { useAuth } from "@/hooks/useAuth";

/* ============================================================================
 * Nurse Schedule — permintaan pemilik 10 Okt: "Buatkan Nurse Schedule
 * dibawah navigationya Doctor Schedule dengan konsep yang sama".
 *
 * Konsep sama seperti DoctorSchedule (kalendar bulanan, klik hari untuk
 * tambah slot, klik slot untuk sunting/padam, HQ lihat semua cawangan):
 *   - nama bulan ikut bahasa aplikasi (kunci mth.*) - bukan hard-code ms-MY
 *   - tiada mod cuti (holiday) - cuti klinik menutup semua jadual,
 *     bukan jadual perawat seorang
 * ========================================================================== */

type Row = {
  id: string;
  nurseId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  nurseName: string;
  notes?: string | null;
  branchId?: string | null;
  branchName?: string | null;
};

type Nurse = { id: string; name: string };

const pad = (n: number) => String(n).padStart(2, "0");

export default function NurseSchedule() {
  const { t } = usePrefs();
  const { user } = useAuth();

  const canManage = user?.role === "branch_manager" || user?.role === "hq";

  const [month, setMonth] = useState(new Date());
  const [hqBranchId, setHqBranchId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [nurse, setNurse] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const scope = hqBranchId ? `?branchId=${hqBranchId}` : "";
  const query = useQuery({
    queryKey: ["nurse-schedules", hqBranchId],
    queryFn: () => api.get<Row[]>(`/nurse-schedules${scope}`),
  });

  const branchesQuery = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: () => api.get<Array<{ id: string; shortName?: string; fullName?: string }>>("/admin/branches"),
    enabled: user?.role === "hq",
  });

  const nursesQuery = useQuery({
    queryKey: ["nurse-schedules", "nurses", hqBranchId],
    queryFn: () => api.get<Nurse[]>(`/nurse-schedules/nurses${scope}`),
  });
  const nurses = nursesQuery.data ?? [];

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
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  }, [month]);

  const dateFor = (day: number) =>
    `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}`;

  const resetForm = () => {
    setSelected(null);
    setEditing(null);
    setNurse("");
    setStart("09:00");
    setEnd("17:00");
    setNote("");
  };

  const openNew = (date: string) => {
    if (!canManage) return;
    setEditing(null);
    setSelected(date);
    setNurse("");
    setStart("09:00");
    setEnd("17:00");
    setNote("");
  };

  const openEdit = (row: Row) => {
    if (!canManage) return;
    setEditing(row);
    setSelected(row.scheduleDate);
    setNurse(row.nurseId);
    setStart(row.startTime.slice(0, 5));
    setEnd(row.endTime.slice(0, 5));
    setNote(row.notes ?? "");
  };

  const saveSchedule = async () => {
    if (!selected || !canManage) return;
    if (!nurse) {
      setMessage(t("ns.pickNurseFirst"));
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        ...(user?.role === "hq" ? { branchId: hqBranchId || editing?.branchId } : {}),
        nurseId: nurse,
        scheduleDate: selected,
        startTime: start,
        endTime: end,
        notes: note || null,
      };
      if (editing) {
        /* Padam + cipta semula: endpoint nurse-schedules mempunyai create dan
         * delete (idempoten per slot); sunting ringkas = ganti slot. */
        await api.del(`/nurse-schedules/${editing.id}`);
        await api.post("/nurse-schedules", payload);
        setMessage(t("ns.updated"));
      } else {
        await api.post("/nurse-schedules", payload);
        setMessage(t("ns.added"));
      }
      await query.refetch();
      resetForm();
    } catch (error) {
      setMessage(errorMessage(error, t("ns.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async (id: string) => {
    setSaving(true);
    try {
      await api.del(`/nurse-schedules/${id}`);
      await query.refetch();
      setMessage(t("ns.deleted"));
      resetForm();
    } catch (error) {
      setMessage(errorMessage(error, t("ns.deleteFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 -mt-6">
      <BackLink to="/doctor-schedule" />
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{t("ns.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("ns.subtitle")}</p>
      </div>

      {/* Penapis cawangan HQ - konsep sama Doctor Schedule. */}
      {user?.role === "hq" && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-foreground" htmlFor="ns-branch">{t("ns.branch")}</label>
          <select
            id="ns-branch"
            value={hqBranchId}
            onChange={(e) => setHqBranchId(e.target.value)}
            className="rounded-lg border border-border bg-card p-2 text-sm"
          >
            <option value="">{t("common.allBranches")}</option>
            {(branchesQuery.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.shortName || b.fullName}</option>
            ))}
          </select>
        </div>
      )}

      {message && (
        <p className="max-w-md rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground" role="status">
          {message}
        </p>
      )}

      <section className="rounded-lg bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="rounded-lg border border-border p-2 hover:bg-muted"
            aria-label={t("ns.prevMonth")}
          >
            <ChevronLeft />
          </button>
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <CalendarDays className="text-foreground" aria-hidden />
            {t(`mth.${month.getMonth() + 1}`)} {month.getFullYear()}
          </h2>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="rounded-lg border border-border p-2 hover:bg-muted"
            aria-label={t("ns.nextMonth")}
          >
            <ChevronRight />
          </button>
        </div>

        <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border">
          {[t("ds.dow0"), t("ds.dow1"), t("ds.dow2"), t("ds.dow3"), t("ds.dow4"), t("ds.dow5"), t("ds.dow6")].map((d) => (
            <div key={d} className="border-b border-border bg-muted p-2 text-center text-xs font-bold text-muted-foreground">
              {d}
            </div>
          ))}

          {days.map((day, i) => {
            if (!day) {
              return <div key={i} className="min-h-32 border-b border-r bg-muted/40" />;
            }
            const date = dateFor(day);
            const rows = schedulesByDate.get(date) ?? [];
            return (
              <div
                key={date}
                onClick={() => openNew(date)}
                className={`min-h-32 border-b border-r p-2 text-left align-top bg-card ${canManage ? "cursor-pointer hover:bg-accent" : ""}`}
              >
                <div className="mb-2 text-sm font-bold text-foreground">{day}</div>
                {canManage && rows.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/70 px-1.5 py-1 text-[10px] text-muted-foreground/80">
                    {t("ns.addCellHint")}
                  </div>
                )}
                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); openEdit(row); }}
                    className="mb-1 flex w-full flex-col rounded-md bg-accent px-1.5 py-1 text-left text-[11px] leading-tight hover:bg-primary/15"
                    title={row.notes ?? undefined}
                  >
                    <span className="font-semibold text-foreground">{row.nurseName}</span>
                    <span className="text-muted-foreground">
                      {row.startTime.slice(0, 5)}-{row.endTime.slice(0, 5)}
                      {row.branchName && user?.role === "hq" ? ` · ${row.branchName}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* Dialog slot: konsep sama Doctor Schedule (modal tetap ringan). */}
      {selected && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => resetForm()}>
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-bold text-foreground">
              {editing ? t("ns.editTitle", { d: selected }) : t("ns.arrangeTitle", { d: selected })}
            </h3>

            <label className="mb-2 block text-sm font-medium text-foreground">
              {t("ns.nurse")}
              <select
                value={nurse}
                onChange={(e) => setNurse(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-card p-2"
              >
                <option value="">
                  {nursesQuery.isLoading ? t("common.loading") : t("ns.pickNurse")}
                </option>
                {nurses.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </label>
            {!nurses.length && !nursesQuery.isLoading && (
              <p className="mb-3 text-xs text-muted-foreground">{t("ns.noNurses")}</p>
            )}

            <div className="mb-2 flex gap-3">
              <label className="flex-1 text-sm font-medium text-foreground">
                {t("ns.start")}
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-card p-2" />
              </label>
              <label className="flex-1 text-sm font-medium text-foreground">
                {t("ns.end")}
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-card p-2" />
              </label>
            </div>

            <label className="mb-4 block text-sm font-medium text-foreground">
              {t("ns.note")}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ns.notePh")} className="mt-1 w-full rounded-lg border border-border bg-card p-2" />
            </label>

            <div className="flex justify-end gap-2">
              {editing && (
                <button
                  type="button"
                  onClick={() => deleteSchedule(editing.id)}
                  className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  disabled={saving}
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> {t("ns.delete")}
                </button>
              )}
              <button type="button" onClick={resetForm} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={saveSchedule}
                disabled={saving || !nurse}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? t("common.saving") : t("ns.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
