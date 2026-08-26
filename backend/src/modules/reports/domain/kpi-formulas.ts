/** S9 — Canonical KPI formulas. PURE domain: no I/O.
 *
 * Every formula mirrors the seeded kpi_definitions.formula text exactly.
 * Divide-by-zero NEVER fabricates a number — it returns available:false
 * (health-module honesty precedent, Q2).
 */

export interface KpiValue {
  available: boolean;
  value: string | null;
  note?: string;
}

export function noShowRate(noShow: number, completed: number): KpiValue {
  const denom = noShow + completed;
  if (denom === 0) return { available: false, value: null, note: 'no completed/no-show appointments in period' };
  return { available: true, value: ((noShow / denom) * 100).toFixed(1) };
}

export function recallRate(completed: number, open: number, cancelled: number): KpiValue {
  const denom = completed + open + cancelled;
  if (denom === 0) return { available: false, value: null, note: 'no recall cases due in period' };
  return { available: true, value: ((completed / denom) * 100).toFixed(1) };
}

export function revenuePerAppointment(revenue: string, completedAppointments: number): KpiValue {
  if (completedAppointments === 0) {
    return { available: false, value: null, note: 'no completed appointments in period' };
  }
  const rev = Number(revenue);
  return { available: true, value: (rev / completedAppointments).toFixed(2) };
}

/** Chair Utilisation has no backing entity in the schema (Q2) — always honest. */
export function chairUtilisation(): KpiValue {
  return { available: false, value: null, note: 'requires chair tracking — deferred' };
}
