import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, User, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";

/**
 * Login — antislop redesign (L1).
 *
 * WHAT WAS WRONG (checked against antislop-ui)
 *
 * - The left panel was a theme park: orbiting dashed ring, pulsing
 *   "AI Core" node with glow, four breathing satellite nodes, traveling
 *   dashes on spokes, a floating container AND a wave canvas behind it
 *   — six simultaneous endless animations (R-19 motion wallpaper),
 *   glow on glow (R-13), an AI-orb diagram that told a clinic staff
 *   member nothing about logging in.
 * - Radial teal/cyan orbs in the background (the default-family tell),
 *   "MediniOS AI CORE" robot-vocabulary branding, a "SECURE ACCESS"
 *   divider badge (R-09: a badge restating what the form already is),
 *   emoji in the heading (R-04), arrow on the CTA (R-08).
 * - 11px-rounded inputs fighting the brand's sharp buttons.
 *
 * WHAT IT IS NOW
 *
 * The clinic's own voice: warm off-white, navy panel with the tooth
 * mark, flat Medini green used ONCE (the sign-in button), and content
 * the person logging in recognises — their branches, their group.
 * Motion: none except the loading state. Login is a door, not a ride.
 *
 * The dev-only demo accounts stay (UAT), tucked quietly at the bottom.
 */

/* Real, verifiable — the group's own registered line. */
const BRANCH_LINE = "Dental branches · Johor";

function ToothLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} stroke="#54b648">
      <path d="M12 2C7.5 2 4 4.5 4 8c0 3 1.5 5.5 2 9 0.5 3.5 2.5 5 4 5s2-3 2-4.5c0 1.5 0.5 4.5 2 4.5s3.5-1.5 4-5c0.5-3.5 2-6 2-9 0-3.5-3.5-6-8-6z" />
    </svg>
  );
}

const demoAccounts = [
  { role: "HQ Super Admin", username: "hq", desc: "Full access · all 14 branches" },
  { role: "Branch Manager", username: "manager", desc: "One branch · full branch control" },
  { role: "Branch Admin", username: "reception", desc: "Reception · daily operations" },
  { role: "Doctor", username: "doctor", desc: "Clinical workspace only" },
];
const isDev = import.meta.env.DEV;

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      await login(username.trim(), password);
      toast.success("Welcome back");
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(errorMessage(err, "Invalid username or password. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* ===== LEFT (desktop): brand panel, KuasaOS-style emerald gradient ===== */}
      <div
        className="hidden w-[46%] flex-col justify-between gap-6 overflow-y-auto p-8 lg:flex xl:p-12"
        style={{ background: "linear-gradient(150deg, #14532d 0%, #166534 45%, #15803d 75%, #16a34a 100%)" }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
            <ToothLogo className="h-6 w-6" />
          </div>
          <div>
            <p className="font-display text-lg font-bold leading-none text-white">MEDINI</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Dental Group</p>
          </div>
        </div>

        {/* The one sentence this screen needs */}
        <div className="max-w-md">
          <h1 className="font-display text-[clamp(1.7rem,2.4vw,2.3rem)] font-bold leading-[1.15] tracking-tight text-white">
            Sistem pengurusan klinik
            <br />
            Medini Dental Group
          </h1>
          <p className="mt-4 leading-relaxed text-white/75">
            Pesakit, temujanji, kewangan dan rawatan, satu tempat, semua cawangan.
          </p>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-white/50">
            {BRANCH_LINE}
          </p>
        </div>

        {/* Grounded footer, the real company line, no invented claims */}
        <p className="text-[11px] leading-relaxed text-white/50">
          Medini Dental Group · 201401017657 (1093744-H)
        </p>
      </div>

      {/* ===== RIGHT: the form, quiet and sharp ===== */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 lg:py-10">
        {/* Mobile brand */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <ToothLogo />
          <p className="font-display text-lg font-bold leading-none text-foreground">MEDINI</p>
        </div>

        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Sign in</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Enter your staff username and password.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive"
            >
              {error}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username" className="text-sm font-semibold text-foreground">
                Username
              </Label>
              <div className="relative flex items-center">
                <User className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. hq"
                  required
                  autoComplete="username"
                  className="h-11 rounded-xl pl-9 pr-3 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-sm font-semibold text-foreground">
                Password
              </Label>
              <div className="relative flex items-center">
                <Lock className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="h-11 rounded-xl pl-9 pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2.5 flex items-center p-1.5 text-muted-foreground transition hover:text-foreground"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="btn-brand mt-1 h-11">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          {/* Dev-only demo accounts, same behavior as before, quieter chrome. */}
          {isDev && (
            <div className="mt-8 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowDemo(!showDemo)}
                className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-foreground"
              >
                <span>UAT demo accounts</span>
                <span>{showDemo ? "−" : "+"}</span>
              </button>
              {showDemo && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {demoAccounts.map((a) => (
                    <button
                      key={a.username}
                      type="button"
                      onClick={() => {
                        setUsername(a.username);
                        setPassword("");
                        setError(null);
                      }}
                      className="rounded-md border border-border bg-card p-2.5 text-left transition hover:border-primary/40"
                    >
                      <p className="text-xs font-semibold text-foreground">{a.role}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{a.desc}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{a.username}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Forgot your password? Contact your branch HQ administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
