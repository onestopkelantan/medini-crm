import { describe, it, expect } from 'vitest';
import { canTransition, isPayorStatus, PAYOR_STATUSES } from '@modules/payors/domain/payor-status';

describe('payor status state machine (Sprint 2A T2)', () => {
  it('has exactly two states and no terminal state', () => {
    expect([...PAYOR_STATUSES]).toEqual(['Active', 'Inactive']);
  });

  it('Active → Active is a valid no-op', () => {
    expect(canTransition('Active', 'Active')).toBe(true);
  });

  it('Active → Inactive is valid (deactivate)', () => {
    expect(canTransition('Active', 'Inactive')).toBe(true);
  });

  it('Inactive → Active is valid (reactivate)', () => {
    expect(canTransition('Inactive', 'Active')).toBe(true);
  });

  it('Inactive → Inactive is a valid no-op', () => {
    expect(canTransition('Inactive', 'Inactive')).toBe(true);
  });

  it('rejects invalid/third states at the boundary', () => {
    expect(canTransition('Pending', 'Active')).toBe(false);   /* invoice-ish status — not ours */
    expect(canTransition('Active', 'Paid')).toBe(false);      /* payment status — ADR-004 */
    expect(canTransition('active', 'Inactive')).toBe(false);  /* case-sensitive enum */
    expect(canTransition('', 'Active')).toBe(false);
  });

  it('isPayorStatus narrows valid values only', () => {
    expect(isPayorStatus('Active')).toBe(true);
    expect(isPayorStatus('Inactive')).toBe(true);
    expect(isPayorStatus('Void')).toBe(false);
    expect(isPayorStatus('PENDING')).toBe(false);
  });
});
