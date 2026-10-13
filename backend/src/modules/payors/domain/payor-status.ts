/**
 * Payor status state machine — Panel/Insurance master data (Sprint 2A T2).
 *
 * Two states, no terminal state:
 *   Active → Active       valid (no-op, idempotent re-assert)
 *   Active → Inactive     valid (deactivate)
 *   Inactive → Active     valid (reactivate)
 *   Inactive → Inactive   valid (no-op)
 *
 * NO payment/invoice/claim/Finance statuses — ADR-004 (payment status layer
 * only) is preserved; this is master-data lifecycle only. Pure & deterministic.
 */

export const PAYOR_STATUSES = ['Active', 'Inactive'] as const;
export type PayorStatus = (typeof PAYOR_STATUSES)[number];

/** True when `value` is a valid payor status. */
export function isPayorStatus(value: string): value is PayorStatus {
  return (PAYOR_STATUSES as readonly string[]).includes(value);
}

/**
 * Both transitions between the two states are allowed; same-state is a valid
 * no-op. Any value outside the enum is rejected (false).
 */
export function canTransition(from: string, to: string): boolean {
  if (!isPayorStatus(from) || !isPayorStatus(to)) return false;
  return true;
}
