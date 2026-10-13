import { useCallback, useEffect, useState, type ReactNode } from "react";
import { translate, type Lang } from "@/lib/i18n";
import { PrefsContext, type Theme } from "@/hooks/usePrefs";

/**
 * PrefsProvider — the component half of the preferences context (FASA A).
 *
 * WHY THIS FILE EXISTS
 *
 * React Fast Refresh only works when a module exports components and nothing
 * else. `usePrefs.tsx` exported the provider AND the `usePrefs`/`useT` hooks,
 * so any edit forced a full reload. The context + hooks stay in `usePrefs.tsx`
 * (54 importers); only the provider moved here. Behaviour is unchanged.
 */

const LANG_KEY = "medini_lang";
const THEME_KEY = "medini_theme";

function readLang(): Lang {
  const v = localStorage.getItem(LANG_KEY);
  return v === "ms" || v === "en" ? v : "en";
}

function readTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "dark" ? "dark" : "light";
}

/** Terapkan kelas tema pada <html> supaya seluruh pokok DOM terjejas. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readLang());
  const [theme, setThemeState] = useState<Theme>(() => readTheme());

  /* Terapkan tema pada muat pertama — sebelum React render sebarang kad. */
  useEffect(() => { applyTheme(theme); }, [theme]);

  /* Simpan bahasa pada <html lang> — pembaca skrin dan pemilih bahasa pelayar
     bergantung padanya. */
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  return (
    <PrefsContext.Provider value={{ lang, theme, setLang, setTheme, toggleTheme, t }}>
      {children}
    </PrefsContext.Provider>
  );
}
