import { Injectable } from '@nestjs/common';
import { eq, and, isNull, or, ilike, desc, sql } from 'drizzle-orm';
import { panelCompanies, PanelCompany } from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';

export interface CreatePanelInput {
  code: string;
  name: string;
  pic?: string | null;
  phone?: string | null;
  address?: string | null;
  source: string;
}

export interface UpdatePanelInput {
  name?: string;
  pic?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface PanelSearchQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * PanelsRepository — stateless data access for payor master data (Sprint 2A T3).
 *
 * Same discipline as PatientsRepository: every method takes the runAs()
 * transaction so the T1 RLS policy applies (read = hq/branch_manager,
 * write = hq only, enforced again at the DB layer). org_id is ALWAYS
 * server-derived from the authenticated principal — never from client input.
 * Org-wide master data: no branch filter by design (T1).
 */
@Injectable()
export class PanelsRepository {
  async create(tx: DbClient, orgId: string, input: CreatePanelInput): Promise<PanelCompany> {
    try {
      const rows = await tx
        .insert(panelCompanies)
        .values({
          orgId,
          code: input.code,
          name: input.name,
          pic: input.pic ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          source: input.source,
          status: 'Active',
        })
        .returning();
      return rows[0]!;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async findById(tx: DbClient, orgId: string, id: string): Promise<PanelCompany | null> {
    const rows = await tx
      .select()
      .from(panelCompanies)
      .where(and(eq(panelCompanies.orgId, orgId), eq(panelCompanies.id, id), isNull(panelCompanies.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async search(tx: DbClient, orgId: string, query: PanelSearchQuery): Promise<PanelCompany[]> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const conditions = [eq(panelCompanies.orgId, orgId), isNull(panelCompanies.deletedAt)];
    if (query.q && query.q.trim().length >= 2) {
      const q = `%${query.q.trim()}%`;
      conditions.push(or(ilike(panelCompanies.name, q), ilike(panelCompanies.code, q))!);
    }
    return tx
      .select()
      .from(panelCompanies)
      .where(and(...conditions))
      .orderBy(desc(panelCompanies.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /** Case-insensitive exact-name duplicate pre-check (final guard = DB unique index). */
  async findByName(tx: DbClient, orgId: string, normalizedName: string): Promise<PanelCompany | null> {
    const rows = await tx
      .select()
      .from(panelCompanies)
      .where(and(
        eq(panelCompanies.orgId, orgId),
        sql`lower(${panelCompanies.name}) = lower(${normalizedName})`,
        isNull(panelCompanies.deletedAt),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(tx: DbClient, orgId: string, id: string, input: UpdatePanelInput): Promise<PanelCompany | null> {
    try {
      const rows = await tx
        .update(panelCompanies)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.pic !== undefined ? { pic: input.pic } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(panelCompanies.orgId, orgId), eq(panelCompanies.id, id), isNull(panelCompanies.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async updateStatus(
    tx: DbClient, orgId: string, id: string, status: 'Active' | 'Inactive',
  ): Promise<PanelCompany | null> {
    const rows = await tx
      .update(panelCompanies)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(panelCompanies.orgId, orgId), eq(panelCompanies.id, id), isNull(panelCompanies.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
