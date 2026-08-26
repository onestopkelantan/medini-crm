import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";
import {
  LayoutDashboard, Users, CalendarDays, Stethoscope, FolderOpen, Wallet,
  BarChart3, Megaphone, Building2, MessageSquare, Bot, ShieldCheck, Settings,
  Search, LogOut, ChevronDown, Bell, Menu, X,
} from "lucide-react";
import { Tooth } from "@/components/ToothIcon";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

type NavItem = { label: string; path: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { section?: string; items: NavItem[] };

const navByRole: Record<string, NavSection[]> = {
  hq: [
    { items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }] },
    { section: "Clinical Care", items: [
      { label: "Patients", path: "/patients", icon: Users },
      { label: "Appointments", path: "/appointments", icon: CalendarDays },
      { label: "Clinical", path: "/clinical", icon: Stethoscope },
      { label: "X-Ray & Documents", path: "/documents", icon: FolderOpen },
    ]},
    { section: "Business", items: [
      { label: "Finance", path: "/finance", icon: Wallet },
      { label: "Reports & Analytics", path: "/reports", icon: BarChart3 },
      { label: "Marketing", path: "/marketing", icon: Megaphone },
      { label: "Operations", path: "/operations", icon: Building2 },
    ]},
    { section: "AI & Communication", items: [
      { label: "WhatsApp Hub", path: "/whatsapp", icon: MessageSquare },
      { label: "AI Manager", path: "/ai", icon: Bot },
    ]},
    { section: "System", items: [
      { label: "Administration", path: "/administration", icon: ShieldCheck },
      { label: "Settings", path: "/settings", icon: Settings },
    ]},
  ],
  branch_manager: [
    { items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }] },
    { section: "Clinical Care", items: [
      { label: "Patients", path: "/patients", icon: Users },
      { label: "Appointments", path: "/appointments", icon: CalendarDays },
      { label: "Clinical", path: "/clinical", icon: Stethoscope },
      { label: "X-Ray & Documents", path: "/documents", icon: FolderOpen },
    ]},
    { section: "Business", items: [
      { label: "Finance", path: "/finance", icon: Wallet },
      { label: "Reports", path: "/reports", icon: BarChart3 },
      { label: "Operations", path: "/operations", icon: Building2 },
    ]},
    { section: "AI & Communication", items: [
      { label: "WhatsApp", path: "/whatsapp", icon: MessageSquare },
      { label: "AI Manager", path: "/ai", icon: Bot },
    ]},
    { section: "System", items: [{ label: "Settings", path: "/settings", icon: Settings }] },
  ],
  branch_admin: [
    { items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }] },
    { section: "Daily Operations", items: [
      { label: "Patients", path: "/patients", icon: Users },
      { label: "Appointments", path: "/appointments", icon: CalendarDays },
      { label: "WhatsApp Hub", path: "/whatsapp", icon: MessageSquare },
    ]},
    { section: "System", items: [
      { label: "Settings", path: "/settings", icon: Settings },
    ]},
  ],
  doctor: [
    { items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }] },
    { section: "My Practice", items: [
      { label: "Today's Patients", path: "/appointments", icon: CalendarDays },
      { label: "Patient 360", path: "/patients", icon: Users },
      { label: "Clinical Notes", path: "/clinical", icon: Stethoscope },
    ]},
    { section: "System", items: [
      { label: "Profile", path: "/settings", icon: Settings },
    ]},
  ],
};

const roleLabels: Record<string, string> = {
  hq: "Owner",
  branch_manager: "Branch Manager",
  branch_admin: "Branch Admin",
  doctor: "Doctor",
};

