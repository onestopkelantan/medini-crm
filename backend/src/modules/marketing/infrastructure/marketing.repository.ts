import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  campaigns, followUpCases, leads, recallCases, recallRules,
  Campaign, FollowUpCase, Lead, RecallCase, RecallRule,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';

@Injectable()
export class MarketingRepository {
  async createLead(tx: DbClient, values: typeof leads.$inferInsert): Promise<Lead> { return this.insert(tx, leads, values); }
  async createCampaign(tx: DbClient, values: typeof campaigns.$inferInsert): Promise<Campaign> { return this.insert(tx, campaigns, values); }
  async createRecallRule(tx: DbClient, values: typeof recallRules.$inferInsert): Promise<RecallRule> { return this.insert(tx, recallRules, values); }
  async createRecallCase(tx: DbClient, values: typeof recallCases.$inferInsert): Promise<RecallCase> { return this.insert(tx, recallCases, values); }
  async createFollowUp(tx: DbClient, values: typeof followUpCases.$inferInsert): Promise<FollowUpCase> { return this.insert(tx, followUpCases, values); }

  private async insert<T extends { $inferInsert: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, values: T['$inferInsert']): Promise<T['$inferSelect']> {
    try { return (await tx.insert(table as never).values(values as never).returning())[0] as T['$inferSelect']; } catch (e) { throw toDomainError(e); }
  }

  async findLead(tx: DbClient, orgId: string, id: string): Promise<Lead | null> { return this.find(tx, leads, orgId, id); }
  async findCampaign(tx: DbClient, orgId: string, id: string): Promise<Campaign | null> { return this.find(tx, campaigns, orgId, id); }
  async findRecallRule(tx: DbClient, orgId: string, id: string): Promise<RecallRule | null> { return this.find(tx, recallRules, orgId, id); }
  async findRecallCase(tx: DbClient, orgId: string, id: string): Promise<RecallCase | null> { return this.find(tx, recallCases, orgId, id); }
  async findFollowUp(tx: DbClient, orgId: string, id: string): Promise<FollowUpCase | null> { return this.find(tx, followUpCases, orgId, id); }
  private async find<T extends { id: unknown; orgId: unknown; deletedAt: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, orgId: string, id: string): Promise<T['$inferSelect'] | null> {
    const rows = await tx.select().from(table as never).where(and(eq(table.orgId as never, orgId), eq(table.id as never, id), isNull(table.deletedAt as never))).limit(1);
    return (rows[0] as T['$inferSelect']) ?? null;
  }

  async findRecallDuplicate(tx: DbClient, orgId: string, patientId: string, ruleId: string | null, dueDate: string): Promise<RecallCase | null> {
    const condition = ruleId ? eq(recallCases.recallRuleId, ruleId) : isNull(recallCases.recallRuleId);
    const rows = await tx.select().from(recallCases).where(and(eq(recallCases.orgId, orgId), eq(recallCases.patientId, patientId), condition, eq(recallCases.dueDate, dueDate), isNull(recallCases.deletedAt))).limit(1);
    return rows[0] ?? null;
  }

  async listLeads(tx: DbClient, orgId: string, branchId: string | null): Promise<Lead[]> { return this.list(tx, leads, orgId, branchId); }
  async listCampaigns(tx: DbClient, orgId: string, branchId: string | null): Promise<Campaign[]> { return this.list(tx, campaigns, orgId, branchId); }
  async listRecallCases(tx: DbClient, orgId: string, branchId: string | null): Promise<RecallCase[]> { return this.list(tx, recallCases, orgId, branchId); }
  async listFollowUps(tx: DbClient, orgId: string, branchId: string | null): Promise<FollowUpCase[]> { return this.list(tx, followUpCases, orgId, branchId); }
  private async list<T extends { orgId: unknown; branchId: unknown; deletedAt: unknown; createdAt: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, orgId: string, branchId: string | null): Promise<T['$inferSelect'][]> {
    const conditions = [eq(table.orgId as never, orgId), isNull(table.deletedAt as never)];
    if (branchId) conditions.push(eq(table.branchId as never, branchId));
    return (await tx.select().from(table as never).where(and(...conditions)).orderBy(desc(table.createdAt as never))) as T['$inferSelect'][];
  }

  async updateStatus(tx: DbClient, table: typeof leads | typeof campaigns | typeof recallCases | typeof followUpCases, orgId: string, id: string, status: string, outcome?: string | null, campaignApproval?: { approvedAt: Date; approvedBy: string }) {
    const rows = await tx.update(table).set({ status: status as never, ...(outcome !== undefined ? { outcome } : {}), ...(campaignApproval ? { approvedAt: campaignApproval.approvedAt, approvedBy: campaignApproval.approvedBy } : {}), updatedAt: new Date() }).where(and(eq(table.orgId, orgId), eq(table.id, id), isNull(table.deletedAt))).returning();
    return rows[0] ?? null;
  }
}
