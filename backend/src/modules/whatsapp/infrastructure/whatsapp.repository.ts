import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import {
  waChannels, waConversations, waMessages, waAssignments, waTemplates, waSafetyDecisions,
  WaChannel, WaConversation, WaMessage, WaAssignment, WaTemplate, WaSafetyDecision,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/database-error';

export const WA_PAGE_MAX = 100;

@Injectable()
export class WhatsappRepository {
  /* ---------- inserts ---------- */
  async createChannel(tx: DbClient, values: typeof waChannels.$inferInsert): Promise<WaChannel> { return this.insert(tx, waChannels, values); }
  async createConversation(tx: DbClient, values: typeof waConversations.$inferInsert): Promise<WaConversation> { return this.insert(tx, waConversations, values); }
  async createMessage(tx: DbClient, values: typeof waMessages.$inferInsert): Promise<WaMessage> { return this.insert(tx, waMessages, values); }
  async createAssignment(tx: DbClient, values: typeof waAssignments.$inferInsert): Promise<WaAssignment> { return this.insert(tx, waAssignments, values); }
  async createTemplate(tx: DbClient, values: typeof waTemplates.$inferInsert): Promise<WaTemplate> { return this.insert(tx, waTemplates, values); }
  async createSafetyDecision(tx: DbClient, values: typeof waSafetyDecisions.$inferInsert): Promise<WaSafetyDecision> { return this.insert(tx, waSafetyDecisions, values); }

  private async insert<T extends { $inferInsert: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, values: T['$inferInsert']): Promise<T['$inferSelect']> {
    try { return (await tx.insert(table as never).values(values as never).returning())[0] as T['$inferSelect']; } catch (e) { throw toDomainError(e); }
  }

  /* ---------- finders (org-scoped, soft-delete aware) ---------- */
  async findChannel(tx: DbClient, orgId: string, id: string): Promise<WaChannel | null> { return this.find(tx, waChannels, orgId, id); }
  async findConversation(tx: DbClient, orgId: string, id: string): Promise<WaConversation | null> { return this.find(tx, waConversations, orgId, id); }
  async findMessage(tx: DbClient, orgId: string, id: string): Promise<WaMessage | null> { return this.find(tx, waMessages, orgId, id); }
  async findTemplate(tx: DbClient, orgId: string, id: string): Promise<WaTemplate | null> { return this.find(tx, waTemplates, orgId, id); }
  private async find<T extends { id: unknown; orgId: unknown; deletedAt: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, orgId: string, id: string): Promise<T['$inferSelect'] | null> {
    const rows = await tx.select().from(table as never).where(and(eq(table.orgId as never, orgId), eq(table.id as never, id), isNull(table.deletedAt as never))).limit(1);
    return (rows[0] as T['$inferSelect']) ?? null;
  }

  /** Transaction-scoped row lock for lifecycle/concurrency-critical actions (SELECT ... FOR UPDATE). */
  async lockConversation(tx: DbClient, orgId: string, id: string): Promise<WaConversation | null> {
    const rows = await tx.select({ lock: sql`1` }).from(waConversations)
      .where(and(eq(waConversations.orgId, orgId), eq(waConversations.id, id), isNull(waConversations.deletedAt)))
      .for('update');
    if (rows.length === 0) return null;
    return this.findConversation(tx, orgId, id);
  }

  async lockChannel(tx: DbClient, orgId: string, id: string): Promise<WaChannel | null> {
    const rows = await tx.select({ lock: sql`1` }).from(waChannels)
      .where(and(eq(waChannels.orgId, orgId), eq(waChannels.id, id), isNull(waChannels.deletedAt)))
      .for('update');
    if (rows.length === 0) return null;
    return this.findChannel(tx, orgId, id);
  }

  /** Deterministic active-conversation lookup (channel + contact, non-archived). */
  async findActiveConversation(tx: DbClient, orgId: string, channelId: string, contactPhone: string): Promise<WaConversation | null> {
    const rows = await tx.select().from(waConversations).where(and(
      eq(waConversations.orgId, orgId), eq(waConversations.channelId, channelId),
      eq(waConversations.contactPhone, contactPhone), isNull(waConversations.deletedAt),
    )).limit(5);
    return rows.find((r: WaConversation) => r.status !== 'archived') ?? null;
  }

  /** Idempotent message replay lookup (same conversation + key). */
  async findMessageByIdempotencyKey(tx: DbClient, orgId: string, conversationId: string, key: string): Promise<WaMessage | null> {
    const rows = await tx.select().from(waMessages).where(and(
      eq(waMessages.orgId, orgId), eq(waMessages.conversationId, conversationId),
      eq(waMessages.idempotencyKey, key), isNull(waMessages.deletedAt),
    )).limit(1);
    return rows[0] ?? null;
  }

  /* ---------- bounded lists ---------- */
  async listChannels(tx: DbClient, orgId: string, branchId: string | null, limit: number, offset: number): Promise<WaChannel[]> {
    const conds = [eq(waChannels.orgId, orgId), isNull(waChannels.deletedAt)];
    if (branchId) conds.push(eq(waChannels.branchId, branchId));
    return tx.select().from(waChannels).where(and(...conds)).orderBy(asc(waChannels.createdAt)).limit(limit).offset(offset);
  }

  async listConversations(
    tx: DbClient, orgId: string, branchId: string | null,
    filters: { status?: string; assignedTo?: string; unassigned?: boolean; unreadOnly?: boolean },
    limit: number, offset: number,
  ): Promise<WaConversation[]> {
    const conds = [eq(waConversations.orgId, orgId), isNull(waConversations.deletedAt)];
    if (branchId) conds.push(eq(waConversations.branchId, branchId));
    if (filters.status) conds.push(eq(waConversations.status, filters.status as never));
    if (filters.assignedTo) conds.push(eq(waConversations.assignedTo, filters.assignedTo));
    if (filters.unassigned) conds.push(isNull(waConversations.assignedTo));
    if (filters.unreadOnly) conds.push(sql`${waConversations.unreadCount} > 0`);
    return tx.select().from(waConversations).where(and(...conds)).orderBy(desc(waConversations.lastMessageAt), desc(waConversations.createdAt)).limit(limit).offset(offset);
  }

  async listMessages(tx: DbClient, orgId: string, conversationId: string, limit: number, offset: number): Promise<WaMessage[]> {
    return tx.select().from(waMessages).where(and(
      eq(waMessages.orgId, orgId), eq(waMessages.conversationId, conversationId), isNull(waMessages.deletedAt),
    )).orderBy(asc(waMessages.createdAt)).limit(limit).offset(offset);
  }

  async listAssignments(tx: DbClient, orgId: string, conversationId: string): Promise<WaAssignment[]> {
    return tx.select().from(waAssignments).where(and(
      eq(waAssignments.orgId, orgId), eq(waAssignments.conversationId, conversationId),
    )).orderBy(asc(waAssignments.createdAt)).limit(WA_PAGE_MAX);
  }

  async listTemplates(tx: DbClient, orgId: string, branchId: string | null, limit: number, offset: number): Promise<WaTemplate[]> {
    const conds = [eq(waTemplates.orgId, orgId), isNull(waTemplates.deletedAt)];
    if (branchId) conds.push(eq(waTemplates.branchId, branchId));
    return tx.select().from(waTemplates).where(and(...conds)).orderBy(asc(waTemplates.name)).limit(limit).offset(offset);
  }

  async listSafetyDecisions(tx: DbClient, orgId: string, branchId: string | null, limit: number, offset: number): Promise<WaSafetyDecision[]> {
    const conds = [eq(waSafetyDecisions.orgId, orgId)];
    if (branchId) conds.push(eq(waSafetyDecisions.branchId, branchId));
    return tx.select().from(waSafetyDecisions).where(and(...conds)).orderBy(desc(waSafetyDecisions.createdAt)).limit(limit).offset(offset);
  }

  /**
   * Inbox queue for the operator: newest activity first, scoped by the tab the
   * user chose. Kept here (not in the service) so the filter predicates stay
   * next to the schema they reference.
   */
  async listConversationQueue(
    tx: DbClient, orgId: string, branchId: string | null,
    filter: 'all' | 'needs_human' | 'unanswered' | 'ai',
    limit: number, offset: number,
  ): Promise<WaConversation[]> {
    const conds = [
      eq(waConversations.orgId, orgId),
      isNull(waConversations.deletedAt),
      notInArray(waConversations.status, ['archived'] as never[]),
    ];
    if (branchId) conds.push(eq(waConversations.branchId, branchId));

    if (filter === 'needs_human') {
      conds.push(eq(waConversations.needsHuman, true));
    } else if (filter === 'unanswered') {
      conds.push(sql`${waConversations.unreadCount} > 0`);
      conds.push(isNull(waConversations.firstResponseAt));
    } else if (filter === 'ai') {
      conds.push(isNull(waConversations.assignedTo));
      conds.push(eq(waConversations.needsHuman, false));
      conds.push(sql`${waConversations.aiQueueState} IS NOT NULL`);
      conds.push(notInArray(waConversations.aiQueueState, ['handoff', 'closed'] as never[]));
    }

    return tx.select().from(waConversations).where(and(...conds))
      .orderBy(desc(waConversations.lastMessageAt), desc(waConversations.createdAt))
      .limit(limit).offset(offset);
  }

  /* ---------- updates ---------- */
  async updateChannel(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<WaChannel | null> {
    const rows = await tx.update(waChannels).set({ ...set, updatedAt: new Date() } as never).where(and(eq(waChannels.orgId, orgId), eq(waChannels.id, id), isNull(waChannels.deletedAt))).returning();
    return rows[0] ?? null;
  }

  async updateConversation(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<WaConversation | null> {
    const rows = await tx.update(waConversations).set({ ...set, updatedAt: new Date() } as never).where(and(eq(waConversations.orgId, orgId), eq(waConversations.id, id), isNull(waConversations.deletedAt))).returning();
    return rows[0] ?? null;
  }

  async updateMessage(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<WaMessage | null> {
    const rows = await tx.update(waMessages).set({ ...set, updatedAt: new Date() } as never).where(and(eq(waMessages.orgId, orgId), eq(waMessages.id, id), isNull(waMessages.deletedAt))).returning();
    return rows[0] ?? null;
  }

  async updateTemplate(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<WaTemplate | null> {
    /* `toDomainError` is what turns a UNIQUE violation into a 409. `create`
     * above has it; this method did not, so renaming a template to a name that
     * already exists in the branch surfaced as HTTP 500 "unexpected error"
     * instead of a 409 the operator can read and act on. The unique key is
     * (org_id, branch_id, name), so an UPDATE can violate it just as easily as
     * an INSERT — every write path needs the mapper, not just the insert. */
    try {
      const rows = await tx.update(waTemplates).set({ ...set, updatedAt: new Date() } as never).where(and(eq(waTemplates.orgId, orgId), eq(waTemplates.id, id), isNull(waTemplates.deletedAt))).returning();
      return rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }
}
