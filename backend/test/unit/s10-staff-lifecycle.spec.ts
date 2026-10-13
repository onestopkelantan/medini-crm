import { describe, expect, it } from 'vitest';
import { canTransitionStaffStatus, staffCommandTarget } from '../../src/modules/administration/domain/administration-lifecycle';

/**
 * S10 T1 — Staff lifecycle state machine (Pending/Rejected additions).
 * Pure domain tests — no DB.
 */

describe('S10 T1 — Staff lifecycle (Pending/Rejected)', () => {
  it('Invited → Pending (registration) and Invited → Active (direct HQ) are legal', () => {
    expect(canTransitionStaffStatus('Invited', 'Pending')).toBe(true);
    expect(canTransitionStaffStatus('Invited', 'Active')).toBe(true);
  });

  it('Pending → Active (approve) and Pending → Rejected (reject) are legal', () => {
    expect(canTransitionStaffStatus('Pending', 'Active')).toBe(true);
    expect(canTransitionStaffStatus('Pending', 'Rejected')).toBe(true);
  });

  it('Active → Deactivated (resign) is legal; Deactivated → Active (reactivate) is legal', () => {
    expect(canTransitionStaffStatus('Active', 'Deactivated')).toBe(true);
    expect(canTransitionStaffStatus('Deactivated', 'Active')).toBe(true);
  });

  it('Rejected is terminal — no further transitions', () => {
    expect(canTransitionStaffStatus('Rejected', 'Active')).toBe(false);
    expect(canTransitionStaffStatus('Rejected', 'Pending')).toBe(false);
  });

  it('illegal transitions are rejected', () => {
    expect(canTransitionStaffStatus('Active', 'Pending')).toBe(false);
    expect(canTransitionStaffStatus('Pending', 'Deactivated')).toBe(false);
    expect(canTransitionStaffStatus('Invited', 'Rejected')).toBe(false);
  });

  it('command → target mapping', () => {
    expect(staffCommandTarget('approve')).toBe('Active');
    expect(staffCommandTarget('reject')).toBe('Rejected');
    expect(staffCommandTarget('deactivate')).toBe('Deactivated');
    expect(staffCommandTarget('activate')).toBe('Active');
  });
});
