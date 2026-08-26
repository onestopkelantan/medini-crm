import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  aiAgents, aiCapabilities, aiKnowledge, aiAutomations, aiGuardrails, aiApprovalRules, aiAuditLog,
  AiAgent, AiCapability, AiKnowledge, AiAutomation, AiGuardrail, AiApprovalRule, AiAuditLog,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';
import { AiCapabilityClass } from '../domain/ai-manager-policy';

export const AI_PAGE_MAX = 100;

/** AI Manager repository — governance plane data access (org-global agents). */
@Injectable()
export class AiManagerRepository {
  /* ---------- agents ---------- */
  async listAgents(tx: DbClient, orgId: string): Promise<AiAgent[]> {
    return tx.select().from(aiAgents)
      .where(and(eq(aiAgents.orgId, orgId), isNull(aiAgents.deletedAt)))
      .orderBy(asc(aiAgents.key));
  }
  async findAgent(tx: DbClient, orgId: string, id: string): Promise<AiAgent | null> {
    const rows = await tx.select().from(aiAgents)
      .where(and(eq(aiAgents.orgId, orgId), eq(aiAgents.id, id), isNull(aiAgents.deletedAt))).limit(1);
    return rows[0] ?? null;
  }
  async findAgentByKey(tx: DbClient, orgId: string, key: string): Promise<AiAgent | null> {
    const rows = await tx.select().from(aiAgents)
      .where(and(eq(aiAgents.orgId, orgId), eq(aiAgents.key, key), isNull(aiAgents.deletedAt))).limit(1);
    return rows[0] ?? null;
  }
  async lockAgent(tx: DbClient, orgId: string, id: string): Promise<AiAgent | null> {
    const rows = await tx.select({ lock: sql`1` }).from(aiAgents)
      .where(and(eq(aiAgents.orgId, orgId), eq(aiAgents.id, id), isNull(aiAgents.deletedAt))).for('update');
    if (rows.length === 0) return null;
    return this.findAgent(tx, orgId, id);
  }
  async createAgent(tx: DbClient, values: typeof aiAgents.$inferInsert): Promise<AiAgent> {
    try { return (await tx.insert(aiAgents).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async updateAgent(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<AiAgent | null> {
    const rows = await tx.update(aiAgents).set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(aiAgents.orgId, orgId), eq(aiAgents.id, id), isNull(aiAgents.deletedAt))).returning();
    return rows[0] ?? null;
  }

  /* ---------- capabilities ---------- */
  async listCapabilities(tx: DbClient, orgId: string, agentId: string): Promise<AiCapability[]> {
    return tx.select().from(aiCapabilities)
      .where(and(eq(aiCapabilities.orgId, orgId), eq(aiCapabilities.agentId, agentId)));
  }
  async createCapability(tx: DbClient, values: typeof aiCapabilities.$inferInsert): Promise<AiCapability> {
    try { return (await tx.insert(aiCapabilities).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async deleteCapability(tx: DbClient, orgId: string, id: string): Promise<void> {
    await tx.delete(aiCapabilities).where(and(eq(aiCapabilities.orgId, orgId), eq(aiCapabilities.id, id)));
  }

  /* ---------- knowledge ---------- */
  async listKnowledge(tx: DbClient, orgId: string, agentId: string): Promise<AiKnowledge[]> {
    return tx.select().from(aiKnowledge)
      .where(and(eq(aiKnowledge.orgId, orgId), eq(aiKnowledge.agentId, agentId), isNull(aiKnowledge.deletedAt)))
      .orderBy(asc(aiKnowledge.item));
  }
  async createKnowledge(tx: DbClient, values: typeof aiKnowledge.$inferInsert): Promise<AiKnowledge> {
    try { return (await tx.insert(aiKnowledge).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async removeKnowledge(tx: DbClient, orgId: string, id: string): Promise<void> {
    await tx.update(aiKnowledge).set({ deletedAt: new Date(), updatedAt: new Date() } as never)
      .where(and(eq(aiKnowledge.orgId, orgId), eq(aiKnowledge.id, id)));
  }

  /* ---------- automations (metadata only) ---------- */
  async listAutomations(tx: DbClient, orgId: string, agentId?: string): Promise<AiAutomation[]> {
    const conds = [eq(aiAutomations.orgId, orgId)];
    if (agentId) conds.push(eq(aiAutomations.agentId, agentId));
    return tx.select().from(aiAutomations).where(and(...conds)).orderBy(asc(aiAutomations.triggerKey));
  }
  async createAutomation(tx: DbClient, values: typeof aiAutomations.$inferInsert): Promise<AiAutomation> {
    try { return (await tx.insert(aiAutomations).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async updateAutomation(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<AiAutomation | null> {
    const rows = await tx.update(aiAutomations).set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(aiAutomations.orgId, orgId), eq(aiAutomations.id, id))).returning();
    return rows[0] ?? null;
  }

  /* ---------- guardrails (global = agent_id NULL) ---------- */
  async listGuardrails(tx: DbClient, orgId: string): Promise<AiGuardrail[]> {
    return tx.select().from(aiGuardrails).where(eq(aiGuardrails.orgId, orgId)).orderBy(asc(aiGuardrails.ruleKey));
  }
  async createGuardrail(tx: DbClient, values: typeof aiGuardrails.$inferInsert): Promise<AiGuardrail> {
    try { return (await tx.insert(aiGuardrails).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }

  /* ---------- approval rules ---------- */
  async listApprovalRules(tx: DbClient, orgId: string): Promise<AiApprovalRule[]> {
    return tx.select().from(aiApprovalRules).where(eq(aiApprovalRules.orgId, orgId)).orderBy(asc(aiApprovalRules.actionKey));
  }
  async findApprovalRule(tx: DbClient, orgId: string, agentId: string | null, actionKey: string): Promise<AiApprovalRule | null> {
    /* agent-specific rule wins; fall back to global (agent_id NULL). */
    const rows = await tx.select().from(aiApprovalRules).where(and(
      eq(aiApprovalRules.orgId, orgId), eq(aiApprovalRules.actionKey, actionKey),
      agentId ? or(eq(aiApprovalRules.agentId, agentId), isNull(aiApprovalRules.agentId)) : isNull(aiApprovalRules.agentId),
    ));
    return rows.find((r) => r.agentId === agentId) ?? rows[0] ?? null;
  }
  async createApprovalRule(tx: DbClient, values: typeof aiApprovalRules.$inferInsert): Promise<AiApprovalRule> {
    try { return (await tx.insert(aiApprovalRules).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }

  /* ---------- policy evaluation reads ---------- */
  async capabilitiesForDomain(tx: DbClient, orgId: string, agentId: string, domain: string): Promise<AiCapabilityClass[]> {
    const rows = await tx.select({ capability: aiCapabilities.capability }).from(aiCapabilities)
      .where(and(eq(aiCapabilities.orgId, orgId), eq(aiCapabilities.agentId, agentId), eq(aiCapabilities.domain, domain)));
    return rows.map((r) => r.capability as AiCapabilityClass);
  }

  /* ---------- audit ---------- */
  async createAudit(tx: DbClient, values: typeof aiAuditLog.$inferInsert): Promise<AiAuditLog> {
    try { return (await tx.insert(aiAuditLog).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async listAudit(tx: DbClient, orgId: string, agentId: string | undefined, limit: number, offset: number): Promise<AiAuditLog[]> {
    const conds = [eq(aiAuditLog.orgId, orgId)];
    if (agentId) conds.push(eq(aiAuditLog.agentId, agentId));
    return tx.select().from(aiAuditLog).where(and(...conds))
      .orderBy(desc(aiAuditLog.createdAt)).limit(limit).offset(offset);
  }
}
