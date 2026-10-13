import { usePrefs } from "@/hooks/usePrefs";
import type { Lang } from "@/lib/i18n";
import { Sun, Moon } from "lucide-react";

/**
 * FASA A — kawalan bahasa dan tema.
 *
 * Diletakkan dalam header supaya ia boleh dicapai dari mana-mana halaman.
 * Reka bentuk sengaja kecil dan tenang: ini tetapan, bukan ciri — ia tidak
 * sepatutnya menarik mata daripada kerja sebenar skrin.
 */

/** Satu butang bahasa — diangkat keluar dari render supaya identitinya stabil. */
function LangBtn({ value, label, active, onPick }: { value: Lang; label: string; active: boolean; onPick: (v: Lang) => void }) {
  return (
    <button
      onClick={() => onPick(value)}
      aria-pressed={active}
      title={value === "ms" ? "Bahasa Melayu" : "English"}
      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/** BM | EN — dua pilihan, satu aktif. Tiada menu tersembunyi. */
export function LanguageToggle() {
  const { lang, setLang } = usePrefs();

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-card/70 p-0.5"
    >
      <LangBtn value="ms" label="BM" active={lang === "ms"} onPick={setLang} />
      <LangBtn value="en" label="EN" active={lang === "en"} onPick={setLang} />
    </div>
  );
}

/** ☀️ / 🌙 — satu butang, dua keadaan. */
export function ThemeToggle() {
  const { theme, toggleTheme, t } = usePrefs();
  const label = theme === "dark" ? t("common.lightMode") : t("common.darkMode");

  return (
    <button
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-card/70 text-muted-foreground transition hover:text-foreground"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
