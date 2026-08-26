import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, User, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Users, TrendingUp, Activity, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";

/* MediniOS login — design: gemini-code mockup (hero ecosystem + auth card).
   Functionality: REAL auth via useAuth().login() → POST /api/v1/auth/login. */

const demoAccounts = [
  { role: "HQ Super Admin", username: "hq", desc: "Full access · all 14 branches", color: "border-emerald-300 bg-emerald-50" },
  { role: "Branch Manager", username: "manager", desc: "One branch · full branch control", color: "border-blue-300 bg-blue-50" },
  { role: "Branch Admin", username: "reception", desc: "Reception · daily operations", color: "border-amber-300 bg-amber-50" },
  { role: "Doctor", username: "doctor", desc: "Clinical workspace only", color: "border-violet-300 bg-violet-50" },
];
const isDev = import.meta.env.DEV;

function ToothLogo({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} stroke="#0DC9B7">
      <path d="M12 2C7.5 2 4 4.5 4 8c0 3 1.5 5.5 2 9 0.5 3.5 2.5 5 4 5s2-3 2-4.5c0 1.5 0.5 4.5 2 4.5s3.5-1.5 4-5c0.5-3.5 2-6 2-9 0-3.5-3.5-6-8-6z" />
    </svg>
  );
}

/* Canvas wave — subtle animated background (Layer 1). Lightweight rAF, honours reduced-motion. */
function WaveCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let step = 0;
    const resize = () => {
      if (!canvas.parentElement) return;
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
    };
    window.addEventListener("resize", resize);
    resize();
    const lines = [
      { amplitude: 22, frequency: 0.002, speed: 0.008, color: "rgba(13,201,183,0.08)", yOffset: 0.70 },
      { amplitude: 30, frequency: 0.0018, speed: 0.006, color: "rgba(18,181,229,0.06)", yOffset: 0.78 },
    ];
    const render = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      step++;
      for (const l of lines) {
        ctx.beginPath();
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1.2;
        for (let x = 0; x < width; x += 8) {
          const y = height * l.yOffset + Math.sin(x * l.frequency + step * l.speed) * l.amplitude;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      raf = requestAnimationFrame(render);
    };
    render();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none z-[1] opacity-30" />;
}

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
      toast.success("Welcome to MediniOS");
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(errorMessage(err, "Invalid username or password. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full min-h-screen lg:h-screen lg:overflow-hidden bg-[#F4F7FA]">
      {/* ===== LEFT: Hero ecosystem panel (desktop) ===== */}
      <div
        className="hidden lg:flex flex-col justify-between relative overflow-hidden text-white h-full p-[clamp(36px,4.5vh,56px)_clamp(40px,4vw,64px)]"
        style={{
          flex: 1.13,
          backgroundColor: "#0B132B",
          backgroundImage:
            "radial-gradient(circle at 85% 70%, rgba(18,181,229,0.08) 0%, transparent 48%), radial-gradient(circle at 15% 85%, rgba(13,201,183,0.05) 0%, transparent 42%)",
        }}
      >
        <WaveCanvas />

        {/* Brand + hero copy */}
        <div className="relative z-20 max-w-[500px]">
          <div className="flex items-center gap-3.5">
            <div className="w-[38px] h-[38px] flex items-center justify-center shrink-0" style={{ filter: "drop-shadow(0 0 8px rgba(13,201,183,0.35))" }}>
              <ToothLogo />
            </div>
            <div>
              <h1 className="font-display font-bold leading-none tracking-tight text-white" style={{ fontSize: "clamp(1.75rem,2.2vw,2.1rem)" }}>
                Medini<span className="bg-clip-text text-transparent bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5]">OS</span>
              </h1>
              <p className="text-[0.65rem] tracking-[2px] uppercase text-slate-400 font-semibold mt-1">AI Operating System for Dental Care</p>
            </div>
          </div>
          <div className="mt-[clamp(24px,3.8vh,44px)]">
            <h2 className="font-display font-extrabold leading-[1.12] tracking-tight text-white mb-[clamp(12px,1.8vh,18px)]" style={{ fontSize: "clamp(2.1rem,2.7vw,2.85rem)" }}>
              The AI Operating System<br />for Modern Dental Care
            </h2>
            <p className="leading-relaxed text-slate-400 max-w-[410px]" style={{ fontSize: "clamp(0.95rem,1.1vw,1.05rem)" }}>
              Unify patients, teams and operations with intelligent automation.
            </p>
          </div>
        </div>

        {/* Ecosystem stage */}
        <div className="absolute bottom-[clamp(10px,3.5vh,40px)] right-[clamp(-10px,1vw,25px)] w-[420px] h-[420px] z-[5] pointer-events-none" style={{ animation: "ecoFloat 9s ease-in-out infinite" }}>
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 420 420">
            {[["210","50"],["370","210"],["210","370"],["50","210"]].map(([x, y], i) => (
              <g key={i}>
                <line x1={x} y1={y} x2="210" y2="210" fill="none" stroke="#12B5E5" strokeWidth="1.2" opacity="0.18" strokeDasharray="4 4" />
                <line x1={x} y1={y} x2="210" y2="210" fill="none" stroke="#0DC9B7" strokeWidth="1.5" strokeDasharray="40 340" style={{ animation: `pulseTravel 7.5s ease-in-out infinite`, animationDelay: `${i * 1.85}s`, opacity: 0 }} />
              </g>
            ))}
          </svg>
          <div className="absolute top-1/2 left-1/2 w-[240px] h-[240px] rounded-full border border-dashed border-[rgba(18,181,229,0.14)]" style={{ transform: "translate(-50%,-50%)", animation: "rotateOrbit 45s linear infinite" }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92px] h-[92px] rounded-full flex flex-col items-center justify-center text-center"
            style={{ background: "radial-gradient(circle, rgba(13,201,183,0.16) 0%, rgba(11,19,43,0.96) 80%)", border: "1.2px solid rgba(13,201,183,0.45)", animation: "coreGlow 6s ease-in-out infinite" }}>
            <div className="font-display font-bold text-white text-[0.88rem] tracking-tight">MediniOS</div>
            <div className="text-[0.58rem] font-bold tracking-[1.4px] text-[#0DC9B7] uppercase mt-0.5">AI Core</div>
          </div>
          {[
            { pos: "top-[12%] left-1/2", label: "Patients", icon: <Users className="w-[19px] h-[19px]" />, delay: "0s" },
            { pos: "top-1/2 left-[88%]", label: "Business Intelligence", icon: <TrendingUp className="w-[19px] h-[19px]" />, delay: "1.5s" },
            { pos: "top-[88%] left-1/2", label: "Clinical Care", icon: <Activity className="w-[19px] h-[19px]" />, delay: "3s" },
            { pos: "top-1/2 left-[12%]", label: "Appointments", icon: <Calendar className="w-[19px] h-[19px]" />, delay: "4.5s" },
          ].map((n) => (
            <div key={n.label} className={`absolute flex flex-col items-center gap-1.5 -translate-x-1/2 -translate-y-1/2 ${n.pos}`} style={{ animation: `nodeBreathing 6s ease-in-out infinite`, animationDelay: n.delay }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-[#12B5E5]" style={{ background: "rgba(11,19,43,0.88)", border: "1px solid rgba(18,181,229,0.35)", boxShadow: "0 0 12px rgba(18,181,229,0.12)" }}>
                {n.icon}
              </div>
              <span className="text-[0.62rem] font-semibold tracking-[1px] uppercase text-slate-400 text-center whitespace-nowrap leading-tight">{n.label}</span>
            </div>
          ))}
        </div>
        <div />
      </div>

      {/* ===== RIGHT: Auth panel ===== */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-[clamp(24px,3vh,40px)_24px] h-full overflow-hidden">
        <div className="absolute -bottom-[100px] -right-[100px] w-[300px] h-[300px] rounded-full pointer-events-none" style={{ border: "30px solid rgba(18,181,229,0.03)" }} />

        {/* Mobile brand */}
        <div className="lg:hidden flex items-center gap-2.5 mb-5">
          <div className="w-[30px] h-[30px]"><ToothLogo /></div>
          <h1 className="font-display font-bold text-[#0B132B] leading-none text-[1.65rem]">
            Medini<span className="bg-clip-text text-transparent bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5]">OS</span>
          </h1>
        </div>

        <div className="bg-white w-full max-w-[480px] rounded-[20px] p-[clamp(28px,3.5vh,42px)_clamp(24px,3vw,38px)] border border-[rgba(226,232,240,0.85)] z-10 relative" style={{ boxShadow: "0 20px 50px rgba(11,19,43,0.07)" }}>
          <div>
            <h3 className="font-display font-bold text-[#0B132B] tracking-tight" style={{ fontSize: "clamp(1.6rem,2vw,1.85rem)" }}>Welcome back 👋</h3>
            <p className="mt-1.5 text-slate-500 leading-snug" style={{ fontSize: "clamp(0.85rem,0.95vw,0.92rem)" }}>Sign in to your MediniOS workspace to continue</p>
          </div>

          {error && (
            <div role="alert" className="mt-3.5 rounded-lg px-3.5 py-2.5 text-[0.82rem] font-medium leading-snug text-[#F43F5E]" style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.3)" }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} className="mt-[clamp(18px,2.5vh,26px)] flex flex-col gap-[clamp(14px,1.8vh,18px)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username" className="font-semibold text-[#0B132B]" >Username</Label>
              <div className="relative flex items-center">
                <User className="absolute left-[15px] text-slate-400 w-[18px] h-[18px] pointer-events-none" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  autoComplete="username"
                  className="h-[clamp(48px,5.2vh,54px)] pl-[46px] pr-[44px] rounded-[11px] text-[0.94rem] focus-visible:border-[#0DC9B7] focus-visible:ring-[3px] focus-visible:ring-[rgba(13,201,183,0.15)]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="font-semibold text-[#0B132B]">Password</Label>
              <div className="relative flex items-center">
                <Lock className="absolute left-[15px] text-slate-400 w-[18px] h-[18px] pointer-events-none" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="h-[clamp(48px,5.2vh,54px)] pl-[46px] pr-[44px] rounded-[11px] text-[0.94rem] focus-visible:border-[#0DC9B7] focus-visible:ring-[3px] focus-visible:ring-[rgba(13,201,183,0.15)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label="Toggle password visibility"
                  className="absolute right-[14px] text-slate-400 hover:text-[#0B132B] transition p-1.5 flex items-center"
                >
                  {showPw ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-1 h-[clamp(48px,5.2vh,54px)] rounded-[11px] font-semibold text-white border-0 flex items-center justify-center gap-2 transition hover:-translate-y-px"
              style={{ background: "linear-gradient(135deg, #0DC9B7, #12B5E5)", boxShadow: "0 8px 22px rgba(13,201,183,0.22)", fontSize: "clamp(0.94rem,1vw,1rem)" }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><span>Sign in</span><ArrowRight className="w-4 h-4" /></>}
            </Button>
          </form>

          <div className="mt-[clamp(20px,2.8vh,28px)] relative text-center flex flex-col items-center">
            <div className="w-full h-px bg-[#E2E8F0] absolute top-[9px]" />
            <span className="bg-white px-3 text-[0.68rem] text-slate-400 font-semibold uppercase tracking-[0.8px] relative z-[1]">Secure access</span>
            <div className="mt-2.5 flex items-center gap-[7px] text-slate-500" style={{ fontSize: "clamp(0.75rem,0.8vw,0.79rem)" }}>
              <ShieldCheck className="w-[15px] h-[15px] text-[#0DC9B7]" />
              <span>Your workspace is securely protected</span>
            </div>
          </div>

          {/* Demo accounts — UAT only */}
          {isDev && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setShowDemo(!showDemo)}
                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-600 transition"
              >
                <span>UAT demo accounts — password: <code className="text-[#0DC9B7] font-bold">medini123</code></span>
                {showDemo ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showDemo && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {demoAccounts.map((a) => (
                    <button
                      key={a.username}
                      type="button"
                      onClick={() => { setUsername(a.username); setPassword("medini123"); setError(null); }}
                      className={`rounded-xl border p-2.5 text-left transition hover:shadow-sm ${a.color}`}
                    >
                      <p className="text-[12px] font-semibold text-slate-800">{a.role}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{a.desc}</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-mono">{a.username}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-[clamp(16px,2.2vh,24px)] text-[0.78rem] text-slate-400 z-10 text-center">
          &copy; 2026 MediniOS. All rights reserved.
        </div>
      </div>

      {/* Keyframes (scoped, honours reduced-motion via media query in index.css if configured) */}
      <style>{`
        @keyframes rotateOrbit { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }
        @keyframes coreGlow { 0%,100% { box-shadow: 0 0 16px rgba(13,201,183,0.15), 0 0 6px rgba(18,181,229,0.1) inset; border-color: rgba(13,201,183,0.35); } 50% { box-shadow: 0 0 28px rgba(13,201,183,0.28), 0 0 12px rgba(18,181,229,0.2) inset; border-color: rgba(18,181,229,0.65); } }
        @keyframes nodeBreathing { 0%,100% { transform: translate(-50%,-50%) scale(1) translateY(0); } 50% { transform: translate(-50%,-50%) scale(1.025) translateY(-2px); } }
        @keyframes ecoFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes pulseTravel { 0% { stroke-dashoffset: 380; opacity: 0; } 15% { opacity: 0.65; } 85% { opacity: 0.65; } 100% { stroke-dashoffset: -380; opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      `}</style>
    </div>
  );
}
