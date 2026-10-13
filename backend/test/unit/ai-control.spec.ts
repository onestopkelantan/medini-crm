import { describe, it, expect } from 'vitest';

import {
  canAiReply,
  shouldFlagForHuman,
  AI_HOLD_MESSAGE,
  AI_HOLD_LABEL,
} from '@modules/whatsapp/domain/ai-control';

/**
 * FASA 5D-A — AI control.
 *
 * THREE DOORS. The AI answers only when all three allow it, and each door has to
 * hold on its own: an operator's branch switch must survive a patient who never
 * asked for a human, a staff handoff must survive the branch switch being on, and
 * a patient who asked for a person must not be answered because nobody touched
 * the other two.
 *
 * The failure mode this guards against is a message that goes out because ONE
 * door was checked and the others were assumed open.
 */

describe('FASA 5D-A — may the AI reply?', () => {
  const OPEN = {
    branchAiEnabled: true,
    needsHuman: false,
    aiQueueState: null,
    status: 'open',
  };

  it('allows a normal conversation', () => {
    expect(canAiReply(OPEN)).toEqual({ allowed: true, reason: null });
  });

  /* -------------------------------------------------------- door 1: branch */

  it('holds every conversation when the operator switches AI off for the branch', () => {
    /* The whole point of the switch: with it off, no patient gets an AI answer. */
    const d = canAiReply({ ...OPEN, branchAiEnabled: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('BRANCH_AI_DISABLED');
  });

  it('reports the branch switch as the reason even when other doors are also shut', () => {
    /* The branch switch is the widest scope, so it is the reason worth showing:
     * "I turned it off" beats "this one patient asked for a human" when the whole
     * clinic is off. */
    const d = canAiReply({
      branchAiEnabled: false,
      needsHuman: true,
      aiQueueState: 'handoff',
      status: 'escalated',
    });
    expect(d.reason).toBe('BRANCH_AI_DISABLED');
  });

  /* ------------------------------------------------------- door 2: patient */

  it('holds a conversation the AI escalated to a human', () => {
    expect(canAiReply({ ...OPEN, needsHuman: true }).reason).toBe('HUMAN_REQUESTED');
  });

  it('holds a conversation whose status is escalated, even with needs_human unset', () => {
    /* The two fields are written together, but a partial write or an older row
     * could leave one set. Either alone must be enough to hold. */
    expect(canAiReply({ ...OPEN, status: 'escalated' }).reason).toBe('HUMAN_REQUESTED');
  });

  /* ---------------------------------------------------------- door 3: chat */

  it('holds a conversation a staff member took over', () => {
    expect(canAiReply({ ...OPEN, aiQueueState: 'handoff' }).reason).toBe('STAFF_HANDOFF');
  });

  it('does not hold on other AI queue states', () => {
    /* buffering/ready/processing are transient states of the AI doing its work.
     * Treating them as holds would silence the AI permanently once it answered
     * anything. */
    for (const state of ['received', 'buffering', 'ready', 'processing', 'responded', 'closed']) {
      expect(canAiReply({ ...OPEN, aiQueueState: state }).allowed).toBe(true);
    }
  });

  /* ------------------------------------------------------------ interaction */

  it('does not answer a patient who asked for a human just because the branch switch is on', () => {
    /* The trap: operator sees "AI is enabled" and assumes everything is answered.
     * A patient who asked for a person must still be held. */
    const d = canAiReply({ ...OPEN, branchAiEnabled: true, needsHuman: true });
    expect(d.allowed).toBe(false);
  });

  it('does not answer a handed-off chat just because the patient is calm', () => {
    /* Staff took over a straightforward question. The AI must not jump back in
     * and answer over them. */
    const d = canAiReply({ ...OPEN, aiQueueState: 'handoff', needsHuman: false });
    expect(d.allowed).toBe(false);
  });
});

describe('FASA 5D-A — flagging for a human', () => {
  it('flags when the branch AI is off, because nothing else will catch the patient', () => {
    /* With the AI off there is no fallback: if the conversation is not surfaced,
     * nobody sees it. */
    expect(shouldFlagForHuman('BRANCH_AI_DISABLED')).toBe(true);
  });

  it('does not re-flag a conversation that is already a human state', () => {
    /* Flagging again would rewrite needs_human_at, destroying the record of how
     * long the patient has actually been waiting — which is exactly what the SLA
     * features measure. */
    expect(shouldFlagForHuman('HUMAN_REQUESTED')).toBe(false);
    expect(shouldFlagForHuman('STAFF_HANDOFF')).toBe(false);
  });

  it('does not flag when the AI is allowed to answer', () => {
    expect(shouldFlagForHuman(null)).toBe(false);
  });
});

describe('FASA 5D-A — operator-facing wording', () => {
  it('explains each hold in plain Malay, with no internal code names', () => {
    for (const reason of ['BRANCH_AI_DISABLED', 'HUMAN_REQUESTED', 'STAFF_HANDOFF'] as const) {
      const msg = AI_HOLD_MESSAGE[reason];
      expect(msg.length).toBeGreaterThan(20);
      /* A raw enum leaking into the UI teaches the operator nothing. */
      expect(msg).not.toContain(reason);
      expect(msg).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });

  it('gives the branch switch a message that says who must now answer', () => {
    expect(AI_HOLD_MESSAGE.BRANCH_AI_DISABLED).toMatch(/staf/i);
  });

  it('has a short label for a list row', () => {
    for (const reason of ['BRANCH_AI_DISABLED', 'HUMAN_REQUESTED', 'STAFF_HANDOFF'] as const) {
      expect(AI_HOLD_LABEL[reason].length).toBeLessThan(20);
    }
  });
});
