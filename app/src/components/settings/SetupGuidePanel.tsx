import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, ExternalLink, Circle, CheckCircle2, Lightbulb } from "lucide-react";

import { usePrefs } from "@/hooks/usePrefs";
import { Panel } from "@/components/shared";
import { Badge } from "@/components/ui/badge";

/* ============================================================================
 * Panduan Penggunaan (tutorial) — panel dalam Settings.
 *
 * Versi 2 (9 Okt, arahan pemilik: "lebih detail dengan bahasa yang lebih
 * mudah dimengerti"):
 *   1. Bahasa ringkas & santai - macam terangkan ke rakan sekerja, bukan
 *      manual teknikal
 *   2. Setiap langkah diberi TUJUAN - pengguna tahu kenapa, bukan sekadar ikut
 *   3. Tips (💡) pada langkah yang selalu tersalah
 *   4. Seksyen baru: Pesakit, Documents/X-Ray, Rencana Pembayaran, Laporan
 *   5. Label peranan: siapa (biasanya) buat kerja ni
 * Struktur kekal: accordion per modul + tandakan selesai + pautan pergi-ke
 * (hanya halaman yang wujud - R-24).
 * ========================================================================== */

interface Step { k: string; tip?: string }
interface Guide {
  titleKey: string;
  descKey: string;
  roleKey?: string;      /* siapa biasanya buat */
  steps: Step[];
}
interface Section {
  id: string;
  titleKey: string;
  priority: "essential" | "recommended";
  items: Guide[];
}

const SECTIONS: Section[] = [
  /* ============ 1. PESAKAT ============ */
  {
    id: "patients",
    titleKey: "tut.sec.patients",
    priority: "essential",
    items: [
      {
        titleKey: "tut.pt.title",
        descKey: "tut.pt.desc",
        roleKey: "tut.role.reception",
        steps: [
          { k: "tut.pt.s1" },
          { k: "tut.pt.s2", tip: "tut.pt.tip2" },
          { k: "tut.pt.s3" },
        ],
      },
      {
        titleKey: "tut.p360.title",
        descKey: "tut.p360.desc",
        steps: [
          { k: "tut.p360.s1" },
          { k: "tut.p360.s2" },
          { k: "tut.p360.s3", tip: "tut.p360.tip3" },
        ],
      },
    ],
  },
  /* ============ 2. TEMUJANJI ============ */
  {
    id: "appointments",
    titleKey: "tut.sec.appointments",
    priority: "essential",
    items: [
      {
        titleKey: "tut.appt.title",
        descKey: "tut.appt.desc",
        roleKey: "tut.role.reception",
        steps: [
          { k: "tut.appt.s1" },
          { k: "tut.appt.s2", tip: "tut.appt.tip2" },
          { k: "tut.appt.s3" },
          { k: "tut.appt.s4" },
        ],
      },
    ],
  },
  /* ============ 3. RAWATAN KLINIKAL ============ */
  {
    id: "clinical",
    titleKey: "tut.sec.clinical",
    priority: "essential",
    items: [
      {
        titleKey: "tut.enc.title",
        descKey: "tut.enc.desc",
        roleKey: "tut.role.doctor",
        steps: [
          { k: "tut.enc.s1" },
          { k: "tut.enc.s2", tip: "tut.enc.tip2" },
          { k: "tut.enc.s3" },
          { k: "tut.enc.s4" },
          { k: "tut.enc.s5" },
        ],
      },
      {
        titleKey: "tut.rx.title",
        descKey: "tut.rx.desc",
        roleKey: "tut.role.doctor",
        steps: [
          { k: "tut.rx.s1" },
          { k: "tut.rx.s2", tip: "tut.rx.tip2" },
          { k: "tut.rx.s3" },
        ],
      },
      {
        titleKey: "tut.doc.title",
        descKey: "tut.doc.desc",
        steps: [
          { k: "tut.doc.s1" },
          { k: "tut.doc.s2" },
          { k: "tut.doc.s3", tip: "tut.doc.tip3" },
        ],
      },
      {
        titleKey: "tut.ae.title",
        descKey: "tut.ae.desc",
        roleKey: "tut.role.doctor",
        steps: [
          { k: "tut.ae.s1" },
          { k: "tut.ae.s2", tip: "tut.ae.tip2" },
        ],
      },
    ],
  },
  /* ============ 4. KEWANGAN & INVENTORI ============ */
  {
    id: "business",
    titleKey: "tut.sec.business",
    priority: "essential",
    items: [
      {
        titleKey: "tut.fin.title",
        descKey: "tut.fin.desc",
        roleKey: "tut.role.hq",
        steps: [
          { k: "tut.fin.s1" },
          { k: "tut.fin.s2" },
        ],
      },
      {
        titleKey: "tut.pay.title",
        descKey: "tut.pay.desc",
        steps: [
          { k: "tut.pay.s1" },
          { k: "tut.pay.s2" },
          { k: "tut.pay.s3", tip: "tut.pay.tip3" },
          { k: "tut.pay.s4" },
        ],
      },
      {
        titleKey: "tut.inv.title",
        descKey: "tut.inv.desc",
        steps: [
          { k: "tut.inv.s1" },
          { k: "tut.inv.s2" },
          { k: "tut.inv.s3" },
          { k: "tut.inv.s4", tip: "tut.inv.tip4" },
        ],
      },
    ],
  },
  /* ============ 5. AI & KOMUNIKASI ============ */
  {
    id: "ai",
    titleKey: "tut.sec.ai",
    priority: "recommended",
    items: [
      {
        titleKey: "tut.ai.title",
        descKey: "tut.ai.desc",
        steps: [
          { k: "tut.ai.s1" },
          { k: "tut.ai.s2", tip: "tut.ai.tip2" },
          { k: "tut.ai.s3" },
        ],
      },
      {
        titleKey: "tut.asst.title",
        descKey: "tut.asst.desc",
        steps: [
          { k: "tut.asst.s1" },
          { k: "tut.asst.s2" },
        ],
      },
    ],
  },
  /* ============ 6. LIHAT PRESTASI ============ */
  {
    id: "reports",
    titleKey: "tut.sec.reports",
    priority: "recommended",
    items: [
      {
        titleKey: "tut.rep.title",
        descKey: "tut.rep.desc",
        steps: [
          { k: "tut.rep.s1" },
          { k: "tut.rep.s2", tip: "tut.rep.tip2" },
        ],
      },
    ],
  },
];

