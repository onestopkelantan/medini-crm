/**
 * Financial Radar rules (Sprint 4 S4-T2/T4) — management alert layer.
 * DATA → RULE → ALERT → NOTIFICATION. NOT another accounting engine.
 *
 * Alert thresholds (from FINCONF.alertThresholds — engine locked, thresholds editable):
 *   dueSoon    = 7 days
 *   critical   = 1 day
 *   escalation = 7 days
 *
 * Radar surfaces items requiring attention: overdue, due soon, critical,
 * commission pending, lab payable overdue, sync failure, reconciliation conflict.
 * Pure & deterministic — the service supplies the records.
 */

export const ALERT_THRESHOLDS = {
  dueSoon: 7,
  critical: 1,
  escalation: 7,
} as const;

export type FinanceAlertType =
  | 'payment_attention'
  | 'overdue_record'
  | 'expense_due'
  | 'lab_payable_overdue'
  | 'commission_attention'
  | 'sync_failure'
  | 'reconciliation_conflict';

export type FinanceAlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Severity for a days-until-due value (negative = overdue).
 *   overdue (days < 0)        → critical
 *   due within `critical` day → critical
 *   due within `dueSoon` days → high
 *   otherwise                 → medium
 */
export function severityForDaysUntilDue(
  daysUntilDue: number,
  thresholds = ALERT_THRESHOLDS,
): FinanceAlertSeverity {
  if (daysUntilDue < 0) return 'critical';
  if (daysUntilDue <= thresholds.critical) return 'critical';
  if (daysUntilDue <= thresholds.dueSoon) return 'high';
  return 'medium';
}

/** Whole days from today until dueDate (negative = overdue). */
export function daysUntilDue(dueDate: Date, today: Date = new Date()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const due = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((due - now) / msPerDay);
}
