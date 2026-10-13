import { createContext, useContext } from "react";
import type { AuthUser } from "@/lib/auth";

/**
 * Auth context + hook.
 *
 * The `AuthProvider` component lives in `./AuthProvider.tsx` — this module
 * exports only the context and the hook, so React Fast Refresh can hot-reload
 * edits without a full page reload. `useAuth` still has 25 importers; nothing
 * about calling it changed.
 */

export type Branch = { id: string; name: string };
export type AuthContextValue = { user: AuthUser | null; branch: Branch | null; isLoading: boolean; login: (username: string, password: string) => Promise<void>; logout: () => Promise<void>; refetch: () => void };

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("useAuth must be used within AuthProvider"); return ctx; }
