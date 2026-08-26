import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  marketingTemplates, marketingSegments,
  MarketingTemplate, MarketingSegment,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';

export interface TemplateListFilter {
  channel?: string | null;
  status?: string | null;
}

/**
 * MarketingContentRepository — stateless data access for marketing templates
 * and saved audience segments. Same discipline as MarketingRepository: every
 * method takes the runAs `tx` first; RLS enforces the branch boundary.
 */
@Injectable()
export class MarketingContentRepository {
  /* ---- templates ---- */

  async createTemplate(tx: DbClient, values: typeof marketingTemplates.$inferInsert): Promise<MarketingTemplate> {
    try {
      const rows = await tx.insert(marketingTemplates).values(values).returning();
      return rows[0]!;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async findTemplate(tx: DbClient, orgId: string, id: string): Promise<MarketingTemplate | null> {
    const rows = await tx
      .select()
      .from(marketingTemplates)
      .where(and(eq(marketingTemplates.orgId, orgId), eq(marketingTemplates.id, id), isNull(marketingTemplates.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listTemplates(
    tx: DbClient, orgId: string, branchId: string | null, filter: TemplateListFilter = {},
  ): Promise<MarketingTemplate[]> {
    const conditions = [eq(marketingTemplates.orgId, orgId), isNull(marketingTemplates.deletedAt)];
    if (branchId) conditions.push(eq(marketingTemplates.branchId, branchId));
    if (filter.channel) conditions.push(eq(marketingTemplates.channel, filter.channel as never));
    if (filter.status) conditions.push(eq(marketingTemplates.status, filter.status as never));
    return tx
      .select()
      .from(marketingTemplates)
      .where(and(...conditions))
      .orderBy(desc(marketingTemplates.createdAt));
  }

  async updateTemplate(
    tx: DbClient, orgId: string, id: string, set: Record<string, unknown>,
  ): Promise<MarketingTemplate | null> {
    const rows = await tx
      .update(marketingTemplates)
      .set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(marketingTemplates.orgId, orgId), eq(marketingTemplates.id, id), isNull(marketingTemplates.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /* ---- segments ---- */

  async createSegment(tx: DbClient, values: typeof marketingSegments.$inferInsert): Promise<MarketingSegment> {
    try {
      const rows = await tx.insert(marketingSegments).values(values).returning();
      return rows[0]!;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async listSegments(tx: DbClient, orgId: string, branchId: string | null): Promise<MarketingSegment[]> {
    const conditions = [eq(marketingSegments.orgId, orgId), isNull(marketingSegments.deletedAt)];
    if (branchId) conditions.push(eq(marketingSegments.branchId, branchId));
    return tx
      .select()
      .from(marketingSegments)
      .where(and(...conditions))
      .orderBy(desc(marketingSegments.createdAt));
  }
}
