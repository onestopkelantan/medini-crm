import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

type Row = { scheduleDate: string; startTime: string; endTime: string; doctorName: string; notes?: string | null };
type Doctor = { id: string; name: string; role: string; status?: string };
type Event = { date: string; text: string; holiday?: boolean };
type HolidayMap = Record<string, string>;

const pad = (n: number) => String(n).padStart(2, "0");

export default function DoctorSchedule() {
  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [doctor, setDoctor] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("17:00");
  const [holiday, setHoliday] = useState(false);
  const [holidayReason, setHolidayReason] = useState("Public Holiday");
  const [otherReason, setOtherReason] = useState("");
  const [holidays, setHolidays] = useState<HolidayMap>(() => {
    try { return JSON.parse(localStorage.getItem("doctor-schedule-holidays") || "{}"); } catch { return {}; }
  });
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["doctor-schedules"], queryFn: () => api.get<Row[]>("/doctor-schedules") });
  const doctorsQuery = useQuery({ queryKey: ["branch-doctors"], queryFn: () => api.get<Doctor[]>("/appointments/doctors/list") });
  // Endpoint already excludes deleted staff and limits results to the current branch.
  // Do not filter by status: existing doctors may be marked Completed or Booked.
  const doctors = (doctorsQuery.data ?? []).filter((d) => d.role.toLowerCase() === "doctor");

  useEffect(() => { localStorage.setItem("doctor-schedule-holidays", JSON.stringify(holidays)); }, [holidays]);

  const events = useMemo<Event[]>(() => {
    const result: Event[] = (query.data ?? []).map((r) => ({ date: r.scheduleDate, text: `${r.startTime.slice(0, 5)} - ${r.endTime.slice(0, 5)}: ${r.doctorName}` }));
    Object.entries(holidays).forEach(([date, reason]) => result.push({ date, text: `CUTI: ${reason}`, holiday: true }));
    if (!holidays["2026-09-16"]) result.push({ date: "2026-09-16", text: "CUTI: Hari Malaysia", holiday: true });
    return result;
  }, [query.data, holidays]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  }, [month]);

  const dateFor = (day: number) => `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}`;
  const addSchedule = async () => {
    if (!selected) return;
    try {
      if (holiday) {
        const reason = holidayReason === "Lain-lain" ? otherReason.trim() : holidayReason;
        if (!reason) { setMessage("Sila masukkan sebab cuti."); return; }
        setHolidays((current) => ({ ...current, [selected]: reason }));
        setMessage(`Cuti (${reason}) disimpan pada kalendar.`);
      } else {
        if (!doctor) { setMessage("Sila pilih doktor."); return; }
        await api.post("/doctor-schedules", { doctorId: doctor, scheduleDate: selected, startTime: start, endTime: end, notes: note || null });
        await query.refetch().catch(() => undefined);
        setMessage("Jadual berjaya disimpan.");
      }
      setSelected(null); setHoliday(false); setHolidayReason("Public Holiday"); setOtherReason(""); setNote(""); setDoctor("");
    } catch { setMessage("Jadual gagal disimpan."); }
  };

  return <main className="min-h-full bg-[#F4F7FA] p-4 sm:p-8">
    <div className="mb-6 flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[#0B132B]">Jadual Doktor</h1><p className="mt-1 text-slate-500">Klik tarikh untuk atur doktor atau cuti</p></div>{message && <p className="text-sm font-medium text-teal-700">{message}</p>}</div>
    <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6"><div className="mb-5 flex items-center justify-between"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg border p-2"><ChevronLeft /></button><h2 className="flex items-center gap-2 text-lg font-bold capitalize text-[#0B132B]"><CalendarDays className="text-teal-500" />{month.toLocaleDateString("ms-MY", { month: "long", year: "numeric" })}</h2><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg border p-2"><ChevronRight /></button></div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border">{["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"].map((d) => <div key={d} className="border-b bg-slate-50 p-2 text-center text-xs font-bold text-slate-500">{d}</div>)}{days.map((day, i) => { const date = day ? dateFor(day) : ""; const found = events.filter((e) => e.date === date); return <button key={i} onClick={() => day && setSelected(date)} className={`min-h-32 border-b border-r p-2 text-left align-top hover:bg-teal-50 ${found.some((e) => e.holiday) ? "bg-yellow-200" : ""}`}><div className="mb-2 text-sm font-bold text-slate-700">{day}</div>{found.map((e, j) => <div key={j} className="mb-1 text-[10px] leading-tight text-slate-600">{e.text}</div>)}</button>; })}</div>
    </section>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h3 className="mb-4 text-lg font-bold">Atur {selected}</h3><label className="mb-3 flex items-center gap-2"><input type="checkbox" checked={holiday} onChange={(e) => setHoliday(e.target.checked)} /> Cuti</label>{holiday ? <><label className="mb-2 block text-sm font-medium">Sebab cuti<select value={holidayReason} onChange={(e) => setHolidayReason(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option>Public Holiday</option><option>Cuti umum negeri</option><option>Cuti doktor</option><option>Cuti kecemasan</option><option>Lain-lain</option></select></label>{holidayReason === "Lain-lain" && <input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Tulis sebab cuti" className="mb-4 w-full rounded-lg border p-2" />}</> : <><label className="mb-2 block text-sm font-medium">Doktor<select value={doctor} onChange={(e) => setDoctor(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">{doctorsQuery.isLoading ? "Memuatkan doktor..." : "Pilih doktor"}</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><div className="mb-3 flex gap-2"><label className="flex-1 text-sm">Mula<input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><label className="flex-1 text-sm">Tamat<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label></div><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (pilihan)" className="mb-4 w-full rounded-lg border p-2" /></>}<div className="flex justify-end gap-2"><button onClick={() => setSelected(null)} className="rounded-lg border px-4 py-2">Batal</button><button onClick={addSchedule} className="rounded-lg bg-[#0B132B] px-4 py-2 font-semibold text-white">Simpan</button></div></div></div>}
  </main>;
}
