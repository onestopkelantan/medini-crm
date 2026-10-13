/**
 * AI Manager domain — lifecycle + POLICY ENGINE (Sprint 7 T3). Pure functions.
 *
 * The policy engine is the heart of AI governance. It answers:
 *   "Can agent X perform capability C in domain D for action A?"
 * with a deterministic decision: AUTO | DRAFT | APPROVAL_REQUIRED | BLOCKED.
 *
 * Evaluation order (fail-closed; first decisive rule wins):
 *   1. Guardrail HARD_BLOCK match      → BLOCKED        (absolute, cannot bypass)
 *   2. Agent not ENABLED               → BLOCKED
 *   3. Capability not granted          → BLOCKED
 *   4. draft_only agent + EXECUTE      → BLOCKED        (Marketing/Clinical/…)
 *   5. Non-owner domain EXECUTE        → BLOCKED        (no cross-domain execute)
 *   6. Administration EXECUTE          → BLOCKED        (AI = READ/RECOMMEND only)
 *   7. Approval rule HIGH non-auto     → APPROVAL_REQUIRED
 *   8. Guardrail APPROVAL_REQUIRED     → APPROVAL_REQUIRED
 *   9. EXECUTE granted + auto          → AUTO
 *  10. DRAFT granted                  → DRAFT
 *  11. READ granted                    → AUTO (read is always safe)
 */

export type AiDecision = 'AUTO' | 'DRAFT' | 'APPROVAL_REQUIRED' | 'BLOCKED';
export type AiCapabilityClass = 'READ' | 'DRAFT' | 'EXECUTE';
export type AiRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type AiAgentStatus = 'registered' | 'enabled' | 'paused' | 'archived';

/* ---------- agent lifecycle ---------- */
const AGENT_TRANSITIONS: Record<AiAgentStatus, readonly AiAgentStatus[]> = {
  registered: ['enabled'],
  enabled: ['paused', 'archived'],
  paused: ['enabled', 'archived'],
  archived: [], /* terminal */
};
export function canTransitionAiAgent(from: AiAgentStatus, to: AiAgentStatus): boolean {
  return (AGENT_TRANSITIONS[from] ?? []).includes(to);
}

/* ---------- policy evaluation inputs ---------- */
export interface PolicyInput {
  agentStatus: AiAgentStatus;
  agentOwnerDomain: string;
  agentDraftOnly: boolean;
  /** capabilities the agent has for the TARGET domain (already filtered). */
  grantedCapabilities: readonly AiCapabilityClass[];
  /** guardrails that match this action: level + whether the rule matches. */
  matchedGuardrails: readonly { level: 'HARD_BLOCK' | 'APPROVAL_REQUIRED' }[];
  /** approval rule for this action (if any). */
  approvalRule: { risk: AiRiskLevel; auto: boolean } | null;
  domain: string;
  capability: AiCapabilityClass;
}

export interface PolicyResult {
  decision: AiDecision;
  reason: string;
}

/* ============================================================================
   ACTION CLASSIFICATION (N7-3 / N7-4 remediation)
   Guardrails match the ACTION'S SEMANTIC CLASS — never the domain string.
   This is the single canonical classification used by the policy engine; it is
   NOT a parallel permission system (domains supply the class; the engine owns
   the guardrail semantics).
   ==========================================================================*/
export interface ActionClassification {
  /** GR-1 (N7-3): the action/content IS medical advice or diagnosis.
   * HARD_BLOCK is DOMAIN-INDEPENDENT — clinical, whatsapp, patients,
   * marketing, any domain, any role, any capability. No domain bypass. */
  medicalAdvice: boolean;
  /** GR-5 (N7-4): the action would SEND PHI to an EXTERNAL model.
   * HARD_BLOCK targets exactly that path — NOT every EXECUTE. */
  phiToExternalModel: boolean;
  /** Whether the PHI/external classification is positively known. When false
   * (unknown), the engine FAILS CLOSED on EXECUTE (cannot prove non-PHI). */
  externalModelClassified: boolean;
}

/** Default classification when a caller supplies nothing: unknown → fail-closed. */
export const UNCLASSIFIED: ActionClassification = {
  medicalAdvice: false,
  phiToExternalModel: false,
  externalModelClassified: false,
};

/** Canonical action-key → classification registry (governance-approved, G5/G6).
 * GR-1: any action key carrying medical advice/diagnosis content.
 * GR-5: any action key that sends PHI to an external model. */
