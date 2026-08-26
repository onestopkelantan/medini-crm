import { createContext, useContext, type ReactNode, useEffect, useState } from "react";
import { initAuth, login as authLogin, logout as authLogout, fetchMe, type AuthUser } from "@/lib/auth";

type AuthContextValue = {
  user: AuthUser | null;
  branch: { id: string; name: string } | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refetch: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => initAuth());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    /* On mount, verify the stored session is still valid by fetching /me. */
    fetchMe().then((me) => {
      setUser(me);
      setIsLoading(false);
    });
  }, []);

  const value: AuthContextValue = {
    user,
    branch: null, /* branch derived from user.branchId via separate lookup if needed */
    isLoading,
    login: async (username, password) => {
      const u = await authLogin(username, password);
      setUser(u);
    },
    logout: async () => {
      await authLogout();
      setUser(null);
    },
    refetch: () => {
      fetchMe().then(setUser);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* eslint-disable-next-line react-refresh/only-export-components --
 * Context hook must live beside its provider (standard React context pattern);
 * splitting into a second file would add indirection with zero HMR benefit here. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
