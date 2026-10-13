import type { Lang } from "@/lib/i18n";

/**
 * FASA A — format tarikh/masa mengikut bahasa.
 *
 * Kenapa fail berasingan:
 *
 * Format tarikh ialah BAHASA. "24 Sep 2026" dan "24 Sep 2026" mungkin
 * kelihatan sama, tetapi "Khamis" vs "Thursday" bukan — dan bulan panjang
 * berbeza sepenuhnya ("September" kekal, "Ogos" menjadi "August").
 *
 * Menggunakan toLocaleString("ms-MY") di merata tempat bermakna halaman
 * English akan menulis hari dan bulan dalam Bahasa Melayu. Itu pencemaran
 * bahasa yang paling mudah terlepas pandang, kerana ia kelihatan seperti
 * tarikh biasa.
 *
 * Jadi: satu tempat memutuskan locale, semua halaman memanggilnya.
 */

/** Locale sebenar untuk setiap bahasa UI. */
export function localeOf(lang: Lang): string {
  return lang === "ms" ? "ms-MY" : "en-GB";
}

/** 24 September 2026 */
export function fmtLongDate(lang: Lang, input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(localeOf(lang), {
    day: "numeric", month: "long", year: "numeric",
  });
}

/** Khamis, 24 September 2026 */
export function fmtFullDate(lang: Lang, input: string | Date = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(localeOf(lang), {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/** 24 Sep */
export function fmtShortDate(lang: Lang, input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(localeOf(lang), { day: "numeric", month: "short" });
}

/** 24 Sep 2026 */
export function fmtShortDateYear(lang: Lang, input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(localeOf(lang), { day: "numeric", month: "short", year: "numeric" });
}

/** 24 September 2026, 2:30 PG / 2:30 am */
export function fmtDateTime(lang: Lang, input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(localeOf(lang), {
    day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** 10:30 AM / 10:30 PG */
export function fmtTime(lang: Lang, input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(localeOf(lang), { hour: "2-digit", minute: "2-digit" });
}

/** September 2026 */
export function fmtMonthYear(lang: Lang, input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(localeOf(lang), { month: "long", year: "numeric" });
}
