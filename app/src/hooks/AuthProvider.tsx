import { useEffect, useState, type ReactNode } from "react";
import { initAuth, login as authLogin, logout as authLogout, fetchMe, type AuthUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { AuthContext, type Branch } from "@/hooks/useAuth";

/**
 * AuthProvider — the component half of the auth context.
 *
 * WHY THIS FILE EXISTS
 *
 * React Fast Refresh only works when a module exports components and nothing
 * else. `useAuth.tsx` exported the provider component AND the `useAuth` hook,
 * so any edit forced a full reload. The context + hook stay in `useAuth.tsx`
 * (25 importers); only the provider moved here. Behaviour is unchanged.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => initAuth());
  const [branch, setBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadBranch = (u: AuthUser | null) => { if (!u?.branchId) { setBranch(null); return; } api.get<Branch>("/doctor-registration/branch").then(setBranch).catch(() => setBranch(null)); };
  useEffect(() => { fetchMe().then((me) => { setUser(me); loadBranch(me); setIsLoading(false); }); }, []);
  const value = { user, branch, isLoading, login: async (username: string, password: string) => { const u = await authLogin(username, password); setUser(u); loadBranch(u); }, logout: async () => { await authLogout(); setUser(null); setBranch(null); }, refetch: () => { fetchMe().then((u) => { setUser(u); loadBranch(u); }); } };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
