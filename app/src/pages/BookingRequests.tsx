import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface BookingRequest {
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
}

const statusPill: Record<string, { bg: string; color: string; border: string; label: string }> = {
  pending:   { bg: "#fffbeb", color: "#d97706", border: "#fef3c7", label: "Menunggu" },
  confirmed: { bg: "#f0fdfa", color: "#0d9488", border: "#ccfbf1", label: "Disahkan" },
  rejected:  { bg: "#fff1f2", color: "#e11d48", border: "#ffe4e6", label: "Ditolak" },
};

export default function BookingRequests() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["booking-requests"],
    queryFn: () => api.get<BookingRequest[]>("/booking-requests"),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/booking-requests/${id}/status`, { status }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["booking-requests"] });
      toast.success(v.status === "confirmed" ? "Booking disahkan, pesakit dimaklumkan" : "Booking ditolak, pesakit dimaklumkan");
    },
    onError: (e) => toast.error(errorMessage(e, "Gagal kemaskini")),
  });

  const rows = data ?? [];
  const pending = rows.filter((r) => r.status === "pending").length;
  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;

  return (
    <div className="space-y-6" style={{ animation: "fadeIn .25s ease" }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold" style={{ color: "#0B132B", fontFamily: "'Outfit', sans-serif" }}>Booking WhatsApp</h2>
          <p className="text-xs text-slate-400 mt-0.5">Permohonan booking dari Nur (WhatsApp) - sahkan sebelum jadi appointment</p>
        </div>
        <div className="flex gap-2">
          <StatChip label="Menunggu" value={pending} bg="#fffbeb" color="#d97706" />
          <StatChip label="Disahkan" value={confirmed} bg="#f0fdfa" color="#0d9488" />
          <StatChip label="Ditolak" value={rejected} bg="#fff1f2" color="#e11d48" />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white/80 p-12 text-center" style={{ backdropFilter: "blur(12px)" }}>
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl flex items-center justify-center text-white" style={{ background: "linear-gradient(135deg, #0DC9B7, #12B5E5)" }}>
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
          </div>
          <p className="font-semibold text-slate-700">Tiada booking</p>
          <p className="text-xs text-slate-400 mt-1">Booking dari WhatsApp akan muncul di sini.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map((b) => {
            const pill = statusPill[b.status] ?? statusPill.pending;
            return (
              <div key={b.id} className="rounded-2xl border p-5" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", borderColor: "rgba(226,232,240,0.8)", boxShadow: "0 4px 24px -6px rgba(15,23,42,0.08)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-2xl flex items-center justify-center text-white font-bold shrink-0" style={{ background: "linear-gradient(135deg, #0DC9B7, #12B5E5)", fontFamily: "'Outfit', sans-serif" }}>
                      {(b.patient_name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-[15px]" style={{ color: "#0B132B" }}>{b.patient_name || "(tiada nama)"}</p>
                      <p className="text-xs text-slate-400">{b.contact_phone}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold border" style={{ background: pill.bg, color: pill.color, borderColor: pill.border }}>
                    {pill.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Field label="Rawatan" value={b.treatment} />
                  <Field label="Tarikh" value={b.preferred_date} />
                  <Field label="Masa" value={b.preferred_time} />
                  <Field label="Cawangan" value={b.branch_name} />
                </div>

                {b.raw_message && (
                  <p className="text-xs text-slate-400 italic mt-3 rounded-xl bg-slate-50 px-3 py-2">"{b.raw_message}"</p>
                )}

                <div className="flex items-center justify-between mt-4">
                  <p className="text-[11px] text-slate-400">{new Date(b.created_at).toLocaleString()}</p>
                  {b.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => changeStatus.mutate({ id: b.id, status: "confirmed" })}
                        disabled={changeStatus.isPending}
                        className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg, #0DC9B7, #12B5E5)", boxShadow: "0 6px 16px -4px rgba(13,201,183,.4)" }}
                      >
                        ✓ Sahkan
                      </button>
                      <button
                        onClick={() => changeStatus.mutate({ id: b.id, status: "rejected" })}
                        disabled={changeStatus.isPending}
                        className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
                      >
                        ✕ Tolak
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, bg, color }: { label: string; value: number; bg: string; color: string }) {
  return (
    <div className="rounded-xl px-3 py-1.5 text-center" style={{ background: bg }}>
      <p className="text-[16px] font-bold leading-none" style={{ color }}>{value}</p>
      <p className="text-[10px] font-semibold mt-0.5" style={{ color }}>{label}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[13px] font-medium text-slate-700 mt-0.5">{value || "-"}</p>
    </div>
  );
}
