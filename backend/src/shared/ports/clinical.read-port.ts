import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';
import {
  encounters, treatmentPlans, treatmentPlanItems, treatmentCatalog, clinicalNotes, clinicalTimelineEvents,
} from '../../infrastructure/database/schema';

/**
 * ClinicalReadPort — sanctioned CROSS-MODULE read boundary for the clinical
 * domain (Sprint 3 S3-G). Lives in shared so other modules (future Finance,
 * patient 360, reports) can depend on it without violating module-infra
 * boundaries. READ-ONLY: no inserts/updates/deletes. The caller supplies the
 * runAs() transaction so RLS applies.
 *
 * Future Finance consumes treatment references (plan ids / treatment ids)
 * through this port — Clinical never owns financial records (ADR-004).
 */
@Injectable()
export class ClinicalReadPort {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  private requireDb(): Database {
    if (!this.db) throw new Error('Database not configured');
    return this.db;
  }

  /** Encounter by id (org-scoped; RLS applies through the caller's tx). */
  async getEncounterById(tx: DbClient, orgId: string, id: string) {
    const rows = await tx.select().from(encounters)
      .where(and(eq(encounters.orgId, orgId), eq(encounters.id, id), isNull(encounters.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Treatment plan by id — future Finance treatment-cost linkage reads this. */
  async getPlanById(tx: DbClient, orgId: string, id: string) {
    const rows = await tx.select().from(treatmentPlans)
      .where(and(eq(treatmentPlans.orgId, orgId), eq(treatmentPlans.id, id), isNull(treatmentPlans.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active/completed plans for a patient (patient 360 / future Finance). */
  async listPlansForPatient(tx: DbClient, orgId: string, patientId: string) {
    return tx.select().from(treatmentPlans)
      .where(and(eq(treatmentPlans.orgId, orgId), eq(treatmentPlans.patientId, patientId), isNull(treatmentPlans.deletedAt)))
      .orderBy(desc(treatmentPlans.createdAt));
  }

  /** Signed clinical note count for a patient (patient 360 summary). */
  async countSignedNotes(tx: DbClient, orgId: string, patientId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(clinicalNotes)
      .where(and(
        eq(clinicalNotes.orgId, orgId), eq(clinicalNotes.patientId, patientId),
        sql`${clinicalNotes.signedAt} IS NOT NULL`,
      ));
    return rows[0]?.n ?? 0;
  }

  /** Encounter count for a patient (patient 360 summary). */
  async countEncounters(tx: DbClient, orgId: string, patientId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(encounters)
      .where(and(eq(encounters.orgId, orgId), eq(encounters.patientId, patientId), isNull(encounters.deletedAt)));
    return rows[0]?.n ?? 0;
  }

  /** Clinical timeline feed for patient 360 (derived, append-only). */
  async listTimeline(tx: DbClient, orgId: string, patientId: string, limit = 50) {
    return tx.select().from(clinicalTimelineEvents)
      .where(and(eq(clinicalTimelineEvents.orgId, orgId), eq(clinicalTimelineEvents.patientId, patientId)))
      .orderBy(desc(clinicalTimelineEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }

  /* ---------------- S9 (Reports) — additive aggregate reads ---------------- */

  /** S9: treatment mix by catalog category over a range (Q3: clinical-owned
   * FK-clean source — treatment_plan_items ⋈ treatment_catalog, branch via
   * parent treatment_plans). Excludes soft-deleted plans/items. */
  async treatmentMix(
    tx: DbClient, orgId: string, branchId: string | null, from: string, to: string,
  ): Promise<Array<{ category: string; count: number }>> {
    const conds = [
      eq(treatmentPlans.orgId, orgId),
      isNull(treatmentPlans.deletedAt),
      isNull(treatmentPlanItems.deletedAt),
      sql`${treatmentPlans.createdAt}::date >= ${from}`,
      sql`${treatmentPlans.createdAt}::date <= ${to}`,
    ];
    if (branchId) conds.push(eq(treatmentPlans.branchId, branchId));
    const rows = await tx
      .select({ category: treatmentCatalog.category, count: sql<number>`count(*)::int` })
      .from(treatmentPlanItems)
      .innerJoin(treatmentPlans, eq(treatmentPlanItems.planId, treatmentPlans.id))
      .innerJoin(treatmentCatalog, eq(treatmentPlanItems.treatmentId, treatmentCatalog.id))
      .where(and(...conds))
      .groupBy(treatmentCatalog.category)
      .orderBy(treatmentCatalog.category);
    return rows.map((r) => ({ category: r.category, count: r.count }));
  }
}
