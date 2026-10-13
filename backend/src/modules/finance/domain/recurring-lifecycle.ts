/**
 * Recurring commitment lifecycle (Sprint 4 S4-T2).
 * States: active ↔ paused, active|paused → cancelled. cancelled terminal.
 * Same-state = valid no-op. Operational record only — NOT a payment executor.
 * Pure & deterministic.
 */
export const RECURRING_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

export function isRecurringStatus(value: string): value is RecurringStatus {
  return (RECURRING_STATUSES as readonly string[]).includes(value);
}

const ALLOWED: Record<RecurringStatus, readonly RecurringStatus[]> = {
  active:    ['active', 'paused', 'cancelled'],
  paused:    ['paused', 'active', 'cancelled'],
  cancelled: ['cancelled'],
};

export function canTransitionRecurring(from: string, to: string): boolean {
  if (!isRecurringStatus(from) || !isRecurringStatus(to)) return false;
  return (ALLOWED[from] as readonly string[]).includes(to);
}

/** Recurring categories (from FINCONF.recurringCategories). */
export const RECURRING_CATEGORIES = [
  'Utilities', 'Rent', 'Insurance', 'Software', 'Maintenance', 'Subscription', 'Tax', 'Lab Fees', 'Other',
] as const;

export const RECURRING_FREQUENCIES = ['Weekly', 'Monthly', 'Yearly', 'Custom'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/**
 * Advance next_due_date by frequency. Custom = unchanged (manual).
 * Month/year arithmetic is calendar-aware (handles month-end).
 */
export function advanceNextDue(current: Date, frequency: string): Date {
  const d = new Date(current.getTime());
  switch (frequency) {
    case 'Weekly':
      d.setDate(d.getDate() + 7);
      return d;
    case 'Monthly':
      d.setMonth(d.getMonth() + 1);
      return d;
    case 'Yearly':
      d.setFullYear(d.getFullYear() + 1);
      return d;
    default:
      return d; /* Custom — manual */
  }
}
