import { useState } from "react";
import { Calculator, HelpCircle } from "lucide-react";

import { Panel } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrefs } from "@/hooks/usePrefs";

/* ============================================================================
 * CommissionFormulaPanel — #5 (pemilik 10 Okt): "di setting itu ada formula
 * untuk doctor, gaji, ataupun commission, boleh dimasukkan di UI nya".
 *
 * Kandungan: formula komisen TETAP yang enjin belakang gunakan (sumber:
 * backend/src/modules/finance/domain/commission-engine.ts — COMMISSION_CONFIG
 * RATE 0.40, basis Treatment Revenue, payout 15 & 30) + KALKULATOR live
 * supaya pemilik boleh "cubakan angka" sebelum menjalankan komisen sebenar
 * di Kewangan.
 *
 * Panel ini BACA + kira di pelayar sahaja — kadar TERKUNCI di enjin
 * (formula dikunci, ada ujian pada enjin). Menukar kadar ialah kerja kod,
 * bukan tetapan UI: itu keputusan sengaja supaya komisen tidak boleh
 * diubah sesiapa dari pelayar tanpa jejak.
 * ========================================================================== */

/* Sama dengan COMMISSION_CONFIG di backend (nilai dikunci di enjin). */
const RATE = 0.4;
const PAYOUT_DATES = [15, 30] as const;
const ELIGIBLE_COSTS = ["Lab Cost", "X-Ray", "Add-on"] as const;

function rm(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function CommissionFormulaPanel() {
  const { t } = usePrefs();
  const [gross, setGross] = useState("10000");
  const [costs, setCosts] = useState("2000");

  const g = rm(gross);
  const c = rm(costs);
  const base = Math.max(0, g - c);
  const commission = base * RATE;

  return (
    <Panel
      title={t("set.commissionTitle")}
      subtitle={t("set.commissionSubtitle")}
      className="bg-card rounded-lg p-7 border border-black/[0.04] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {/* Formula — dibaca, bukan boleh diedit: kadar dikunci di enjin. */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" aria-hidden />
          <p className="text-sm font-bold text-foreground">{t("set.commissionFormula")}</p>
        </div>
        <div className="mt-2 space-y-1 font-mono text-xs text-foreground">
          <p>{t("set.commissionLine1")}</p>
          <p>{t("set.commissionLine2")}</p>
        </div>
        <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <p>{t("set.commissionRate")}: <span className="font-semibold text-foreground">{RATE * 100}%</span></p>
          <p>{t("set.commissionBasis")}: <span className="font-semibold text-foreground">Treatment Revenue</span></p>
          <p>{t("set.commissionPayout")}: <span className="font-semibold text-foreground">{PAYOUT_DATES.map((d) => `${d}`).join(" & ")}</span></p>
          <p>{t("set.commissionCosts")}: <span className="font-semibold text-foreground">{ELIGIBLE_COSTS.join(", ")}</span></p>
        </div>
      </div>

      {/* Kalkulator cuba-cuba — kira di pelayar, tiada simpanan. */}
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {t("set.commissionCalcTitle")}
          <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <HelpCircle className="h-3 w-3" aria-hidden />
            {t("set.commissionCalcHint")}
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cf-gross" className="text-foreground font-medium">{t("set.commissionGross")}</Label>
            <Input id="cf-gross" value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" className="rounded-xl border-border bg-card px-4 py-2.5 font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-costs" className="text-foreground font-medium">{t("set.commissionCostsLabel")}</Label>
            <Input id="cf-costs" value={costs} onChange={(e) => setCosts(e.target.value)} inputMode="decimal" className="rounded-xl border-border bg-card px-4 py-2.5 font-mono" />
          </div>
        </div>
        <div className="mt-4 grid gap-2 rounded-lg border border-border p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("set.commissionBase")}</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-foreground">RM {base.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("set.commissionAmount")}</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-primary">RM {commission.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("set.commissionPerPayout")}</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-foreground">RM {(commission / PAYOUT_DATES.length).toFixed(2)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("set.commissionRunHint")}</p>
      </div>
    </Panel>
  );
}
