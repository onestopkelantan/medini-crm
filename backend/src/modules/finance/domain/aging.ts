/**
 * Aging buckets (Sprint 4 S4-T4) — AUTHORITATIVE buckets from
 * CURRENT-MEDINI-REVIEW.html (§14 / §7E): Current / 1–30 / 31–60 / 61–90 / 90+.
 *
 * Backend OWNS the aging calculation; the frontend displays the backend result.
 * No second aging definition. Pure & deterministic.
 */
export const AGING_BUCKETS = [
  'Current', '1-30', '31-60', '61-90', '90+',
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/**
 * Classify an outstanding amount into an aging bucket by days-overdue relative
 * to `today`. daysOverdue <= 0 → Current; 1–30; 31–60; 61–90; >90 → 90+.
 */
export function agingBucketFor(dueDate: Date, today: Date = new Date()): AgingBucket {
  const msPerDay = 24 * 60 * 60 * 1000;
  const due = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysOverdue = Math.floor((now - due) / msPerDay);
  if (daysOverdue <= 0) return 'Current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

/** Days overdue (negative/zero = not yet due). */
export function daysOverdue(dueDate: Date, today: Date = new Date()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const due = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((now - due) / msPerDay);
}
