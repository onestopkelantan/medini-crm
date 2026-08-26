import { Injectable } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { kpiDefinitions, reportAudit, branches, staff } from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';

/** S9 — Reports persistence: canonical KPI registry reads, report_audit
 * appends, and name lookups for report DTOs. READ-ONLY except the audit
 * append (the domain's single sanctioned write). All queries run on the
 * caller's runAs() transaction so RLS applies. */
@Injectable()
export class ReportsRepository {
  /** Latest published KPI definitions for the org (canonical registry). */
  async listKpiDefinitions(tx: DbClient, orgId: string) {
    return tx.select().from(kpiDefinitions)
      .where(and(eq(kpiDefinitions.orgId, orgId), eq(kpiDefinitions.status, 'published')))
      .orderBy(kpiDefinitions.kpiKey);
  }

  /** Append an immutable usage event (append-only by RLS: no UPDATE/DELETE). */
  async appendAudit(tx: DbClient, row: {
    orgId: string; actorId: string; actorRole: string; action: string;
    view: string; filter: Record<string, unknown> | null; correlationId: string;
  }) {
    await tx.insert(reportAudit).values({
      orgId: row.orgId,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      view: row.view,
      filter: row.filter,
      correlationId: row.correlationId,
    });
  }

  /** Branch display names for report rows (in-scope only — RLS enforces). */
  async branchNames(tx: DbClient, orgId: string, branchIds: string[]) {
    if (branchIds.length === 0) return new Map<string, string>();
    const rows = await tx.select({ id: branches.id, name: branches.shortName })
      .from(branches)
      .where(and(eq(branches.orgId, orgId), inArray(branches.id, branchIds)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Doctor display names for the production table (in-scope only). */
  async doctorNames(tx: DbClient, orgId: string, doctorIds: string[]) {
    if (doctorIds.length === 0) return new Map<string, string>();
    const rows = await tx.select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(and(eq(staff.orgId, orgId), inArray(staff.id, doctorIds)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
