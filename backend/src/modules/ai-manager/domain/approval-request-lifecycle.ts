/**
 * AI approval-request lifecycle (A3b). Pure & deterministic.
 *
 * WHAT THIS IS
 *
 * When the policy engine returns APPROVAL_REQUIRED, the AI wanted to do
 * something a human must authorise. Before this existed, the caller collapsed
 * that verdict into `agentEnabled = false` and wrote a reason to the audit log —
 * the request itself vanished. There was nothing to approve.
 *
 * An AiApprovalRequest is that held action, given a place to live:
 *
 *   pending → approved   (a human authorised it)
 *   pending → rejected   (a human refused it)
 *   pending → cancelled  (the request became moot before anyone decided)
 *
 * `approved`, `rejected` and `cancelled` are TERMINAL. A decided request is a
 * record of a decision; re-opening it would erase who decided what, which is the
 * one thing this table exists to preserve.
 *
 * Same-state is a valid no-op (Medini convention — no mutation, no audit).
 * Nothing here executes the action: approving records the human's decision. The
 * domain that owns the action decides whether to act on it.
 */

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export function isApprovalRequestStatus(value: string): value is ApprovalRequestStatus {
  return (APPROVAL_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** Statuses a request can still move OUT of. */
export const OPEN_APPROVAL_STATUSES: readonly ApprovalRequestStatus[] = ['pending'];

const ALLOWED: Record<ApprovalRequestStatus, readonly ApprovalRequestStatus[]> = {
  pending: ['pending', 'approved', 'rejected', 'cancelled'],
  approved: ['approved'],
  rejected: ['rejected'],
  cancelled: ['cancelled'],
};

/** True when the transition from → to is legal. */
export function canTransitionApprovalRequest(from: string, to: string): boolean {
  if (!isApprovalRequestStatus(from) || !isApprovalRequestStatus(to)) return false;
  return (ALLOWED[from] as readonly string[]).includes(to);
}

/** True when the request is still waiting on a human. */
export function isOpenApprovalRequest(status: string): boolean {
  return isApprovalRequestStatus(status) && OPEN_APPROVAL_STATUSES.includes(status);
}

/**
 * A decision may only be recorded on an OPEN request. Returns the reason it is
 * refused, so the service can fail with something a human can read rather than a
 * generic conflict.
 */
export function decisionRefusalReason(status: string, to: ApprovalRequestStatus): string | null {
  if (!isApprovalRequestStatus(status)) return `unknown status '${status}'`;
  if (to === 'pending') return 'a request cannot be re-opened';
  if (!isOpenApprovalRequest(status)) return `request is already ${status}`;
  if (!canTransitionApprovalRequest(status, to)) return `cannot move ${status} → ${to}`;
  return null;
}
