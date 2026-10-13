import { describe, it, expect } from 'vitest';
import {
  canTransitionPlan, isPlanStatus, transitionStamp, PLAN_STATUSES,
} from '@modules/clinical/domain/plan-lifecycle';

describe('treatment plan lifecycle state machine (Sprint 3 S3-B)', () => {
  it('has exactly six locked statuses (Blueprint §28)', () => {
    expect([...PLAN_STATUSES]).toEqual(['draft', 'proposed', 'accepted', 'active', 'completed', 'cancelled']);
  });

  it('follows the canonical forward path draft→proposed→accepted→active→completed', () => {
    expect(canTransitionPlan('draft', 'proposed')).toBe(true);
    expect(canTransitionPlan('proposed', 'accepted')).toBe(true);
    expect(canTransitionPlan('accepted', 'active')).toBe(true);
    expect(canTransitionPlan('active', 'completed')).toBe(true);
  });

  it('allows cancellation from draft/proposed/accepted but NOT from active/completed', () => {
    expect(canTransitionPlan('draft', 'cancelled')).toBe(true);
    expect(canTransitionPlan('proposed', 'cancelled')).toBe(true);
    expect(canTransitionPlan('accepted', 'cancelled')).toBe(true);
    expect(canTransitionPlan('active', 'cancelled')).toBe(false);
    expect(canTransitionPlan('completed', 'cancelled')).toBe(false);
  });

  it('rejects skips, reversals, and transitions out of terminal states', () => {
    expect(canTransitionPlan('draft', 'accepted')).toBe(false);   /* skip proposed */
    expect(canTransitionPlan('draft', 'active')).toBe(false);
    expect(canTransitionPlan('proposed', 'active')).toBe(false);
    expect(canTransitionPlan('active', 'accepted')).toBe(false);  /* reversal */
    expect(canTransitionPlan('completed', 'active')).toBe(false); /* terminal */
    expect(canTransitionPlan('cancelled', 'draft')).toBe(false);  /* terminal */
  });

  it('same-state transitions are valid no-ops (Medini convention)', () => {
    for (const s of PLAN_STATUSES) expect(canTransitionPlan(s, s)).toBe(true);
  });

  it('rejects unknown/payment statuses at the boundary (ADR-004)', () => {
    expect(canTransitionPlan('draft', 'PAID')).toBe(false);
    expect(canTransitionPlan('PENDING', 'proposed')).toBe(false);
    expect(canTransitionPlan('in_progress', 'completed')).toBe(false); /* frontend alias — not ours */
    expect(canTransitionPlan('', 'draft')).toBe(false);
    expect(isPlanStatus('Void')).toBe(false);
  });

  it('stamps the correct timestamp column per transition', () => {
    expect(transitionStamp('proposed')).toBe('proposedAt');
    expect(transitionStamp('accepted')).toBe('acceptedAt');
    expect(transitionStamp('active')).toBe('activatedAt');
    expect(transitionStamp('completed')).toBe('completedAt');
    expect(transitionStamp('cancelled')).toBe('cancelledAt');
    expect(transitionStamp('draft')).toBeNull();
  });
});
