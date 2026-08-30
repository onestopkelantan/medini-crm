import { PageHeader, Panel } from "@/components/shared";
import { ScanLine, FileImage, CheckCircle2, Clock } from "lucide-react";

/**
 * S10 T1: X-Ray & Documents is a secondary module not in the core T1 scope
 * (Login/User Management/Dashboard/Patients/Appointments/Clinical/Finance/Reports/Profile).
 * Its production backend wiring is a post-T1 task. The tRPC prototype data
 * layer has been removed; this placeholder preserves the route + navigation.
 */
const CORE_MODULES = ["Patients", "Appointments", "Clinical", "Finance", "Reports", "Dashboard"];

export default function Documents() {
  return (
    <div className="space-y-5 -mt-6">
      <PageHeader
        title="X-Ray & Documents"
        description="Modul akan datang"
      />

      <Panel className="glass-card bg-white/80 backdrop-blur-xl border border-white/40 shadow-xl rounded-2xl p-8">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="relative mb-6">
            <div className="absolute -inset-6 bg-gradient-to-r from-teal-200/50 to-cyan-200/50 rounded-full blur-2xl" />
            <div className="relative h-20 w-20 rounded-3xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-xl shadow-teal-200/50">
              <ScanLine className="h-10 w-10 text-white" />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-slate-800 mb-2">X-Ray & Documents</h2>
          <p className="text-sm text-slate-500 max-w-md mb-3">
            Modul ini akan datang tidak lama lagi.
          </p>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-teal-700 ring-1 ring-teal-200 shadow-sm">
            <Clock className="h-4 w-4" />
            Coming Soon
          </div>

          <div className="mt-8 w-full max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Modul teras yang aktif</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CORE_MODULES.map((mod) => (
                <div key={mod} className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
                  <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
                  <span className="font-medium">{mod}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
