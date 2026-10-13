import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { usePrefs } from "@/hooks/usePrefs";
import { LanguageToggle, ThemeToggle } from "@/components/layout/PrefsControls";
import { useBranch } from "@/hooks/useBranch";
import {
  LayoutDashboard, Users, CalendarDays, Stethoscope, FolderOpen, Wallet,
  BarChart3, Megaphone, Building2, MessageSquare, Bot, ShieldCheck, Settings, FileSignature,
  Search, LogOut, ChevronDown, Menu, X, Sparkles,
  Package,
} from "lucide-react";
import NotificationBell from "./NotificationBell";
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

/* FASA A — nav menyimpan KUNCI terjemahan, bukan teks.
   Teks dipilih semasa render mengikut bahasa pengguna. */
type NavItem = { labelKey: string; path: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { sectionKey?: string; items: NavItem[] };

const navByRole: Record<string, NavSection[]> = {
  hq: [
    { items: [{ labelKey: "nav.dashboard", path: "/dashboard", icon: LayoutDashboard }, { labelKey: "nav.assistant", path: "/assistant", icon: Sparkles }] },
    { sectionKey: "nav.clinicalCare", items: [
      { labelKey: "nav.patients", path: "/patients", icon: Users },
      { labelKey: "nav.appointments", path: "/appointments", icon: CalendarDays },
      { labelKey: "nav.clinical", path: "/clinical", icon: Stethoscope },
      { labelKey: "nav.forms", path: "/forms", icon: FileSignature },
      { labelKey: "nav.documents", path: "/documents", icon: FolderOpen },
    ]},
    { sectionKey: "nav.business", items: [
      { labelKey: "nav.finance", path: "/finance", icon: Wallet },
      { labelKey: "nav.reports", path: "/reports", icon: BarChart3 },
      { labelKey: "nav.marketing", path: "/marketing", icon: Megaphone },
      { labelKey: "nav.operations", path: "/operations", icon: Building2 },
      { labelKey: "nav.inventory", path: "/inventory", icon: Package },
    ]},
    { sectionKey: "nav.aiComms", items: [
      { labelKey: "nav.whatsappHub", path: "/whatsapp", icon: MessageSquare },
      { labelKey: "nav.whatsappCampaign", path: "/whatsapp-blast", icon: Megaphone },
      { labelKey: "nav.bookingRecords", path: "/booking-requests", icon: MessageSquare },
      { labelKey: "nav.doctorSchedule", path: "/doctor-schedule", icon: CalendarDays },
      { labelKey: "nav.nurseSchedule", path: "/nurse-schedule", icon: CalendarDays },
      { labelKey: "nav.aiManager", path: "/ai", icon: Bot },
    ]},
    { sectionKey: "nav.system", items: [
      { labelKey: "nav.administration", path: "/administration", icon: ShieldCheck },
      { labelKey: "nav.settings", path: "/settings", icon: Settings },
    ]},
  ],
  branch_manager: [
    { items: [{ labelKey: "nav.dashboard", path: "/dashboard", icon: LayoutDashboard }, { labelKey: "nav.assistant", path: "/assistant", icon: Sparkles }] },
    { sectionKey: "nav.clinicalCare", items: [
      { labelKey: "nav.patients", path: "/patients", icon: Users },
      { labelKey: "nav.appointments", path: "/appointments", icon: CalendarDays },
      { labelKey: "nav.clinical", path: "/clinical", icon: Stethoscope },
      { labelKey: "nav.forms", path: "/forms", icon: FileSignature },
      { labelKey: "nav.documents", path: "/documents", icon: FolderOpen },
    ]},
    { sectionKey: "nav.business", items: [
      { labelKey: "nav.finance", path: "/finance", icon: Wallet },
      { labelKey: "nav.reports", path: "/reports", icon: BarChart3 },
      { labelKey: "nav.operations", path: "/operations", icon: Building2 },
      { labelKey: "nav.inventory", path: "/inventory", icon: Package },
    ]},
    { sectionKey: "nav.aiComms", items: [
      { labelKey: "nav.whatsappHub", path: "/whatsapp", icon: MessageSquare },
      { labelKey: "nav.whatsappCampaign", path: "/whatsapp-blast", icon: Megaphone },
      { labelKey: "nav.bookingRecords", path: "/booking-requests", icon: MessageSquare },
      { labelKey: "nav.aiManager", path: "/ai", icon: Bot },
    ]},
    { sectionKey: "nav.system", items: [
      { labelKey: "nav.settings", path: "/settings", icon: Settings },
      { labelKey: "nav.administration", path: "/administration", icon: Users },
      { labelKey: "nav.doctorSchedule", path: "/doctor-schedule", icon: CalendarDays },
      { labelKey: "nav.nurseSchedule", path: "/nurse-schedule", icon: CalendarDays },
    ] },
  ],
  branch_admin: [
    { items: [{ labelKey: "nav.dashboard", path: "/dashboard", icon: LayoutDashboard }, { labelKey: "nav.assistant", path: "/assistant", icon: Sparkles }] },
    { sectionKey: "nav.clinicalCare", items: [
      { labelKey: "nav.patients", path: "/patients", icon: Users },
      { labelKey: "nav.appointments", path: "/appointments", icon: CalendarDays },
    ]},
    { sectionKey: "nav.aiComms", items: [
      { labelKey: "nav.whatsappHub", path: "/whatsapp", icon: MessageSquare },
      { labelKey: "nav.bookingRecords", path: "/booking-requests", icon: MessageSquare },
    ]},
    { sectionKey: "nav.system", items: [
      { labelKey: "nav.settings", path: "/settings", icon: Settings },
    ]},
  ],
  doctor: [
    { items: [{ labelKey: "nav.dashboard", path: "/dashboard", icon: LayoutDashboard }, { labelKey: "nav.assistant", path: "/assistant", icon: Sparkles }] },
    { sectionKey: "nav.myPractice", items: [
      { labelKey: "nav.todaysPatients", path: "/appointments", icon: CalendarDays },
      { labelKey: "nav.patient360", path: "/patients", icon: Users },
      { labelKey: "nav.clinicalNotes", path: "/clinical", icon: Stethoscope },
    ]},
    { sectionKey: "nav.aiComms", items: [
      { labelKey: "nav.whatsappHub", path: "/whatsapp", icon: MessageSquare },
      { labelKey: "nav.whatsappCampaign", path: "/whatsapp-blast", icon: Megaphone },
      { labelKey: "nav.marketing", path: "/marketing", icon: Megaphone },
    ]},
    { sectionKey: "nav.system", items: [
      { labelKey: "nav.profile", path: "/settings", icon: Settings },
    ]},
  ],
};

const roleKeys: Record<string, string> = {
  hq: "role.hq",
  branch_manager: "role.branchManager",
  branch_admin: "role.branchAdmin",
  doctor: "role.doctor",
};

/* KuasaOS-style module accents — satu warna per domain/section.
 * Warna ikut hue KuasaOS: emerald (brand), teal (clinical), indigo (business),
 * magenta/pink (AI & comms), neutral (system). */
type ModuleAccent = {
  key: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** tailwind-friendly hsl triplets */
  solid: string;   // active rail icon bg
  soft: string;    // active nav pill bg
  ink: string;     // active nav pill text
};
const MODULE_ACCENTS: Record<string, ModuleAccent> = {
  overview:  { key: "overview",  labelKey: "nav.groupOverview", icon: LayoutDashboard, solid: "bg-emerald-600", soft: "bg-emerald-600/10", ink: "text-emerald-700" },
  clinical:  { key: "clinical",  labelKey: "nav.clinicalCare",  icon: Stethoscope,     solid: "bg-teal-600",    soft: "bg-teal-600/10",    ink: "text-teal-700" },
  business:  { key: "business",  labelKey: "nav.business",      icon: Wallet,          solid: "bg-indigo-600",  soft: "bg-indigo-600/10",  ink: "text-indigo-700" },
  comms:     { key: "comms",     labelKey: "nav.aiComms",       icon: MessageSquare,   solid: "bg-pink-600",    soft: "bg-pink-600/10",    ink: "text-pink-700" },
  system:    { key: "system",    labelKey: "nav.system",        icon: ShieldCheck,     solid: "bg-slate-600",   soft: "bg-slate-600/10",   ink: "text-slate-700" },
  myPractice:{ key: "myPractice",labelKey: "nav.myPractice",    icon: Stethoscope,     solid: "bg-teal-600",    soft: "bg-teal-600/10",    ink: "text-teal-700" },
};

/** Map a nav section (by its sectionKey, or undefined = top overview items) to a module key. */
function sectionModuleKey(section: NavSection): string {
  if (!section.sectionKey) return "overview";
  const k = section.sectionKey;
  if (k.includes("clinicalCare") || k.includes("myPractice")) return k.includes("myPractice") ? "myPractice" : "clinical";
  if (k.includes("business")) return "business";
  if (k.includes("aiComms")) return "comms";
  if (k.includes("system")) return "system";
  return "overview";
}

function GlobalSearch() {
  /* S10 T1: backend has no global-search endpoint; patients search via /patients?q= */
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = usePrefs();
  const search = useQuery({
    queryKey: ["search", "patients", q],
    queryFn: () => api.get<Array<{ id: string; name: string; mrn: string; phone: string | null }>>(`/patients?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });

  return (
    <div className="relative w-full max-w-xl">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={t("nav.searchPlaceholder")}
        className="w-full rounded-full border border-border bg-muted/80 pl-10 pr-4 py-2.5 text-sm outline-none focus:border-border focus:bg-card focus:ring-4 focus:ring-primary/20 transition"
      />
      {open && q.length >= 2 && (
        <div className="absolute top-full mt-2 w-full rounded-lg border border-border bg-card shadow-sm z-50 overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-1.5">
            {(search.data ?? []).length ? (
              <>
                <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase">Patients</p>
                {(search.data ?? []).map((p) => (
                  <button key={p.id} className="w-full text-left px-2 py-2 rounded-xl hover:bg-accent flex items-center gap-3"
                    onClick={() => { navigate(`/patients/${p.id}`); setQ(""); }}>
                    <Avatar className="h-7 w-7"><AvatarFallback className="bg-primary/15 text-foreground text-[10px]">{initials(p.name)}</AvatarFallback></Avatar>
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.mrn} · {p.phone}</p>
                    </div>
                  </button>
                ))}
              </>
            ) : (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">No results for “{q}”</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user, branch, logout } = useAuth();
  const { t } = usePrefs();
  const { branchId, setBranchId } = useBranch();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const nav = navByRole[user?.role ?? "doctor"] ?? [];
  const branches = useQuery({ queryKey: ["admin", "branches"], queryFn: () => api.get<Array<{ id: string; shortName: string }>>("/admin/branches"), enabled: user?.role === "hq" });
  const currentBranch = useQuery({ queryKey: ["current-branch", user?.branchId], queryFn: () => api.get<{ name: string }>("/doctor-registration/branch"), enabled: !!user?.branchId && user?.role !== "hq" });
  /* WhatsApp unread badge — live count from the notifications endpoint.
   *
   * The path and the field name are BOTH load-bearing and both were wrong:
   * the route lives under `whatsapp/notifications` (prefix of
   * NotificationController), and the payload is `{ unread: n }`. A path typo
   * returns 404 and a field typo renders 0 — neither throws, so the badge
   * simply never appeared and nothing looked broken. */
  const unreadCount = useQuery({
    queryKey: ["whatsapp", "unread-count"],
    queryFn: () => api.get<{ unread: number }>("/whatsapp/notifications/unread-count"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const unread = unreadCount.data?.unread ?? 0;

  const currentBranchName =
    user?.role === "hq"
      ? branchId
        ? (branches.data ?? []).find((b) => b.id === branchId)?.shortName ?? t("common.allBranches")
        : t("common.allBranches")
      : currentBranch.data?.name ?? "—";

  /* KuasaOS rail behaviour: rail icons = MODULES (sections), not duplicated items.
   * Sidebar kanan menunjukkan menu untuk module yang aktif sahaja — takde dua lapis. */
  const activePath = location.pathname;
  const pathModule = nav.reduce<string | null>((found, section) => {
    if (found) return found;
    return section.items.some((it) => activePath === it.path || activePath.startsWith(it.path + "/"))
      ? sectionModuleKey(section)
      : null;
  }, null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const activeModule = pathModule ?? selectedModule ?? "overview";
  const visibleSections = nav.filter((s) => sectionModuleKey(s) === activeModule);
  const railModules = [...new Set(nav.map(sectionModuleKey))];
  const accent = MODULE_ACCENTS[activeModule] ?? MODULE_ACCENTS.overview;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-muted/30">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Icon rail (KuasaOS product-rail style) ── */}
      <aside className="hidden lg:flex h-full w-16 shrink-0 flex-col items-center border-r border-border bg-card py-3 z-50">
        <NavLink to="/dashboard" aria-label="Medini home" className="mb-3">
          <div className="size-9 rounded-xl bg-primary grid place-items-center">
            <span className="font-display font-bold text-primary-foreground text-sm">M</span>
          </div>
        </NavLink>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {railModules.map((modKey) => {
            const mod = MODULE_ACCENTS[modKey] ?? MODULE_ACCENTS.overview;
            const firstPath = nav.find((s) => sectionModuleKey(s) === modKey)?.items[0]?.path ?? "/dashboard";
            const isActive = modKey === activeModule;
            return (
              <button
                key={modKey}
                onClick={() => { setSelectedModule(modKey); if (!pathModule || pathModule !== modKey) navigate(firstPath); }}
                title={t(mod.labelKey)}
                aria-label={t(mod.labelKey)}
                className={cn(
                  "grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors",
                  isActive
                    ? cn(mod.solid, "text-white")
                    : "hover:bg-muted hover:text-foreground",
                )}
              >
                <mod.icon className="h-5 w-5" />
              </button>
            );
          })}
        </nav>
        <div className="flex flex-col items-center gap-1">
          <NavLink
            to="/settings"
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
            className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Settings className="h-5 w-5" />
          </NavLink>
          <button
            onClick={async () => { await logout(); navigate("/login"); }}
            title="Log out"
            aria-label="Log out"
            className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </aside>

      {/* ── Secondary nav (KuasaOS secondary-nav style, white) ── */}
      <aside className={cn(
        "w-60 h-full shrink-0 overflow-hidden bg-card border-r border-border flex flex-col z-40",
        "fixed inset-y-0 left-0 lg:static transition-transform duration-300 ease-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}>
        {/* Product header — ikut warna module aktif */}
        <div className="px-4 py-4 flex items-start justify-between">
          <div>
            <p className={cn("text-sm font-bold leading-tight", accent.ink)}>MEDINI AI CRM</p>
            <p className="text-xs text-muted-foreground">{t(accent.labelKey)}</p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-muted-foreground hover:text-foreground transition"
            title="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav — filtered ikut module aktif (satu domain je, takde duplicate) */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {visibleSections.map((section, si) => (
            <div key={si} className="mb-5">
              {section.sectionKey && (
                <p className={cn("px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider", accent.ink, "opacity-70")}>{t(section.sectionKey)}</p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.path + item.labelKey}>
                    <NavLink
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        isActive && cn(accent.soft, accent.ink, "hover:text-current"),
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate flex-1">{t(item.labelKey)}</span>
                      {item.path === "/whatsapp" && unread > 0 && (
                        <span className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-pink-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">{unread}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Current branch */}
        <div className="px-3 pb-2">
          <button
            onClick={() => navigate(user?.role === "hq" ? "/operations" : "/settings")}
            className="w-full rounded-lg bg-muted/60 border border-border p-3 text-left hover:bg-muted transition group"
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{t("common.currentBranch")}</p>
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="h-4 w-4" />
              </div>
              <p className="flex-1 text-[13px] font-semibold text-foreground truncate">{currentBranchName}</p>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition" />
            </div>
          </button>
        </div>

        {/* User footer */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">{initials(user?.name ?? "?")}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">{user?.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{t(roleKeys[user?.role ?? ""] ?? "")} · {t("common.online")}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar (KuasaOS app-topbar style: h-14, border-b) */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition"
            title="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          {user?.role === "hq" ? (
            <Select value={branchId ? String(branchId) : "all"} onValueChange={(v) => setBranchId(v === "all" ? null : v)}>
              <SelectTrigger className="w-40 sm:w-52 h-9 rounded-lg text-sm border-border bg-muted/60">
                <Building2 className="h-4 w-4 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder={t("common.allBranches")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.allBranches")}</SelectItem>
                {(branches.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.shortName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="hidden sm:flex items-center gap-2 h-9 rounded-lg border border-border bg-muted/60 px-3 text-sm font-medium text-muted-foreground">
              <Building2 className="h-4 w-4" /> {branch?.name}
            </div>
          )}

          <div className="flex-1 hidden md:flex justify-center"><GlobalSearch /></div>

          <div className="ml-auto flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle />
            <NotificationBell />

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg hover:bg-accent py-1.5 pl-1.5 pr-2.5 transition">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-semibold">{initials(user?.name ?? "?")}</AvatarFallback>
                </Avatar>
                <span className="text-[13px] font-semibold text-foreground hidden sm:block">{user?.name?.split(" ")[0] === "Dr" || user?.name?.startsWith("Dr") ? user?.name?.split(" ").slice(0, 2).join(" ") : user?.name?.split(" ")[0]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                <DropdownMenuLabel>
                  <p className="font-semibold">{user?.name}</p>
                  <p className="text-xs text-muted-foreground font-normal capitalize">{user?.role?.replace(/_/g, " ") ?? "—"}</p>
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

        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      <Toaster position="top-right" richColors />
    </div>
  );
}
