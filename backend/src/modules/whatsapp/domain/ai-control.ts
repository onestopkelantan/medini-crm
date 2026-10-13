/**
 * FASA 5D-A — AI control.
 *
 * WHY THIS EXISTS
 *
 * There was no way to switch the AI off. The settings table had `antiban_enabled`
 * — which sounds similar and means something else entirely: it disables the
 * anti-ban BRAKES, so turning it off makes the account MORE aggressive, not less.
 * An operator who reads "enabled = false" as "AI is off" gets the opposite of
 * what they intended.
 *
 * So the toggle is a separate column with a separate name, and the two are never
 * conflated.
 *
 * THREE DOORS, ONE RULE
 *
 * The AI can be stopped at three scopes, and a conversation is answered only if
 * all three allow it:
 *
 *   1. Per-branch  — the operator switches AI off for one clinic
 *   2. Per-patient — the patient asked for a human, or the AI gave up
 *   3. Per-chat    — a staff member took the conversation over
 *
 * The check is a single pure function over those three inputs, so no call site
 * can partially apply the rule and let a message through.
 */

/** Why the AI is not answering. Recorded, so the operator sees the real cause. */
export type AiHoldReason =
  | 'BRANCH_AI_DISABLED'
  | 'AGENT_PAUSED'
  | 'BOOKING_AGENT_PAUSED'
  | 'HUMAN_REQUESTED'
  | 'STAFF_HANDOFF';

export interface AiDecisionInput {
  /** The operator's switch for this branch. */
  branchAiEnabled: boolean;
  /**
   * The AGENT-level switch from the AI Manager registry (policy engine).
   * `ai-receptionist` must be `enabled` for any reply to go out —
   * this is what makes the Pause button in AI Manager actually pause the
   * bot. Supplied by the caller from the AiPolicyPort verdict; default true
   * keeps the function total for callers that have not wired the port yet.
   */
  agentEnabled?: boolean;
  /**
   * The patient asked for a person, or the AI reached its turn limit and
   * escalated. `needs_human` on the conversation.
   */
  needsHuman: boolean;
  /**
   * The AI queue state. `'handoff'` means a staff member took this conversation
   * over and the AI must stay out of it until they hand it back.
   */
  aiQueueState: string | null;
  /** Conversation status. `'escalated'` is a terminal escalation. */
  status?: string | null;
}

export interface AiDecision {
  /** May the AI produce and send a reply? */
  allowed: boolean;
  /** Why not. Null when allowed. */
  reason: AiHoldReason | null;
}

/**
 * May the AI answer this conversation?
 *
 * Ordered by scope: the branch switch is checked first because it is the widest,
 * and its reason is the one an operator most needs to see ("I turned it off" beats
 * "this one patient asked for a human" when the whole branch is off).
 */
export function canAiReply(input: AiDecisionInput): AiDecision {
  if (!input.branchAiEnabled) {
    return { allowed: false, reason: 'BRANCH_AI_DISABLED' };
  }

  if (input.agentEnabled === false) {
    return { allowed: false, reason: 'AGENT_PAUSED' };
  }

  if (input.needsHuman || input.status === 'escalated') {
    return { allowed: false, reason: 'HUMAN_REQUESTED' };
  }

  if (input.aiQueueState === 'handoff') {
    return { allowed: false, reason: 'STAFF_HANDOFF' };
  }

  return { allowed: true, reason: null };
}

/**
 * May the AI CREATE a booking?
 *
 * The reply pipeline was policy-gated (canAiReply), but booking creation ran
 * inside it without its own registry check. Booking is a separate AI worker
 * (`booking-ai`, owner domain `appointments`), so pausing Booking AI in the AI
 * Manager must stop appointments from being created. A refused booking is a
 * hold that flags the conversation for a human — the patient expects a
 * booking, and nobody else is going to make it.
 */
export function canAiCreateBooking(input: { bookingAgentEnabled: boolean }): AiDecision {
  if (!input.bookingAgentEnabled) {
    return { allowed: false, reason: 'BOOKING_AGENT_PAUSED' };
  }
  return { allowed: true, reason: null };
}

/**
 * Should this conversation be flagged for a human when the AI is held?
 *
 * TRUE for a branch-wide shutdown, because the patient has nobody watching them:
 * with the AI off there is no fallback, so the conversation must surface in the
 * operator's list. FALSE when the reason is already a human state
 * (needs_human / handoff) — flagging again would only reset the escalation
 * timestamp and lose how long the patient has actually been waiting.
 */
export function shouldFlagForHuman(reason: AiHoldReason | null): boolean {
  return (
    reason === 'BRANCH_AI_DISABLED' ||
    reason === 'AGENT_PAUSED' ||
    reason === 'BOOKING_AGENT_PAUSED'
  );
}

/**
 * Plain-Malay explanation for the operator, shown on the conversation.
 *
 * No internal code names: an operator reading "AI_MUTED_BRANCH" learns nothing
 * about what to do next.
 */
export const AI_HOLD_MESSAGE: Record<AiHoldReason, string> = {
  BRANCH_AI_DISABLED:
    'AI dimatikan untuk cawangan ini. Semua mesej masuk perlu dijawab oleh staf.',
  AGENT_PAUSED:
    'Agen AI Nur dijeda di AI Manager. Aktifkan semula di tab Agents untuk memulihkan balasan automatik.',
  BOOKING_AGENT_PAUSED:
    'Agen Booking AI dijeda di AI Manager. Tempahan automatik dihentikan — aktifkan semula di tab Agents.',
  HUMAN_REQUESTED:
    'Pesakit meminta bercakap dengan staf, atau AI sudah berhenti menjawab.',
  STAFF_HANDOFF:
    'Staf telah mengambil alih perbualan ini. AI tidak akan menjawab sehingga dikembalikan.',
};

/** Short label for a list row, where the full sentence would not fit. */
export const AI_HOLD_LABEL: Record<AiHoldReason, string> = {
  BRANCH_AI_DISABLED: 'AI dimatikan',
  AGENT_PAUSED: 'Agen dijeda',
  BOOKING_AGENT_PAUSED: 'Booking AI dijeda',
  HUMAN_REQUESTED: 'Perlu staf',
  STAFF_HANDOFF: 'Staf ambil alih',
};
