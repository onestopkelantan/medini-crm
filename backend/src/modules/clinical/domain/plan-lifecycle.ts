/**
 * Treatment plan lifecycle state machine (Sprint 3 S3-B).
 * Locked lifecycle (Blueprint §5/§28):
 *   draft → proposed → accepted → active → completed
 *   draft|proposed|accepted → cancelled (terminal)
 *   completed is terminal. cancelled is terminal.
 * Same-state transition = valid no-op (Medini convention — no mutation/audit).
 *
 * Pure & deterministic. No payment/invoice statuses — ADR-004.
 */
export const PLAN_STATUSES = ['draft', 'proposed', 'accepted', 'active', 'completed', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(value);
}

const ALLOWED: Record<PlanStatus, readonly PlanStatus[]> = {
  draft:     ['draft', 'proposed', 'cancelled'],
  proposed:  ['proposed', 'accepted', 'cancelled'],
  accepted:  ['accepted', 'active', 'cancelled'],
  active:    ['active', 'completed'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

/** True when the transition from → to is legal under the locked lifecycle. */
export function canTransitionPlan(from: string, to: string): boolean {
  if (!isPlanStatus(from) || !isPlanStatus(to)) return false;
  return (ALLOWED[from] as readonly string[]).includes(to);
}

/** Timestamp column each forward transition stamps (null = none). */
export function transitionStamp(to: PlanStatus): 'proposedAt' | 'acceptedAt' | 'activatedAt' | 'completedAt' | 'cancelledAt' | null {
  switch (to) {
    case 'proposed': return 'proposedAt';
    case 'accepted': return 'acceptedAt';
    case 'active': return 'activatedAt';
    case 'completed': return 'completedAt';
    case 'cancelled': return 'cancelledAt';
    default: return null;
  }
}