/* Pautan "pergi ke" — hanya halaman yang wujud (R-24). */
const GO_TO: Record<string, string> = {
  patients: "/patients",
  appointments: "/appointments",
  clinical: "/clinical",
  business: "/finance",
  ai: "/ai",
  reports: "/reports",
};

export default function SetupGuidePanel() {
  const { t } = usePrefs();
  const [openSec, setOpenSec] = useState<string | null>("patients");
  const [done, setDone] = useState<Record<string, boolean>>({});

  const toggleDone = (k: string) => setDone((d) => ({ ...d, [k]: !d[k] }));
  const doneCount = Object.values(done).filter(Boolean).length;
  const totalGuides = SECTIONS.reduce((n, s) => n + s.items.length, 0);

  return (
    <Panel
      title={t("tut.title")}
      subtitle={t("tut.subtitle")}
      className="bg-card rounded-lg p-7 border border-black/[0.04] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {/* Kemajuan sebenar daripada klik pengguna sendiri (R-17). */}
      <p className="mb-4 text-sm text-muted-foreground">
        {t("tut.progress", { n: doneCount, total: totalGuides })}
      </p>

      <div className="space-y-3">
        {SECTIONS.map((sec) => {
          const open = openSec === sec.id;
          return (
            <div key={sec.id} className="overflow-hidden rounded-xl border border-border">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenSec(open ? null : sec.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
              >
                {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="text-sm font-semibold text-foreground">{t(sec.titleKey)}</span>
                <Badge variant={sec.priority === "essential" ? "default" : "secondary"} className="ml-auto">
                  {sec.priority === "essential" ? t("tut.essential") : t("tut.recommended")}
                </Badge>
              </button>

              {open && (
                <div className="space-y-4 border-t border-border px-4 py-4">
                  {sec.items.map((g) => {
                    const allDone = g.steps.every((s) => done[s.k]);
                    return (
                      <div key={g.titleKey} className="rounded-lg bg-muted/30 p-4">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            aria-label={allDone ? t("tut.markUndone") : t("tut.markDone")}
                            onClick={() => g.steps.forEach((s) => toggleDone(s.k))}
                            className="mt-0.5 shrink-0 text-primary hover:opacity-80"
                          >
                            {allDone ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Circle className="h-5 w-5" aria-hidden />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold text-foreground">{t(g.titleKey)}</h3>
                              {g.roleKey && (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                  {t(g.roleKey)}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{t(g.descKey)}</p>
                            <ol className="mt-3 space-y-2">
                              {g.steps.map((s, si) => (
                                <li key={s.k} className="flex items-start gap-2 text-xs text-foreground">
                                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{si + 1}</span>
                                  <div className="min-w-0">
                                    <span>{t(s.k)}</span>
                                    {s.tip && (
                                      <p className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                                        {t(s.tip)}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {GO_TO[sec.id] && (
                    <Link to={GO_TO[sec.id]} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                      {t("tut.goTo")} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
