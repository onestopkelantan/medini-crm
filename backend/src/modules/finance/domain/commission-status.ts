/**
 * Commission status state machine (Sprint 4 S4-T3).
 * Lifecycle: calculated → pending_review → approved → scheduled → paid
 *   calculated|pending_review|approved → cancelled
 *   paid is terminal. cancelled is terminal.
 * Same-state = valid no-op. Pure & deterministic.
 */
export const COMMISSION_STATUSES = [
  'calculated', 'pending_review', 'approved', 'scheduled', 'paid', 'cancelled',
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export function isCommissionStatus(value: string): value is CommissionStatus {
  return (COMMISSION_STATUSES as readonly string[]).includes(value);
}

const ALLOWED: Record<CommissionStatus, readonly CommissionStatus[]> = {
  calculated:     ['calculated', 'pending_review', 'approved', 'cancelled'],
  pending_review: ['pending_review', 'approved', 'cancelled'],
  approved:       ['approved', 'scheduled', 'paid', 'cancelled'],
  scheduled:      ['scheduled', 'paid', 'cancelled'],
  paid:           ['paid'],
  cancelled:      ['cancelled'],
};

/** True when the transition from → to is legal. */
export function canTransitionCommission(from: string, to: string): boolean {
  if (!isCommissionStatus(from) || !isCommissionStatus(to)) return false;
  return (ALLOWED[from] as readonly string[]).includes(to);
}
