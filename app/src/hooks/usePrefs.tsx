import { createContext, useContext } from "react";
import { type Lang } from "@/lib/i18n";

/**
 * FASA A — Preferences context + hooks.
 *
 * The `PrefsProvider` component lives in `./PrefsProvider.tsx` — this module
 * exports only the context and the hooks, so React Fast Refresh can hot-reload
 * edits without a full page reload. `usePrefs` has 54 importers; nothing about
 * calling it changed.
 */

export type Theme = "light" | "dark";

export interface PrefsValue {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  /** Terjemah kunci — `t('nav.dashboard')` */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const PrefsContext = createContext<PrefsValue | null>(null);

export function usePrefs(): PrefsValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}

/** Pintasan bila hanya terjemahan diperlukan. */
export function useT() {
  return usePrefs().t;
}
