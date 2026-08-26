import { Injectable } from '@nestjs/common';
import { eq, and, isNull, ilike, asc } from 'drizzle-orm';
import {
  panelCompanies, insuranceCompanies, PanelCompany, InsuranceCompany,
} from '../../infrastructure/database/schema';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';

/**
 * PayorsReadPort — sanctioned CROSS-MODULE read boundary for payor master
 * data (Sprint 2A T2). Lives in shared so that the future Finance module can
 * resolve Panel/Insurance identity without importing payors infrastructure
 * (module-boundary rule) and without duplicating master data.
 *
 * READ-ONLY master-data contract: it NEVER writes and exposes NO invoice /
 * payment / revenue / outstanding / Bukku / clinical concepts (ADR-004).
 * Operates on the caller's runAs() transaction so RLS applies.
 */
@Injectable()
export class PayorsReadPort {
  async getPanelById(tx: DbClient, orgId: string, id: string): Promise<PanelCompany | null> {
    const rows = await tx
      .select()
      .from(panelCompanies)
      .where(and(eq(panelCompanies.orgId, orgId), eq(panelCompanies.id, id), isNull(panelCompanies.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getInsuranceById(tx: DbClient, orgId: string, id: string): Promise<InsuranceCompany | null> {
    const rows = await tx
      .select()
      .from(insuranceCompanies)
      .where(and(eq(insuranceCompanies.orgId, orgId), eq(insuranceCompanies.id, id), isNull(insuranceCompanies.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active panels for picklists/payor selection (org-scoped, name-ordered). */
  async listActivePanels(tx: DbClient, orgId: string): Promise<PanelCompany[]> {
    return tx
      .select()
      .from(panelCompanies)
      .where(and(
        eq(panelCompanies.orgId, orgId),
        eq(panelCompanies.status, 'Active'),
        isNull(panelCompanies.deletedAt),
      ))
      .orderBy(asc(panelCompanies.name));
  }

  /** Active insurance companies for picklists/payor selection. */
  async listActiveInsurances(tx: DbClient, orgId: string): Promise<InsuranceCompany[]> {
    return tx
      .select()
      .from(insuranceCompanies)
      .where(and(
        eq(insuranceCompanies.orgId, orgId),
        eq(insuranceCompanies.status, 'Active'),
        isNull(insuranceCompanies.deletedAt),
      ))
      .orderBy(asc(insuranceCompanies.name));
  }

  /** Case-insensitive exact-name lookup (duplicate pre-check helper, T3/T4). */
  async findPanelByName(tx: DbClient, orgId: string, normalizedName: string): Promise<PanelCompany | null> {
    const rows = await tx
      .select()
      .from(panelCompanies)
      .where(and(
        eq(panelCompanies.orgId, orgId),
        ilike(panelCompanies.name, normalizedName),
        isNull(panelCompanies.deletedAt),
      ))
      .limit(1);
    return rows[0] ?? null;
  }
}
