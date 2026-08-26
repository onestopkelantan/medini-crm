/**
 * Referral status state machine (Sprint 3 S3-B).
 *   pending → sent → acknowledged → completed
 * Same-state = valid no-op. Terminal: completed. Pure & deterministic.
 */
export const REFERRAL_STATUSES = ['pending', 'sent', 'acknowledged', 'completed'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export function isReferralStatus(value: string): value is ReferralStatus {
  return (REFERRAL_STATUSES as readonly string[]).includes(value);
}

const ORDER: Record<ReferralStatus, readonly ReferralStatus[]> = {
  pending:      ['pending', 'sent'],
  sent:         ['sent', 'acknowledged'],
  acknowledged: ['acknowledged', 'completed'],
  completed:    ['completed'],
};

export function canTransitionReferral(from: string, to: string): boolean {
  if (!isReferralStatus(from) || !isReferralStatus(to)) return false;
  return (ORDER[from] as readonly string[]).includes(to);
}
