import { describe, it, expect } from 'vitest';

import {
  canAiReply,
  shouldFlagForHuman,
  AI_HOLD_MESSAGE,
  AI_HOLD_LABEL,
} from '@modules/whatsapp/domain/ai-control';

/**
 * FASA 5D-A ai-control — extended with AGENT_PAUSED (policy-engine wiring).
 *
 * The registry in AI Manager says a paused agent "cannot run anything it
 * proposes". This test pins the domain rule that gives that statement teeth
 * on the reply pipeline: a paused agent holds the conversation for a human,
 * exactly like a branch-wide shutdown, because the patient has nobody else
 * watching them.
 */
describe('ai-control — AGENT_PAUSED (policy engine wiring)', () => {
  it('agent paused holds the AI even when branch switch is on', () => {
    const d = canAiReply({
      branchAiEnabled: true,
      agentEnabled: false,
      needsHuman: false,
      aiQueueState: null,
      status: 'open',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('AGENT_PAUSED');
  });

  it('agent enabled + branch on + no human state allows the reply', () => {
    const d = canAiReply({
      branchAiEnabled: true,
      agentEnabled: true,
      needsHuman: false,
      aiQueueState: null,
      status: 'open',
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeNull();
  });

  it('branch switch still wins when it is the wider shutdown (ordered reasons)', () => {
    const d = canAiReply({
      branchAiEnabled: false,
      agentEnabled: false,
      needsHuman: false,
      aiQueueState: null,
      status: 'open',
    });
    /* Widest scope first: an operator reading the reason wants "I turned the
     * branch off", not "the agent is paused", when both are true. */
    expect(d.reason).toBe('BRANCH_AI_DISABLED');
  });

  it('AGENT_PAUSED flags the conversation for a human (nobody else is watching)', () => {
    expect(shouldFlagForHuman('AGENT_PAUSED')).toBe(true);
  });

  it('every hold reason has a plain-Malay message and short label', () => {
    for (const reason of ['BRANCH_AI_DISABLED', 'AGENT_PAUSED', 'HUMAN_REQUESTED', 'STAFF_HANDOFF'] as const) {
      expect(AI_HOLD_MESSAGE[reason].length).toBeGreaterThan(10);
      expect(AI_HOLD_LABEL[reason].length).toBeGreaterThan(2);
    }
  });
});