function GlobalSearch() {
  /* S10 T1: backend has no global-search endpoint; patients search via /patients?q= */
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const search = useQuery({
    queryKey: ["search", "patients", q],
    queryFn: () => api.get<Array<{ id: string; name: string; mrn: string; phone: string | null }>>(`/patients?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });

  return (
    <div className="relative w-full max-w-xl">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search patients…"
        className="w-full rounded-full border border-slate-200 bg-slate-50/80 pl-10 pr-4 py-2.5 text-sm outline-none focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-100/60 transition"
      />
      {open && q.length >= 2 && (
        <div className="absolute top-full mt-2 w-full rounded-2xl border border-slate-100 bg-white shadow-xl z-50 overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-1.5">
            {(search.data ?? []).length ? (
              <>
                <p className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase">Patients</p>
                {(search.data ?? []).map((p) => (
                  <button key={p.id} className="w-full text-left px-2 py-2 rounded-xl hover:bg-teal-50 flex items-center gap-3"
                    onClick={() => { navigate(`/patients/${p.id}`); setQ(""); }}>
                    <Avatar className="h-7 w-7"><AvatarFallback className="bg-teal-100 text-teal-700 text-[10px]">{initials(p.name)}</AvatarFallback></Avatar>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.mrn} · {p.phone}</p>
                    </div>
                  </button>
                ))}
              </>
            ) : (
              <p className="px-3 py-4 text-sm text-slate-400 text-center">No results for “{q}”</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user, branch, logout } = useAuth();
  const { branchId, setBranchId } = useBranch();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = navByRole[user?.role ?? "doctor"] ?? [];
  const branches = useQuery({ queryKey: ["admin", "branches"], queryFn: () => api.get<Array<{ id: string; name: string }>>("/admin/branches"), enabled: user?.role === "hq" });
  /* S10 T1: WhatsApp unread badge requires the whatsapp sessions endpoint; deferred. */
  const unread = 0;

  const currentBranchName =
    user?.role === "hq"
      ? branchId
        ? (branches.data ?? []).find((b) => b.id === branchId)?.name ?? "All Branches"
        : "All Branches"
      : branch?.name ?? "—";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F4F7FA]">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0B132B]/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Navy sidebar: static flex child on desktop, off-canvas drawer on mobile ── */}
      <aside className={cn(
        "w-64 h-full flex-shrink-0 bg-[#0B132B] text-slate-300 flex flex-col shadow-2xl z-50",
        "fixed inset-y-0 left-0 lg:static transition-transform duration-300 ease-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-[72px]">
          <div className="rounded-xl bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] p-2 text-white shadow-lg shadow-teal-500/30">
            <Tooth className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display font-bold text-[17px] tracking-wide text-white leading-tight">MEDINI</p>
            <p className="text-[10px] text-teal-300 font-semibold tracking-[0.18em] uppercase">AI CRM</p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto lg:hidden text-slate-400 hover:text-white transition"
            title="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-4 [scrollbar-width:thin]">
          {nav.map((section, si) => (
            <div key={si}>
              {section.section && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{section.section}</p>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path + item.label}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-all",
                      isActive
                        ? "bg-gradient-to-r from-[#0DC9B7] to-[#12B5E5] text-white shadow-lg shadow-teal-500/25"
                        : "hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.path === "/whatsapp" && unread > 0 && (
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">{unread}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Current branch card */}
        <div className="px-3 pb-2">
          <button
            onClick={() => navigate(user?.role === "hq" ? "/operations" : "/settings")}
            className="w-full rounded-2xl bg-white/5 border border-white/10 p-3 text-left hover:bg-white/10 transition group"
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">Current Branch</p>
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#1b2b57] to-[#0DC9B7]/60 flex items-center justify-center text-teal-300">
                <Building2 className="h-4.5 w-4.5 h-[18px] w-[18px]" />
              </div>
              <p className="flex-1 text-[13px] font-semibold text-white truncate">{currentBranchName}</p>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500 group-hover:text-white transition" />
            </div>
          </button>
        </div>

        {/* User profile */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="relative">
              <Avatar className="h-9 w-9 ring-2 ring-teal-400/40">
                <AvatarFallback className="bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] text-white text-xs font-semibold">{initials(user?.name ?? "?")}</AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B132B]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">{user?.name}</p>
              <p className="text-[11px] text-teal-300/90 truncate">{roleLabels[user?.role ?? ""] ?? user?.role} · Online</p>
            </div>
            <button onClick={async () => { await logout(); navigate("/login"); }} className="text-slate-500 hover:text-white transition" title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main right column: the ONLY scroll area ──────────────── */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-y-auto relative">
        {/* Light header */}
        <header className="w-full sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 sm:px-8 py-4 flex items-center gap-2.5 sm:gap-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden h-10 w-10 shrink-0 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition"
            title="Open menu"
          >
            <Menu className="h-[18px] w-[18px] text-slate-600" />
          </button>
          {user?.role === "hq" ? (
            <Select value={branchId ? String(branchId) : "all"} onValueChange={(v) => setBranchId(v === "all" ? null : v)}>
              <SelectTrigger className="w-40 sm:w-56 h-10 rounded-full text-sm border-slate-200 bg-slate-50/80">
                <Building2 className="h-4 w-4 mr-1.5 text-teal-500" />
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 h-10 rounded-full border border-slate-200 bg-slate-50/80 px-4 text-sm font-medium text-slate-600">
              <Building2 className="h-4 w-4 text-teal-500" /> {branch?.name}
            </div>
          )}

          <div className="flex-1 hidden md:flex justify-center"><GlobalSearch /></div>

          <div className="ml-auto flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] text-white shadow-md shadow-teal-500/30 hover:scale-105 transition"
            title="Medini AI"
          >
            <Tooth className="h-4.5 w-4.5 h-[18px] w-[18px]" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger className="relative h-10 w-10 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition">
              <Bell className="h-[18px] w-[18px] text-slate-500" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center shadow">{unread}</span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/whatsapp")}>
                <MessageSquare className="h-4 w-4 mr-2 text-teal-600" /> {unread} unread WhatsApp messages
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/appointments")}>
                <CalendarDays className="h-4 w-4 mr-2 text-blue-600" /> View today's appointments
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/finance")}>
                <Wallet className="h-4 w-4 mr-2 text-amber-600" /> Pending payments
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 py-1.5 pl-1.5 pr-3 transition">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] text-white text-[10px] font-semibold">{initials(user?.name ?? "?")}</AvatarFallback>
              </Avatar>
              <span className="text-[13px] font-semibold text-slate-700 hidden sm:block">{user?.name?.split(" ")[0] === "Dr" || user?.name?.startsWith("Dr") ? user?.name?.split(" ").slice(0, 2).join(" ") : user?.name?.split(" ")[0]}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel>
                <p className="font-semibold">{user?.name}</p>
                <p className="text-xs text-slate-400 font-normal capitalize">{user?.role?.replace(/_/g, ' ') ?? "—"}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}><Settings className="h-4 w-4 mr-2" /> Settings</DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { await logout(); navigate("/login"); }} className="text-red-600">
                <LogOut className="h-4 w-4 mr-2" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        <main className="p-4 sm:p-8 space-y-8">
          <Outlet />
        </main>
      </div>
      <Toaster position="top-right" richColors />
    </div>
  );
}
