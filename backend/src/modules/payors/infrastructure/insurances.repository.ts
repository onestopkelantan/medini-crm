import { Injectable } from '@nestjs/common';
import { eq, and, isNull, or, ilike, desc, sql } from 'drizzle-orm';
import { insuranceCompanies, InsuranceCompany } from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';

export interface CreateInsuranceInput {
  code: string;
  name: string;
  pic?: string | null;
  phone?: string | null;
  address?: string | null;
  source: string;
}

export interface UpdateInsuranceInput {
  name?: string;
  pic?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface InsuranceSearchQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * InsurancesRepository — stateless data access for insurance master data
 * (Sprint 2A T4). Mirrors PanelsRepository exactly: tx-first (runAs → T1 RLS
 * applies), org_id always server-derived, org-wide (no branch filter by
 * design), soft-delete only.
 */
@Injectable()
export class InsurancesRepository {
  async create(tx: DbClient, orgId: string, input: CreateInsuranceInput): Promise<InsuranceCompany> {
    try {
      const rows = await tx
        .insert(insuranceCompanies)
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

  async findById(tx: DbClient, orgId: string, id: string): Promise<InsuranceCompany | null> {
    const rows = await tx
      .select()
      .from(insuranceCompanies)
      .where(and(eq(insuranceCompanies.orgId, orgId), eq(insuranceCompanies.id, id), isNull(insuranceCompanies.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async search(tx: DbClient, orgId: string, query: InsuranceSearchQuery): Promise<InsuranceCompany[]> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const conditions = [eq(insuranceCompanies.orgId, orgId), isNull(insuranceCompanies.deletedAt)];
    if (query.q && query.q.trim().length >= 2) {
      const q = `%${query.q.trim()}%`;
      conditions.push(or(ilike(insuranceCompanies.name, q), ilike(insuranceCompanies.code, q))!);
    }
    return tx
      .select()
      .from(insuranceCompanies)
      .where(and(...conditions))
      .orderBy(desc(insuranceCompanies.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /** Case-insensitive exact-name duplicate pre-check (final guard = DB unique index). */
  async findByName(tx: DbClient, orgId: string, normalizedName: string): Promise<InsuranceCompany | null> {
    const rows = await tx
      .select()
      .from(insuranceCompanies)
      .where(and(
        eq(insuranceCompanies.orgId, orgId),
        sql`lower(${insuranceCompanies.name}) = lower(${normalizedName})`,
        isNull(insuranceCompanies.deletedAt),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(tx: DbClient, orgId: string, id: string, input: UpdateInsuranceInput): Promise<InsuranceCompany | null> {
    try {
      const rows = await tx
        .update(insuranceCompanies)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.pic !== undefined ? { pic: input.pic } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(insuranceCompanies.orgId, orgId), eq(insuranceCompanies.id, id), isNull(insuranceCompanies.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async updateStatus(
    tx: DbClient, orgId: string, id: string, status: 'Active' | 'Inactive',
  ): Promise<InsuranceCompany | null> {
    const rows = await tx
      .update(insuranceCompanies)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(insuranceCompanies.orgId, orgId), eq(insuranceCompanies.id, id), isNull(insuranceCompanies.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
