import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { Tooth } from "@/components/ToothIcon";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

/**
 * Staff self-registration via single-use invitation token (S10 T1).
 * HQ-generated link → /register?token=...
 * Staff CANNOT change org/branch/role — those are HQ-assigned.
 */
export default function Register() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!token) { toast.error("Invalid invitation link"); return; }
    if (!name || !username || !password) { toast.error("All fields required"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }

    setLoading(true);
    try {
      await api.post("/auth/register", { inviteToken: token, name, username, password });
      toast.success("Application submitted — pending HQ approval");
      navigate("/login");
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Tooth className="h-10 w-10 mx-auto text-slate-300" />
          <h1 className="text-xl font-bold text-slate-700">Invalid invitation link</h1>
          <p className="text-sm text-slate-500">This link is missing or malformed. Contact your HQ administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#0a1f16]">
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-transparent to-emerald-900/40" />
        <div className="relative flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500 p-2"><Tooth className="h-6 w-6" /></div>
          <span className="text-xl font-bold">Medini Dental Group</span>
        </div>
        <div className="relative space-y-6 max-w-lg">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
            Complete your<br />staff registration
          </h1>
          <p className="text-emerald-100/80 text-lg leading-relaxed">
            Your HQ administrator has invited you. Set your credentials below — your role and branch are already assigned.
          </p>
        </div>
        <p className="relative text-xs text-slate-400">© 2026 Medini Dental Group · Enterprise MVP</p>
      </div>

      <div className="w-full lg:w-[480px] bg-white flex flex-col justify-center px-8 sm:px-14">
        <h2 className="text-2xl font-bold text-slate-900">Staff Registration</h2>
        <p className="text-sm text-slate-500 mt-1 mb-6">Complete your account — pending HQ approval</p>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmad bin Ali" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ahmad.ali" autoComplete="username" />
            <p className="text-[11px] text-slate-400">lowercase letters, digits, _ . - only</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm Password</Label>
            <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          </div>
          <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Submit Application
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Already have an account? <a href="/login" className="text-emerald-600 hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  );
}
