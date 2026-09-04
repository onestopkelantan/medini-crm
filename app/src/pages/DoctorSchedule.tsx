import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Upload } from "lucide-react";

type Schedule = {
  date: string;
  items: string[];
};

const schedules: Schedule[] = [
  { date: "2026-09-01", items: ["10AM - 5PM: DR ZUL", "11AM - 6PM: DR DIBA", "3PM - 9PM: DR DIBA"] },
  { date: "2026-09-02", items: ["10AM - 5PM: DR ZUL", "10AM - 5PM: DR HANI", "6PM - 9PM: DR ISHA"] },
  { date: "2026-09-03", items: ["10AM - 5PM: DR HANI", "11AM - 6PM: DR ISHA", "6PM - 9PM: DR ISHA"] },
  { date: "2026-09-04", items: ["10AM - 5PM: DR HANI"] },
  { date: "2026-09-05", items: ["10AM - 5PM: DR DIBA"] },
  { date: "2026-09-16", items: ["HARI MALAYSIA"] },
];

export default function DoctorSchedule() {
  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const title = month.toLocaleDateString("ms-MY", { month: "long", year: "numeric" });
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  }, [month]);

  const getSchedule = (day: number) => schedules.find((s) => s.date === `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);

  return (
    <main className="min-h-full bg-[#F4F7FA] p-4 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B132B]">Jadual Doktor</h1>
          <p className="mt-1 text-slate-500">Jadual doktor untuk branch anda</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium text-slate-700"><Upload className="h-4 w-4" /> Import Excel</button>
          <button className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0DC9B7] to-[#12B5E5] px-4 py-2 text-sm font-semibold text-white"><Download className="h-4 w-4" /> Export Excel</button>
        </div>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg border p-2"><ChevronLeft className="h-5 w-5" /></button>
          <h2 className="flex items-center gap-2 text-lg font-bold capitalize text-[#0B132B]"><CalendarDays className="h-5 w-5 text-teal-500" /> {title}</h2>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg border p-2"><ChevronRight className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-xl border">
          {['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'].map((day) => <div key={day} className="border-b bg-slate-50 p-2 text-center text-xs font-bold text-slate-500">{day}</div>)}
          {days.map((day, index) => {
            const schedule = day ? getSchedule(day) : undefined;
            return <div key={`${day ?? 'empty'}-${index}`} className={`min-h-28 border-b border-r p-2 ${schedule?.items[0] === 'HARI MALAYSIA' ? 'bg-yellow-200' : ''}`}>
              {day && <><div className="mb-2 text-sm font-bold text-slate-700">{day}</div>{schedule?.items.map((item) => <div key={item} className="mb-1 text-[10px] leading-tight text-slate-600">{item}</div>)}</>}
            </div>;
          })}
        </div>
      </section>
    </main>
  );
}
