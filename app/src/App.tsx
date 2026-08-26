import { Routes, Route, Navigate, useLocation } from "react-router";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { BranchProvider } from "@/hooks/useBranch";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import Patient360 from "@/pages/Patient360";
import Appointments from "@/pages/Appointments";
import Clinical from "@/pages/Clinical";
import Documents from "@/pages/Documents";
import Finance from "@/pages/Finance";
import Reports from "@/pages/Reports";
import Marketing from "@/pages/Marketing";
import Operations from "@/pages/Operations";
import WhatsAppHub from "@/pages/WhatsAppHub";
import AIManager from "@/pages/AIManager";
import Administration from "@/pages/Administration";
import SettingsPage from "@/pages/Settings";
import Register from "@/pages/Register";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm">Loading Medini AI Dental CRM…</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

/** Role guard — mirrors the locked ROLE_DOMAIN_MATRIX (backend = authority).
 *  Cosmetic UI gating only; backend independently enforces via PermissionGuard + RLS.
 *  Matrix view rights: admin=hq only; marketing=hq+branch_manager;
 *  finance=hq+branch_manager (branch_admin/doctor have accessor-only, not the page);
 *  reports=hq+branch_manager (doctor/receptionist = NONE per S9 Q1). */
const roleGuard: Record<string, string[]> = {
  "/administration": ["hq"],
  "/marketing": ["hq", "branch_manager"],
  "/finance": ["hq", "branch_manager"],
  "/reports": ["hq", "branch_manager"],
};

function Guarded({ path, children }: { path: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const allowed = roleGuard[path];
  if (allowed && user && !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        element={
          <RequireAuth>
            <BranchProvider>
              <AppLayout />
            </BranchProvider>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/:id" element={<Patient360 />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/clinical" element={<Clinical />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/finance" element={<Guarded path="/finance"><Finance /></Guarded>} />
        <Route path="/reports" element={<Guarded path="/reports"><Reports /></Guarded>} />
        <Route path="/marketing" element={<Guarded path="/marketing"><Marketing /></Guarded>} />
        <Route path="/operations" element={<Operations />} />
        <Route path="/whatsapp" element={<WhatsAppHub />} />
        <Route path="/ai" element={<AIManager />} />
        <Route path="/administration" element={<Guarded path="/administration"><Administration /></Guarded>} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
