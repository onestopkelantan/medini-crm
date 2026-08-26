/**
 * Commission Engine — LOCKED formula (Sprint 4 S4-T3, Master Prompt §6C).
 *
 *   Commission Base   = Gross Treatment Revenue − Eligible Direct Clinical Costs
 *   Commission        = Commission Base × Rate
 *
 * LOCKED DEFAULTS:
 *   rate   = 0.40 (40%)
 *   basis  = Treatment Revenue
 *   payout = Twice Monthly (15th & 30th)
 *
 * DOCTOR is the ONLY beneficiary — NO branch commission.
 * Eligible direct clinical cost categories: Lab Cost, X-Ray, Add-on.
 * General business expenses (rent, utilities, insurance, payroll, accounting,
 * tax, maintenance, general operations) are NEVER deducted from the base.
 *
 * Pure & deterministic — no I/O. The service layer supplies the numbers.
 */

/** Locked default commission configuration. */
export const COMMISSION_CONFIG = {
  RATE: 0.40,
  BASIS: 'Treatment Revenue',
  PAYOUT: 'Twice Monthly',
  PAYOUT_DATES: [15, 30] as const,
} as const;

/** Eligible direct clinical cost categories (deducted from commission base). */
export const ELIGIBLE_DIRECT_COSTS = ['Lab Cost', 'X-Ray', 'Add-on'] as const;
export type EligibleDirectCost = (typeof ELIGIBLE_DIRECT_COSTS)[number];

export function isEligibleDirectCost(category: string): category is EligibleDirectCost {
  return (ELIGIBLE_DIRECT_COSTS as readonly string[]).includes(category);
}

export interface CommissionComputation {
  readonly grossRevenue: number;
  readonly eligibleDirectCosts: number;
  readonly commissionBase: number;
  readonly rate: number;
  readonly commissionAmount: number;
}

/**
 * Compute the commission for a doctor over a period.
 * base = grossRevenue − eligibleDirectCosts (floored at 0 — never negative).
 * amount = base × rate. Rounded to 4 dp to match numeric(19,4) storage.
 */
export function computeCommission(
  grossRevenue: number,
  eligibleDirectCosts: number,
  rate: number = COMMISSION_CONFIG.RATE,
): CommissionComputation {
  if (grossRevenue < 0) throw new Error('grossRevenue cannot be negative');
  if (eligibleDirectCosts < 0) throw new Error('eligibleDirectCosts cannot be negative');
  if (rate < 0 || rate > 1) throw new Error('rate must be within 0..1');
  const base = Math.max(0, round4(grossRevenue - eligibleDirectCosts));
  const amount = round4(base * rate);
  return {
    grossRevenue: round4(grossRevenue),
    eligibleDirectCosts: round4(eligibleDirectCosts),
    commissionBase: base,
    rate,
    commissionAmount: amount,
  };
}

/** Sum only the eligible direct clinical costs from a category→amount map. */
export function sumEligibleDirectCosts(costsByCategory: Record<string, number>): number {
  let total = 0;
  for (const cat of ELIGIBLE_DIRECT_COSTS) {
    const v = costsByCategory[cat];
    if (typeof v === 'number' && v > 0) total += v;
  }
  return round4(total);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Next payout dates for Twice Monthly (15th & 30th) from a reference date. */
export function nextPayoutDates(from: Date, count = 2): Date[] {
  const out: Date[] = [];
  const d = new Date(from.getTime());
  while (out.length < count) {
    for (const day of COMMISSION_CONFIG.PAYOUT_DATES) {
      const cand = new Date(d.getFullYear(), d.getMonth(), day);
      if (cand.getTime() > from.getTime() && !out.some((x) => x.getTime() === cand.getTime())) {
        out.push(cand);
        if (out.length >= count) break;
      }
    }
    d.setMonth(d.getMonth() + 1);
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, count);
}
