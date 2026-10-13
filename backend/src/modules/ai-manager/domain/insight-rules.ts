/**
 * Insight rules — PURE DETERMINISM, no I/O, no model.
 *
 * The dental-erp AIInsight pattern, adapted to this repo's discipline: an
 * insight is DATA → RULE → CARD, computed by code. The model is never asked
 * to "find insights" (it would invent them); it may only be asked to NARRATE
 * a card that this module already produced from fetched numbers.
 *
 * Every rule mirrors the generateRadar precedent (finance): scan real rows,
 * emit a card only when the rule fires, never fabricate. A rule that cannot
 * compute its inputs emits NOTHING (not a zero) — same honesty rule as
 * revenuePerAppointment.
 *
 * Phase C of the dental-erp study. Locked rule 3: insights-ai is DRAFT-ONLY,
 * so every card here is a DRAFT a human reads and acts on.
 */

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface InsightCard {
  /** Stable key for dedup + UI routing (e.g. 'no_show_branch_high'). */
  ruleKey: string;
  severity: InsightSeverity;
  /** Category icon routing in the UI (revenue/clinical/operational/patient). */
  category: 'revenue' | 'clinical' | 'operational' | 'patient';
  title: string;
  /** One short sentence with the numbers that fired the rule. */
  detail: string;
  /** Where the human goes to act (frontend route). */
  actionHref: string;
}

/* ---------------------------------------------------------------------------
 * RULE 1 — no-show rate by branch (appointments domain data).
 *
 * dental-erp's no-show-predictor asks a MODEL for risk scores; we compute the
 * real historical rate in SQL (their own cron reminder does the same for the
 * extra-reminder decision). Fires when a branch's no-show share exceeds the
 * threshold with a minimum volume — a single no-show on a 2-appointment day
 * is not a pattern.
 * ------------------------------------------------------------------------- */
export const NO_SHOW_THRESHOLD_PCT = 20;
export const NO_SHOW_MIN_APPOINTMENTS = 5;

export interface BranchNoShowRow {
  branchId: string;
  branchName: string;
  booked: number;
  completed: number;
  noShow: number;
}

export function noShowBranchInsights(
  rows: readonly BranchNoShowRow[],
  thresholdPct = NO_SHOW_THRESHOLD_PCT,
  minAppointments = NO_SHOW_MIN_APPOINTMENTS,
): InsightCard[] {
  const cards: InsightCard[] = [];
  for (const r of rows) {
    const total = r.booked + r.completed + r.noShow;
    if (total < minAppointments) continue;
    const pct = (r.noShow / total) * 100;
    if (pct < thresholdPct) continue;
    cards.push({
      ruleKey: `no_show_branch_high:${r.branchId}`,
      severity: pct >= thresholdPct * 2 ? 'critical' : 'warning',
      category: 'operational',
      title: `Kadar no-show tinggi: ${r.branchName}`,
      detail: `${r.noShow} daripada ${total} temujanji tidak hadir (${pct.toFixed(1)}%) — melebihi ${thresholdPct}%. Pertimbangkan pengesahan semula atau peringatan tambahan untuk cawangan ini.`,
      actionHref: '/appointments',
    });
  }
  return cards;
}

/* ---------------------------------------------------------------------------
 * RULE 2 — revenue drop vs previous window (finance domain data).
 *
 * The Phase B comparison window, made proactive: nobody asked, but the number
 * moved. Fires on a period-over-period decline above the threshold. Needs
 * BOTH windows to have data (a zero previous window is "no baseline", not a
 * drop — the honest refusal, not a -100% card).
 * ------------------------------------------------------------------------- */
export const REVENUE_DROP_THRESHOLD_PCT = 20;

export function revenueDropInsight(
  currentRevenue: number,
  previousRevenue: number,
  periodLabel: string,
  thresholdPct = REVENUE_DROP_THRESHOLD_PCT,
): InsightCard[] {
  /* No baseline, or no data this period → nothing to say. A RM0 → RM0
   * situation is "no data", not "stable". */
  if (previousRevenue <= 0 || currentRevenue <= 0) return [];
  const dropPct = ((previousRevenue - currentRevenue) / previousRevenue) * 100;
  if (dropPct < thresholdPct) return [];
  return [{
    ruleKey: 'revenue_drop_vs_prev',
    severity: dropPct >= thresholdPct * 2 ? 'critical' : 'warning',
    category: 'revenue',
    title: 'Kutipan menurun berbanding tempoh lepas',
    detail: `Kutipan ${periodLabel} ialah RM${currentRevenue.toFixed(2)}, turun ${dropPct.toFixed(1)}% berbanding RM${previousRevenue.toFixed(2)} pada tempoh sebelumnya.`,
    actionHref: '/reports',
  }];
}

