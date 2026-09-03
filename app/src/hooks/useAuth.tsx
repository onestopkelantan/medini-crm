import { createContext, useContext, type ReactNode, useEffect, useState } from "react";
import { initAuth, login as authLogin, logout as authLogout, fetchMe, type AuthUser } from "@/lib/auth";
import { api } from "@/lib/api";

type Branch = { id: string; name: string };
type AuthContextValue = { user: AuthUser | null; branch: Branch | null; isLoading: boolean; login: (username: string, password: string) => Promise<void>; logout: () => Promise<void>; refetch: () => void };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => initAuth());
  const [branch, setBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadBranch = (u: AuthUser | null) => { if (!u?.branchId) { setBranch(null); return; } api.get<Branch>("/doctor-registration/branch").then(setBranch).catch(() => setBranch(null)); };
  useEffect(() => { fetchMe().then((me) => { setUser(me); loadBranch(me); setIsLoading(false); }); }, []);
  const value: AuthContextValue = { user, branch, isLoading, login: async (username, password) => { const u = await authLogin(username, password); setUser(u); loadBranch(u); }, logout: async () => { await authLogout(); setUser(null); setBranch(null); }, refetch: () => { fetchMe().then((u) => { setUser(u); loadBranch(u); }); } };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("useAuth must be used within AuthProvider"); return ctx; }
