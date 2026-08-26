import { Link } from "react-router";
import { Tooth } from "@/components/ToothIcon";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
      <div className="rounded-2xl bg-emerald-600 p-3 text-white"><Tooth className="h-8 w-8" /></div>
      <h1 className="text-3xl font-bold text-slate-900">404</h1>
      <p className="text-slate-500">This page doesn't exist in Medini AI Dental CRM.</p>
      <Link to="/dashboard" className="text-emerald-600 font-medium hover:underline">← Back to Dashboard</Link>
    </div>
  );
}
