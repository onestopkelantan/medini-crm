/**
 * ============================================================================
 * AI GOVERNANCE — EXECUTABLE CONTRACT (drift guard source of truth)
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 *
 * The AI Manager's canonical roster is LOCKED (see `docs/architecture/
 * AI-MANAGER-ARCHITECTURE.md` §9 and `AI-MANAGER-LOCKED.md`). Its approved seed
 * lived ONLY in the retired legacy database set (`drizzle/0016_...`). When the project
 * moved to MySQL that seed was never ported, so `ai_agents`, `ai_guardrails` and
 * `ai_approval_rules` shipped EMPTY — and nothing failed. Weeks later the tables
 * had been filled by hand with a session-invented roster that silently violated
 * the locked draft-only rule.
 *
 * THE FIX IS NOT DISCIPLINE, IT IS A FAILING TEST.
 *
 * This file is the single authoritative list of what the lock requires. The
 * drift-guard spec (`test/contract/ai-governance.contract.spec.ts`) asserts three
 * things against it:
 *   1. the constants are internally consistent,
 *   2. the MySQL migration set actually SEEDS them (catches "never ported"), and
 *   3. the LIVE database MATCHES them (catches "hand-edited into drift").
 *
 * If any of those stop being true, the build fails loudly instead of the drift
 * being discovered by a human months later.
 *
 * This is a NEW file. It deliberately does NOT touch
 * `architecture.contract.ts`, which is a verbatim port of the locked frontend
 * source and must not be reinterpreted.
 */

/** Owner domains an AI agent may EXECUTE in. One owner per agent (locked rule 1). */
export type AiOwnerDomain =
  | 'whatsapp'
  | 'marketing'
  | 'clinical'
  | 'appointments'
  | 'finance'
  | 'operations'
  | 'reports';

export interface CanonicalAgent {
  readonly key: string;
  readonly name: string;
  readonly ownerDomain: AiOwnerDomain;
  /**
   * Locked rule 3: draft-only agents NEVER execute — a human does. The policy
   * engine blocks their EXECUTE even when the capability row exists.
   */
  readonly draftOnly: boolean;
}

/**
 * The canonical 8-agent roster (approved G7). Exactly one owner domain each.
 * Order is the seed order and carries no meaning.
 */
export const AI_AGENT_REGISTRY: readonly CanonicalAgent[] = [
  { key: 'ai-receptionist', name: 'AI Receptionist', ownerDomain: 'whatsapp',     draftOnly: false },
  { key: 'marketing-ai',    name: 'Marketing AI',    ownerDomain: 'marketing',    draftOnly: true  },
  { key: 'clinical-ai',     name: 'Clinical AI',     ownerDomain: 'clinical',     draftOnly: true  },
  { key: 'booking-ai',      name: 'Booking AI',      ownerDomain: 'appointments', draftOnly: false },
  { key: 'finance-ai',      name: 'Finance AI',      ownerDomain: 'finance',      draftOnly: false },
  { key: 'inventory-ai',    name: 'Inventory AI',    ownerDomain: 'operations',   draftOnly: true  },
  { key: 'recall-ai',       name: 'Recall AI',       ownerDomain: 'marketing',    draftOnly: false },
  { key: 'insights-ai',     name: 'Insights AI',     ownerDomain: 'reports',      draftOnly: true  },
];

/** The agent keys an operator must NEVER find retired/live-missing. */
export const CANONICAL_AGENT_KEYS: readonly string[] = AI_AGENT_REGISTRY.map((a) => a.key);

/** Locked rule 3: these agents are draft-only; the rest may execute (in-owner-domain). */
export const DRAFT_ONLY_AGENT_KEYS: readonly string[] = AI_AGENT_REGISTRY
  .filter((a) => a.draftOnly)
  .map((a) => a.key);

export interface CanonicalGuardrail {
  readonly ruleKey: string;
  readonly level: 'HARD_BLOCK' | 'APPROVAL_REQUIRED';
  /** null = global (applies to every agent). */
  readonly agentKey: string | null;
}

/** Global hard guardrails (approved G6). Evaluated first; cannot be bypassed. */
export const AI_GUARDRAIL_REGISTRY: readonly CanonicalGuardrail[] = [
  { ruleKey: 'GR-1', level: 'HARD_BLOCK', agentKey: null },
  { ruleKey: 'GR-5', level: 'HARD_BLOCK', agentKey: null },
];

export interface CanonicalApprovalRule {
  readonly agentKey: string;
  readonly actionKey: string;
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly auto: boolean;
}

/**
 * Approval rules (approved G5 + the two runtime classifications added since).
 * AP-3/AP-4 are the only HIGH-risk actions and are human-mandatory; the two
 * runtime actions are classified MEDIUM-auto so the fail-closed EXECUTE rule
 * does not hold every legitimate booking/reply.
 */
export const AI_APPROVAL_RULE_REGISTRY: readonly CanonicalApprovalRule[] = [
  { agentKey: 'marketing-ai',    actionKey: 'AP-3',               risk: 'HIGH',   auto: false },
  { agentKey: 'clinical-ai',     actionKey: 'AP-4',               risk: 'HIGH',   auto: false },
  { agentKey: 'ai-receptionist', actionKey: 'wa.reply_patient',   risk: 'MEDIUM', auto: true  },
  { agentKey: 'booking-ai',      actionKey: 'booking.create',     risk: 'MEDIUM', auto: true  },
];

/**
 * Agents deliberately RETIRED — present in the table but soft-deleted, so they
 * are neither live nor usable. `web-app-executor` was a session invention with
 * no canonical equivalent (it violated locked rule 2, cross-domain EXECUTE).
 */
export const RETIRED_AGENT_KEYS: readonly string[] = ['web-app-executor'];
