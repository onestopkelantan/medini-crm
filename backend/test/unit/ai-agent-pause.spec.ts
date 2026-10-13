import { describe, it, expect } from 'vitest';

import {
  evaluatePolicy,
  classifyAction,
  UNCLASSIFIED,
  type PolicyInput,
} from '@modules/ai-manager/domain/ai-manager-policy';

/**
 * Migration 0025 pauses three non-operational agents (marketing-ai,
 * inventory-ai, recall-ai). The operation is only correct if a paused agent is
 * actually inert, so this pins the ENGINE behaviour the migration relies on:
 * step 2 of the evaluation order ("agent is <status>, not enabled").
 *
 * This is the mechanism, not the data: it does not read the database, so it
 * cannot go stale when the live roster changes — it asserts the rule that makes
 * `status = 'paused'` mean something.
 */

/** A fully-permissive input: enabled, owner-domain EXECUTE, auto rule. */
const base: PolicyInput = {
  agentStatus: 'enabled',
  agentOwnerDomain: 'marketing',
  agentDraftOnly: false,
  grantedCapabilities: ['READ', 'DRAFT', 'EXECUTE'],
  matchedGuardrails: [],
  approvalRule: { risk: 'MEDIUM', auto: true },
  domain: 'marketing',
  capability: 'EXECUTE',
};

describe('a paused agent is inert (migration 0025 relies on this)', () => {
  it('a paused agent is BLOCKED for EXECUTE even with the capability granted', () => {
    const r = evaluatePolicy({ ...base, agentStatus: 'paused' }, classifyAction('AP-3'));
    expect(r.decision).toBe('BLOCKED');
    expect(r.reason).toContain('paused');
  });

  it('is BLOCKED for every capability, not just EXECUTE', () => {
    for (const capability of ['READ', 'DRAFT', 'EXECUTE'] as const) {
      const r = evaluatePolicy({ ...base, agentStatus: 'paused', capability });
      expect(r.decision, `${capability} must be blocked while paused`).toBe('BLOCKED');
    }
  });

  it('the baseline (same input, enabled) is NOT blocked — the pause is what changed', () => {
    const r = evaluatePolicy(base);
    expect(r.decision).toBe('AUTO');
  });

  it('a paused agent is blocked before guardrails or approvals are even considered', () => {
    /* No approval rule, unclassified action: without the pause this would be
     * APPROVAL_REQUIRED (fail-closed EXECUTE). The pause wins first. */
    const r = evaluatePolicy(
      { ...base, agentStatus: 'paused', approvalRule: null },
      UNCLASSIFIED,
    );
    expect(r.decision).toBe('BLOCKED');
  });
});

describe('the two agents kept live still behave as before (no regression)', () => {
  it('an enabled, auto-classified agent still reaches AUTO', () => {
    expect(evaluatePolicy(base).decision).toBe('AUTO');
  });

  it('a HIGH-risk, non-auto rule still needs human approval', () => {
    const r = evaluatePolicy({ ...base, approvalRule: { risk: 'HIGH', auto: false } });
    expect(r.decision).toBe('APPROVAL_REQUIRED');
  });
});