/* ---------------------------------------------------------------------------
 * RULE 3 — charged-but-uninvoiced encounters (clinical × finance seam).
 *
 * The dental-erp event `treatment.completed → invoice recommendation`, made
 * deterministic: an encounter is COMPLETED but carries no treatment charge
 * (treatment_costs row) — money the clinic did for a patient it never
 * recorded. Fires per encounter, capped, newest first.
 * ------------------------------------------------------------------------- */
export const UNINVOICED_MAX_CARDS = 5;

export interface UninvoicedEncounterRow {
  encounterId: string;
  patientName: string;
  branchName: string;
  completedAt: string;
}

export function uninvoicedEncounterInsights(
  rows: readonly UninvoicedEncounterRow[],
  max = UNINVOICED_MAX_CARDS,
): InsightCard[] {
  if (rows.length === 0) return [];
  const cards = rows.slice(0, max).map((r) => ({
    ruleKey: `encounter_uninvoiced:${r.encounterId}`,
    severity: 'info' as const,
    category: 'revenue' as const,
    title: `Encounter selesai tanpa caj: ${r.patientName}`,
    detail: `Kunjungan ${r.patientName} di ${r.branchName} ditanda selesai pada ${r.completedAt} tetapi tiada caj rawatan direkodkan. Semak dan rekod kos rawatan.`,
    actionHref: `/clinical/encounters/${r.encounterId}`,
  }));
  /* One summary card when there are more than we show individually. */
  if (rows.length > max) {
    cards.push({
      ruleKey: 'encounter_uninvoiced_overflow',
      severity: 'info',
      category: 'revenue',
      title: `…dan ${rows.length - max} encounter lagi tanpa caj`,
      detail: `${rows.length - max} encounter selesai lain turut tiada caj rawatan direkodkan.`,
      actionHref: '/clinical',
    });
  }
  return cards;
}

/* ---------------------------------------------------------------------------
 * RULE 4 — stale Bukku sync (data freshness guard, dashboard precedent).
 *
 * The dashboard already computes `freshness(b.lastSyncedAt, now)`; the insight
 * escalates it to a card so it appears in the same feed as everything else.
 * ------------------------------------------------------------------------- */
export const BUKKU_STALE_HOURS = 48;

export function staleSyncInsight(
  lastSyncedAt: string | null,
  now: Date,
  staleHours = BUKKU_STALE_HOURS,
): InsightCard[] {
  if (!lastSyncedAt) {
    return [{
      ruleKey: 'bukku_never_synced',
      severity: 'warning',
      category: 'operational',
      title: 'Bukku belum pernah disegerakkan',
      detail: 'Tiada rekod segerak Bukku — angka kewangan mungkin tidak lengkap.',
      actionHref: '/finance',
    }];
  }
  const hours = (now.getTime() - new Date(lastSyncedAt).getTime()) / 3_600_000;
  if (hours < staleHours) return [];
  return [{
    ruleKey: 'bukku_stale',
    severity: hours >= staleHours * 2 ? 'critical' : 'warning',
    category: 'operational',
    title: 'Segerakan Bukku terlalu lama',
    detail: `Segerakan terakhir Bukku ${Math.floor(hours)} jam lalu (melebihi ${staleHours} jam). Angka jualan mungkin kedaluwarsa.`,
    actionHref: '/finance',
  }];
}

/** All rules, in display order. Pure composition for the service to call. */
export function buildInsights(input: {
  branchNoShow: readonly BranchNoShowRow[];
  currentRevenue: number;
  previousRevenue: number;
  periodLabel: string;
  uninvoiced: readonly UninvoicedEncounterRow[];
  bukkuLastSyncedAt: string | null;
  now: Date;
}): InsightCard[] {
  return [
    ...revenueDropInsight(input.currentRevenue, input.previousRevenue, input.periodLabel),
    ...noShowBranchInsights(input.branchNoShow),
    ...uninvoicedEncounterInsights(input.uninvoiced),
    ...staleSyncInsight(input.bukkuLastSyncedAt, input.now),
  ];
}