const ACTION_CLASSIFICATIONS: Record<string, Partial<ActionClassification>> = {
  'clinical.medical_advice': { medicalAdvice: true },
  'clinical.diagnosis': { medicalAdvice: true },
  'ai.external_prompt': { externalModelClassified: true, phiToExternalModel: true },
  'AP-4': { medicalAdvice: true }, /* clinical sign-off IS a clinical judgement */
};

/** Resolve the classification for an action key. Unknown key → UNCLASSIFIED
 * (fail-closed on EXECUTE; READ/DRAFT of non-medical content unaffected). */
export function classifyAction(actionKey: string | null): ActionClassification {
  if (!actionKey) return UNCLASSIFIED;
  const hit = ACTION_CLASSIFICATIONS[actionKey];
  if (!hit) return UNCLASSIFIED;
  return {
    medicalAdvice: hit.medicalAdvice ?? false,
    phiToExternalModel: hit.phiToExternalModel ?? false,
    externalModelClassified: hit.externalModelClassified ?? false,
  };
}

const ADMINISTRATION_DOMAIN = 'admin';

export function evaluatePolicy(input: PolicyInput, classification: ActionClassification = UNCLASSIFIED): PolicyResult {
  /* 1. Guardrail HARD_BLOCK — absolute, evaluated FIRST (cannot be bypassed).
   * N7-3: GR-1 medical advice is DOMAIN-INDEPENDENT (any domain, any
   * capability, any role). N7-4: GR-5 targets PHI→external-model exactly. */
  if (classification.medicalAdvice) {
    return { decision: 'BLOCKED', reason: 'GR-1 HARD_BLOCK: medical advice/diagnosis (domain-independent)' };
  }
  if (classification.phiToExternalModel) {
    return { decision: 'BLOCKED', reason: 'GR-5 HARD_BLOCK: PHI to external model' };
  }
  if (input.matchedGuardrails.some((g) => g.level === 'HARD_BLOCK')) {
    return { decision: 'BLOCKED', reason: 'HARD_BLOCK guardrail matched' };
  }
  /* 2. Agent must be ENABLED. */
  if (input.agentStatus !== 'enabled') {
    return { decision: 'BLOCKED', reason: `agent is ${input.agentStatus} (not enabled)` };
  }
  /* 3. Capability must be explicitly granted. */
  if (!input.grantedCapabilities.includes(input.capability)) {
    return { decision: 'BLOCKED', reason: `capability ${input.capability} not granted in domain '${input.domain}'` };
  }
  /* 4–6. EXECUTE-specific hard rules. */
  if (input.capability === 'EXECUTE') {
    if (input.agentDraftOnly) {
      return { decision: 'BLOCKED', reason: 'agent is draft-only (EXECUTE never granted)' };
    }
    if (input.domain === ADMINISTRATION_DOMAIN) {
      return { decision: 'BLOCKED', reason: 'administration is HUMAN-ONLY EXECUTE' };
    }
    if (input.domain !== input.agentOwnerDomain) {
      return { decision: 'BLOCKED', reason: 'agent cannot EXECUTE outside its owner domain' };
    }
    /* N7-4: unknown PHI/external classification on EXECUTE → fail closed.
     * We cannot prove the action does NOT send PHI to an external model, so
     * EXECUTE requires an explicit approval path, not an ambiguous AUTO. */
    if (!classification.externalModelClassified && !input.approvalRule) {
      return { decision: 'APPROVAL_REQUIRED', reason: 'unclassified EXECUTE requires human review (fail-closed)' };
    }
  }
  /* 7. Approval rule: HIGH-risk non-auto requires human approval. */
  if (input.approvalRule && input.approvalRule.risk === 'HIGH' && !input.approvalRule.auto) {
    return { decision: 'APPROVAL_REQUIRED', reason: 'HIGH-risk action requires human approval' };
  }
  /* 8. Guardrail APPROVAL_REQUIRED. */
  if (input.matchedGuardrails.some((g) => g.level === 'APPROVAL_REQUIRED')) {
    return { decision: 'APPROVAL_REQUIRED', reason: 'APPROVAL_REQUIRED guardrail matched' };
  }
  /* 9–11. Granted outcomes. */
  if (input.capability === 'EXECUTE') {
    if (input.approvalRule && !input.approvalRule.auto) {
      return { decision: 'APPROVAL_REQUIRED', reason: 'approval rule requires human review' };
    }
    return { decision: 'AUTO', reason: 'EXECUTE granted (auto)' };
  }
  if (input.capability === 'DRAFT') {
    return { decision: 'DRAFT', reason: 'DRAFT granted' };
  }
  return { decision: 'AUTO', reason: 'READ granted' };
}
