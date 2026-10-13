import { describe, it, expect } from 'vitest';

import {
  APPROVAL_REQUEST_STATUSES,
  canTransitionApprovalRequest,
  isApprovalRequestStatus,
  isOpenApprovalRequest,
  decisionRefusalReason,
} from '@modules/ai-manager/domain/approval-request-lifecycle';

/**
 * The approval queue (A3b) only means something if a DECIDED request stays
 * decided. These pin the rules the service relies on when it writes a verdict:
 * pending → approved/rejected/cancelled, and nothing afterwards.
 */

describe('approval request lifecycle — shape', () => {
  it('has exactly the four statuses', () => {
    expect([...APPROVAL_REQUEST_STATUSES]).toEqual(['pending', 'approved', 'rejected', 'cancelled']);
  });
  it('recognises its own statuses and rejects strangers', () => {
    expect(isApprovalRequestStatus('pending')).toBe(true);
    expect(isApprovalRequestStatus('approved')).toBe(true);
    expect(isApprovalRequestStatus('escalated')).toBe(false);
    expect(isApprovalRequestStatus('')).toBe(false);
  });
});

describe('approval request lifecycle — transitions', () => {
  it('a pending request can be approved, rejected or cancelled', () => {
    for (const to of ['approved', 'rejected', 'cancelled'] as const) {
      expect(canTransitionApprovalRequest('pending', to), `pending → ${to}`).toBe(true);
    }
  });
  it('same-state is a legal no-op (Medini convention)', () => {
    for (const s of APPROVAL_REQUEST_STATUSES) {
      expect(canTransitionApprovalRequest(s, s), `${s} → ${s}`).toBe(true);
    }
  });
  it('a decided request is TERMINAL — it cannot be re-decided', () => {
    for (const from of ['approved', 'rejected', 'cancelled'] as const) {
      for (const to of ['approved', 'rejected', 'cancelled'] as const) {
        if (from === to) continue;
        expect(canTransitionApprovalRequest(from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });
  it('a decided request cannot be re-opened to pending', () => {
    for (const from of ['approved', 'rejected', 'cancelled'] as const) {
      expect(canTransitionApprovalRequest(from, 'pending'), `${from} → pending`).toBe(false);
    }
  });
  it('unknown statuses never transition', () => {
    expect(canTransitionApprovalRequest('nonsense', 'approved')).toBe(false);
    expect(canTransitionApprovalRequest('pending', 'nonsense')).toBe(false);
  });
});

describe('approval request lifecycle — openness', () => {
  it('only pending is open', () => {
    expect(isOpenApprovalRequest('pending')).toBe(true);
    expect(isOpenApprovalRequest('approved')).toBe(false);
    expect(isOpenApprovalRequest('rejected')).toBe(false);
    expect(isOpenApprovalRequest('cancelled')).toBe(false);
  });
});

describe('decisionRefusalReason — the message a human sees', () => {
  it('allows a first decision on a pending request', () => {
    expect(decisionRefusalReason('pending', 'approved')).toBeNull();
    expect(decisionRefusalReason('pending', 'rejected')).toBeNull();
    expect(decisionRefusalReason('pending', 'cancelled')).toBeNull();
  });

  it('refuses a second decision and says the request is already decided', () => {
    const reason = decisionRefusalReason('approved', 'rejected');
    expect(reason).toContain('already approved');
  });

  it('refuses re-opening even from pending', () => {
    expect(decisionRefusalReason('pending', 'pending')).toContain('cannot be re-opened');
  });

  it('reports an unknown status rather than pretending it is open', () => {
    expect(decisionRefusalReason('weird', 'approved')).toContain('unknown status');
  });
});
