import { createContext, useContext, useState, type ReactNode } from "react";
import { useAuth } from "./useAuth";

type BranchContextValue = {
  /** null = all branches (HQ only). branchId is a UUID string (backend). */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
};

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hqBranch, setHqBranch] = useState<string | null>(() => {
    return localStorage.getItem("medini_branch");
  });

  const isHq = user?.role === "hq";
  const branchId = isHq ? hqBranch : (user?.branchId ?? null);

  return (
    <BranchContext.Provider
      value={{
        branchId,
        setBranchId: (id) => {
          setHqBranch(id);
          if (id) localStorage.setItem("medini_branch", id);
          else localStorage.removeItem("medini_branch");
        },
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

/* eslint-disable-next-line react-refresh/only-export-components --
 * Context hook must live beside its provider (standard React context pattern);
 * splitting into a second file would add indirection with zero HMR benefit here. */
export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
