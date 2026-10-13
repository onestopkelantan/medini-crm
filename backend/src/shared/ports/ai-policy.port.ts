import { Injectable } from '@nestjs/common';
import { DbContextService } from '../../core/auth/db-context.service';
import { Principal } from '../../core/auth/principal';
import { AiManagerRepository } from '../../modules/ai-manager/infrastructure/ai-manager.repository';
import { AiManagerService } from '../../modules/ai-manager/application/ai-manager.service';
import { AiCapabilityClass } from '../../modules/ai-manager/domain/ai-manager-policy';

export type AiPolicyDecision = 'AUTO' | 'DRAFT' | 'APPROVAL_REQUIRED' | 'BLOCKED';
export interface AiPolicyVerdict {
  decision: AiPolicyDecision;
  reason: string;
}

/**
 * AiPolicyPort — sanctioned CROSS-MODULE AI governance boundary (Sprint 7 T4).
 * Any domain (WhatsApp, Marketing, Clinical, …) asks:
 *   "Can AI agent X perform capability C in my domain for action A?"
 * and receives a deterministic verdict. The port NEVER executes anything and
 * NEVER calls a model — it only evaluates governance policy.
 *
 * Domains consume this port; they do NOT import ai-manager tables/repositories
 * and do NOT re-implement policy logic. Wired into WhatsApp/Marketing/etc. in a
 * LATER approved sprint — S7 exposes the contract only (approved G11).
 */
@Injectable()
export class AiPolicyPort {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly aiManager: AiManagerService,
    private readonly repo: AiManagerRepository,
  ) {}

  /** Evaluate governance policy for an agent action. Fail-closed: unknown
   * agent → BLOCKED. Runs inside the caller principal's RLS context. */
  async evaluate(
    principal: Principal,
    args: { agentKey: string; domain: string; capability: AiCapabilityClass; actionKey?: string | null },
  ): Promise<AiPolicyVerdict> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const agent = await this.repo.findAgentByKey(tx, principal.orgId, args.agentKey);
      if (!agent) return { decision: 'BLOCKED', reason: 'unknown agent' };
      return this.aiManager.evaluateForAgent(
        tx, principal.orgId, agent.id, args.domain, args.capability, args.actionKey ?? null,
      );
    });
  }

  /** Convenience: may the agent EXECUTE autonomously (AUTO) right now? */
  async canAutoExecute(principal: Principal, args: { agentKey: string; domain: string; actionKey?: string | null }): Promise<boolean> {
    const verdict = await this.evaluate(principal, { ...args, capability: 'EXECUTE' });
    return verdict.decision === 'AUTO';
  }

  /** Convenience: may the agent produce a DRAFT for a human to action?
   * Used by DRAFT-ONLY agents (locked rule 3), which never EXECUTE. */
  async canDraft(principal: Principal, args: { agentKey: string; domain: string; actionKey?: string | null }): Promise<boolean> {
    const verdict = await this.evaluate(principal, { ...args, capability: 'DRAFT' });
    return verdict.decision === 'DRAFT';
  }

  /**
   * A3b — record a HELD action so a human can decide it.
   *
   * Called by a domain when the verdict is APPROVAL_REQUIRED: the AI wanted to
   * act, a human must authorise it, and the request needs somewhere to live.
   * Before this, the verdict collapsed into a boolean and the request vanished.
   *
   * This is still the GOVERNANCE plane: it records what was proposed and why it
   * was held. It never executes the action and never calls a model — the owning
   * domain decides whether to act on the decision.
   *
   * The port lives in the caller's identity (a system worker on the reply path),
   * so the row is written as that actor and the audit says who was held.
   */
  async recordApproval(
    principal: Principal,
    args: {
      agentKey: string; domain: string; actionKey: string; reason: string;
      payload?: Record<string, unknown> | null;
    },
  ): Promise<{ id: string }> {
    /* Delegates to the SINGLE implementation in AiManagerService. The port must
     * NOT write the row itself: two derivation paths would drift, and the one
     * caught in verification (risk declared LOW instead of the rule's MEDIUM)
     * is exactly that failure. */
    const row = await this.aiManager.requestApproval(principal, args);
    return { id: row.id };
  }
}
