import { describe, it, expect } from 'vitest';
import { canTransitionEncounter, isEncounterStatus } from '@modules/clinical/domain/encounter-status';
import { canTransitionReferral, isReferralStatus } from '@modules/clinical/domain/referral-status';

describe('encounter status state machine (Sprint 3 S3-B)', () => {
  it('open → completed | cancelled; both terminal', () => {
    expect(canTransitionEncounter('open', 'completed')).toBe(true);
    expect(canTransitionEncounter('open', 'cancelled')).toBe(true);
    expect(canTransitionEncounter('completed', 'open')).toBe(false);
    expect(canTransitionEncounter('cancelled', 'open')).toBe(false);
    expect(canTransitionEncounter('completed', 'cancelled')).toBe(false);
  });

  it('same-state no-ops; unknown values rejected', () => {
    expect(canTransitionEncounter('open', 'open')).toBe(true);
    expect(canTransitionEncounter('closed', 'open')).toBe(false);
    expect(isEncounterStatus('in-progress')).toBe(false); /* appointment status — not ours */
  });
});

describe('referral status state machine (Sprint 3 S3-B)', () => {
  it('follows pending→sent→acknowledged→completed', () => {
    expect(canTransitionReferral('pending', 'sent')).toBe(true);
    expect(canTransitionReferral('sent', 'acknowledged')).toBe(true);
    expect(canTransitionReferral('acknowledged', 'completed')).toBe(true);
  });

  it('rejects skips and reversals; completed is terminal', () => {
    expect(canTransitionReferral('pending', 'acknowledged')).toBe(false);
    expect(canTransitionReferral('sent', 'pending')).toBe(false);
    expect(canTransitionReferral('completed', 'sent')).toBe(false);
    expect(canTransitionReferral('pending', 'completed')).toBe(false);
  });

  it('same-state no-ops; unknown rejected', () => {
    expect(canTransitionReferral('sent', 'sent')).toBe(true);
    expect(isReferralStatus('closed')).toBe(false);
  });
});
