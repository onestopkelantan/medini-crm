import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../../../shared/errors/errors';
import { AiManagerRepository, AI_PAGE_MAX } from '../infrastructure/ai-manager.repository';
import {
  canTransitionAiAgent, evaluatePolicy, classifyAction, AiAgentStatus, AiCapabilityClass, AiRiskLevel, PolicyResult,
} from '../domain/ai-manager-policy';

const uuid = z.string().uuid();
const page = z.object({
  limit: z.coerce.number().int().min(1).max(AI_PAGE_MAX).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const domainKey = z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/);
const capClass = z.enum(['READ', 'DRAFT', 'EXECUTE']);

const agentInput = z.object({
  key: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(128),
  icon: z.string().trim().max(32).nullish(),
  ownerDomain: domainKey,
  description: z.string().trim().max(1024).nullish(),
});
const capabilityInput = z.object({ domain: domainKey, capability: capClass, draftOnly: z.boolean().optional() });
const knowledgeInput = z.object({
  item: z.string().trim().min(1).max(256),
  type: z.enum(['static', 'dynamic']).optional(),
  sourceDomain: domainKey.nullish(),
  sourceRef: z.string().trim().max(256).nullish(),
});
const automationInput = z.object({
  triggerKey: z.string().trim().min(1).max(128),
  actionKey: z.string().trim().min(1).max(128),
  enabled: z.boolean().optional(),
});
const guardrailInput = z.object({
  agentId: uuid.nullish(), /* null = GLOBAL */
  ruleKey: z.string().trim().min(1).max(64),
  rule: z.string().trim().min(4).max(1024),
  level: z.enum(['HARD_BLOCK', 'APPROVAL_REQUIRED']),
});
const approvalRuleInput = z.object({
  agentId: uuid.nullish(),
  actionKey: z.string().trim().min(1).max(128),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  auto: z.boolean(),
  note: z.string().trim().max(512).nullish(),
});
const evaluateInput = z.object({
  agentKey: z.string().trim().min(1).max(64),
  domain: domainKey,
  capability: capClass,
  actionKey: z.string().trim().max(128).nullish(),
});

/**
 * AiManagerService — AI WORKFORCE CONTROL PLANE (Sprint 7 T3).
 * GOVERNANCE ONLY: agent registry, capabilities, knowledge metadata, automation
 * metadata, guardrails, approval rules, audit + the deterministic policy engine.
 * NO LLM calls, NO model runtime, NO worker/scheduler/queue/outbox.
 *
 * RBAC (canonical matrix `ai`): hq view/create/edit/approve · branch_manager view
 * · branch_admin/doctor NONE. PermissionGuard + service HQ checks + RLS.
 */
@Injectable()
export class AiManagerService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: AiManagerRepository,
    private readonly audit: AuditService,
  ) {}

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new ValidationError(Object.fromEntries(result.error.issues.map((x) => [x.path.join('.'), [x.message]])));
    return result.data;
  }
  private auditEvent(p: Principal, action: string, entity: string, id: string, before?: Record<string, unknown>, after?: Record<string, unknown>) {
    return { actorId: p.staffId, actorRole: p.role, action, entity, entityId: id, orgId: p.orgId, branchId: null, source: 'api' as const, before, after };
  }
  private requireHq(p: Principal) {
    if (p.role !== 'hq') throw new ForbiddenError('AI Manager configuration is restricted to HQ');
  }
  private pageOf(raw: unknown) {
    const pg = this.parse(page, raw ?? {});
    return { limit: pg.limit ?? 50, offset: pg.offset ?? 0 };
  }

  /* ==========================================================================
     AGENTS — registry + lifecycle
     ==========================================================================*/
  async listAgents(p: Principal) {
    return this.dbCtx.runAs(p, (tx) => this.repo.listAgents(tx, p.orgId));
  }
  async getAgent(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const agent = await this.repo.findAgent(tx, p.orgId, id);
      if (!agent) throw new NotFoundError('aiAgent', id);
      const [capabilities, knowledge, automations] = await Promise.all([
        this.repo.listCapabilities(tx, p.orgId, id),
        this.repo.listKnowledge(tx, p.orgId, id),
        this.repo.listAutomations(tx, p.orgId, id),
      ]);
      return { ...agent, capabilities, knowledge, automations };
    });
  }
  async registerAgent(p: Principal, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(agentInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const existing = await this.repo.findAgentByKey(tx, p.orgId, input.key);
      if (existing) throw new ConflictError(`Agent '${input.key}' already exists`);
      const row = await this.repo.createAgent(tx, {
        orgId: p.orgId, key: input.key, name: input.name, icon: input.icon ?? null,
        ownerDomain: input.ownerDomain, status: 'registered', description: input.description ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'ai_agent_registered', 'ai_agents', row.id, undefined, { key: input.key, ownerDomain: input.ownerDomain }), tx);
      return row;
    });
  }

  /** Lifecycle: enable / pause / archive. Invalid transitions rejected. */
  async transitionAgent(p: Principal, id: string, command: 'enable' | 'pause' | 'archive') {
    this.requireHq(p);
    const target: AiAgentStatus = command === 'enable' ? 'enabled' : command === 'pause' ? 'paused' : 'archived';
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.lockAgent(tx, p.orgId, id);
      if (!before) throw new NotFoundError('aiAgent', id);
      if (!canTransitionAiAgent(before.status as AiAgentStatus, target)) {
        throw new ConflictError(`Illegal agent transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before;
      const updated = await this.repo.updateAgent(tx, p.orgId, id, { status: target });
      if (!updated) throw new NotFoundError('aiAgent', id);
      await this.repo.createAudit(tx, {
        orgId: p.orgId, agentId: id, actorId: p.staffId,
        action: `agent_${command}d`, status: target,
        detail: { from: before.status, to: target } as never,
      });
      await this.audit.record(this.auditEvent(p, `ai_agent_${command}d`, 'ai_agents', id, { status: before.status }, { status: target }), tx);
      return updated;
    });
  }

  /* ==========================================================================
     CAPABILITIES — explicit grants (HQ only)
     ==========================================================================*/
  async grantCapability(p: Principal, agentId: string, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(capabilityInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const agent = await this.repo.findAgent(tx, p.orgId, agentId);
      if (!agent) throw new NotFoundError('aiAgent', agentId);
      /* Hard rule: EXECUTE outside owner domain is never grantable. */
      if (input.capability === 'EXECUTE' && input.domain !== agent.ownerDomain) {
        throw new ForbiddenError('EXECUTE may only be granted in the agent owner domain');
      }
      const row = await this.repo.createCapability(tx, {
        orgId: p.orgId, agentId, domain: input.domain, capability: input.capability,
        draftOnly: input.draftOnly ?? false, createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'ai_capability_granted', 'ai_capabilities', row.id, undefined, input as never), tx);
      return row;
    });
  }

  /* ==========================================================================
     KNOWLEDGE (metadata) + AUTOMATIONS (metadata) — HQ only
     ==========================================================================*/
  async addKnowledge(p: Principal, agentId: string, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(knowledgeInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const agent = await this.repo.findAgent(tx, p.orgId, agentId);
      if (!agent) throw new NotFoundError('aiAgent', agentId);
      const row = await this.repo.createKnowledge(tx, {
        orgId: p.orgId, agentId, item: input.item, type: input.type ?? 'static',
        sourceDomain: input.sourceDomain ?? null, sourceRef: input.sourceRef ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'ai_knowledge_added', 'ai_knowledge', row.id, undefined, { item: input.item }), tx);
      return row;
    });
  }
  async createAutomation(p: Principal, agentId: string, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(automationInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const agent = await this.repo.findAgent(tx, p.orgId, agentId);
      if (!agent) throw new NotFoundError('aiAgent', agentId);
      const row = await this.repo.createAutomation(tx, {
        orgId: p.orgId, agentId, triggerKey: input.triggerKey, actionKey: input.actionKey,
        enabled: input.enabled ?? false, createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'ai_automation_created', 'ai_automations', row.id, undefined, input as never), tx);
      return row;
    });
  }
  async toggleAutomation(p: Principal, id: string, enabled: boolean) {
    this.requireHq(p);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.updateAutomation(tx, p.orgId, id, { enabled });
      if (!row) throw new NotFoundError('aiAutomation', id);
      await this.repo.createAudit(tx, {
        orgId: p.orgId, agentId: row.agentId, actorId: p.staffId,
        action: enabled ? 'automation_enabled' : 'automation_disabled', status: 'auto',
        detail: { automationId: id } as never,
      });
      return row;
    });
  }

  /* ==========================================================================
     GUARDRAILS + APPROVAL RULES — HQ only
     ==========================================================================*/
  async listGuardrails(p: Principal) {
    return this.dbCtx.runAs(p, (tx) => this.repo.listGuardrails(tx, p.orgId));
  }
  async createGuardrail(p: Principal, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(guardrailInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      if (input.agentId) {
        const agent = await this.repo.findAgent(tx, p.orgId, input.agentId);
        if (!agent) throw new NotFoundError('aiAgent', input.agentId);
      }
      const row = await this.repo.createGuardrail(tx, {
        orgId: p.orgId, agentId: input.agentId ?? null, ruleKey: input.ruleKey,
        rule: input.rule, level: input.level, createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'ai_guardrail_created', 'ai_guardrails', row.id, undefined, { ruleKey: input.ruleKey, level: input.level }), tx);
      return row;
    });
  }
  async listApprovalRules(p: Principal) {
    return this.dbCtx.runAs(p, (tx) => this.repo.listApprovalRules(tx, p.orgId));
  }
  async createApprovalRule(p: Principal, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(approvalRuleInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      if (input.agentId) {
        const agent = await this.repo.findAgent(tx, p.orgId, input.agentId);
        if (!agent) throw new NotFoundError('aiAgent', input.agentId);
      }
      const row = await this.repo.createApprovalRule(tx, {
        orgId: p.orgId, agentId: input.agentId ?? null, actionKey: input.actionKey,
        risk: input.risk, auto: input.auto, note: input.note ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'ai_approval_rule_created', 'ai_approval_rules', row.id, undefined, input as never), tx);
      return row;
    });
  }

  /* ==========================================================================
     POLICY ENGINE — deterministic governance decision + audit
     ==========================================================================*/
  async evaluate(p: Principal, raw: unknown): Promise<PolicyResult & { agentId: string }> {
    const input = this.parse(evaluateInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const agent = await this.repo.findAgentByKey(tx, p.orgId, input.agentKey);
      if (!agent) throw new NotFoundError('aiAgent', input.agentKey);
      const result = await this.evaluateForAgent(tx, p.orgId, agent.id, input.domain, input.capability, input.actionKey ?? null);
      /* Every policy decision is auditable (governance: no silent AI action). */
      await this.repo.createAudit(tx, {
        orgId: p.orgId, agentId: agent.id, actorId: p.staffId,
        action: 'policy_evaluated', status: result.decision.toLowerCase(),
        detail: { domain: input.domain, capability: input.capability, actionKey: input.actionKey ?? null, reason: result.reason } as never,
      });
      return { ...result, agentId: agent.id };
    });
  }

  /**
   * Domain-neutral policy evaluation (used by the REST surface AND by the
   * shared AiPolicyPort for future domain consumption). Runs inside the
   * caller's transaction so RLS context applies.
   */
  async evaluateForAgent(
    tx: Parameters<AiManagerRepository['capabilitiesForDomain']>[0],
    orgId: string, agentId: string, domain: string,
    capability: AiCapabilityClass, actionKey: string | null,
  ): Promise<PolicyResult> {
    const agent = await this.repo.findAgent(tx, orgId, agentId);
    if (!agent) return { decision: 'BLOCKED', reason: 'unknown agent' };
    const [granted, guardrails, approvalRule] = await Promise.all([
      this.repo.capabilitiesForDomain(tx, orgId, agentId, domain),
      this.repo.listGuardrails(tx, orgId),
      actionKey ? this.repo.findApprovalRule(tx, orgId, agentId, actionKey) : Promise.resolve(null),
    ]);
    /* Guardrail matching: global (agent_id NULL) + agent-specific apply.
     * N7-3/N7-4: GR-1 (medical advice) and GR-5 (PHI→external model) are now
     * evaluated by ACTION CLASSIFICATION inside evaluatePolicy (domain-
     * independent for GR-1; PHI-external-specific for GR-5) — NOT by domain
     * string and NOT by blanket EXECUTE. Remaining matched guardrails here
     * carry only non-classification rules (APPROVAL_REQUIRED level). */
    const matched = guardrails
      .filter((g) => g.agentId === null || g.agentId === agentId)
      .filter((g) => g.ruleKey !== 'GR-1' && g.ruleKey !== 'GR-5') /* classification-owned */
      .filter(() => capability !== 'READ')
      .map((g) => ({ level: g.level as 'HARD_BLOCK' | 'APPROVAL_REQUIRED' }));
    return evaluatePolicy({
      agentStatus: agent.status as AiAgentStatus,
      agentOwnerDomain: agent.ownerDomain,
      agentDraftOnly: await this.isDraftOnly(tx, orgId, agentId, domain),
      grantedCapabilities: granted,
      matchedGuardrails: matched,
      approvalRule: approvalRule ? { risk: approvalRule.risk as AiRiskLevel, auto: approvalRule.auto } : null,
      domain,
      capability,
    }, classifyAction(actionKey));
  }

  private async isDraftOnly(tx: Parameters<AiManagerRepository['capabilitiesForDomain']>[0], orgId: string, agentId: string, domain: string): Promise<boolean> {
    const caps = await this.repo.listCapabilities(tx, orgId, agentId);
    return caps.some((c) => c.domain === domain && c.draftOnly);
  }

  /* ==========================================================================
     AUDIT
     ==========================================================================*/
  async listAudit(p: Principal, agentId: string | undefined, rawPage: unknown) {
    const pg = this.pageOf(rawPage);
    return this.dbCtx.runAs(p, (tx) => this.repo.listAudit(tx, p.orgId, agentId, pg.limit, pg.offset));
  }
}
