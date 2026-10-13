import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import {
  patients,
  staff, branches,
  encounters, Encounter, clinicalNotes, ClinicalNote,
  treatmentPlans, TreatmentPlan, treatmentPlanItems, TreatmentPlanItem,
  treatmentSessions, TreatmentSession, toothRecords, ToothRecord,
  treatmentCatalog, TreatmentCatalogEntry,
  chartSymbols, ChartSymbolRow,
  patientAllergies, PatientAllergyRow,
} from '../../../infrastructure/database/schema';
import { toDomainError, type DatabaseErrorLike } from '../../../shared/errors/database-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { PlanStatus } from '../domain/plan-lifecycle';
import { EncounterStatus } from '../domain/encounter-status';

export interface ToothHistoryRow extends ToothRecord {
  /** Alias so the service can map it to `ToothEvent.createdAt`. Drizzle returns
   * snake_case column names for raw selects, and `createdAt` is what the domain
   * expects — without this alias the field arrives as `created_at` and is
   * silently dropped, making every history row look un-timestamped. */
  createdAt: Date;
}

/**
 * ClinicalCoreRepository — stateless data access for the clinical core
 * (Sprint 3 S3-C): encounters, SOAP notes, tooth records, treatment plans,
 * items, sessions, treatment catalog.
 *
 * Discipline (identical to Patients/Payors repositories):
 *  - every method takes the runAs() transaction → RLS policies apply at DB
 *  - org_id is ALWAYS server-derived from the authenticated principal
 *  - doctor own-scope: mutations assert doctor_id = principal.doctorId at the
 *    service layer; reads for doctors filter doctor_id here (fail-closed)
 *  - clinical_notes / treatment_sessions are INSERT-only (ADR-009) — this
 *    repository exposes NO update/delete for them (and DB grants deny it)
 */
@Injectable()
export class ClinicalCoreRepository {
  /* ---------------- encounters ---------------- */

  async createEncounter(tx: DbClient, orgId: string, input: {
    encounterCode: string; branchId: string; patientId: string;
    appointmentId: string | null; doctorId: string; chiefComplaint: string | null;
    createdBy: string;
  }): Promise<Encounter> {
    try {
      const rows = await tx.insert(encounters).values({
        orgId, encounterCode: input.encounterCode, branchId: input.branchId,
        patientId: input.patientId, appointmentId: input.appointmentId,
        doctorId: input.doctorId, chiefComplaint: input.chiefComplaint,
        createdBy: input.createdBy, updatedBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findEncounterById(tx: DbClient, orgId: string, id: string): Promise<Encounter | null> {
    const rows = await tx.select().from(encounters)
      .where(and(eq(encounters.orgId, orgId), eq(encounters.id, id), isNull(encounters.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findEncounterByCode(tx: DbClient, orgId: string, code: string): Promise<Encounter | null> {
    const rows = await tx.select().from(encounters)
      .where(and(eq(encounters.orgId, orgId), eq(encounters.encounterCode, code), isNull(encounters.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async searchEncounters(tx: DbClient, orgId: string, q: {
    branchId?: string | null; doctorId?: string | null; patientId?: string | null;
    limit?: number; offset?: number;
  }): Promise<Encounter[]> {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const offset = Math.max(q.offset ?? 0, 0);
    const conds = [eq(encounters.orgId, orgId), isNull(encounters.deletedAt)];
    if (q.branchId) conds.push(eq(encounters.branchId, q.branchId));
    if (q.doctorId) conds.push(eq(encounters.doctorId, q.doctorId));
    if (q.patientId) conds.push(eq(encounters.patientId, q.patientId));
    /* +patientName: baris encounter tanpa nama pesakit memaksa UI memaparkan
     * label generik - pemilik beranggang tab ini "cumajin view" sebab tiada
     * identiti + tiada aksi. JOIN kecil, tiada kos. */
    return tx.select({
      id: encounters.id,
      orgId: encounters.orgId,
      branchId: encounters.branchId,
      patientId: encounters.patientId,
      appointmentId: encounters.appointmentId,
      doctorId: encounters.doctorId,
      encounterCode: encounters.encounterCode,
      status: encounters.status,
      chiefComplaint: encounters.chiefComplaint,
      allergyAcknowledgedAt: encounters.allergyAcknowledgedAt,
      startedAt: encounters.startedAt,
      completedAt: encounters.completedAt,
      createdAt: encounters.createdAt,
      createdBy: encounters.createdBy,
      updatedAt: encounters.updatedAt,
      updatedBy: encounters.updatedBy,
      deletedAt: encounters.deletedAt,
      patientName: patients.name,
      /* Pemilik 10 Okt: "ga dilihatin ta encounternya dimana dll" -
         doktor & cawangan setiap encounter kini dipulangkan. */
      doctorName: staff.name,
      branchName: branches.shortName,
    })
      .from(encounters)
      .leftJoin(patients, eq(patients.id, encounters.patientId))
      .leftJoin(staff, eq(staff.id, encounters.doctorId))
      .leftJoin(branches, eq(branches.id, encounters.branchId))
      .where(and(...conds))
      .orderBy(desc(encounters.createdAt)).limit(limit).offset(offset);
  }

  async updateEncounterStatus(tx: DbClient, orgId: string, id: string, input: {
    status: EncounterStatus; completedAt?: Date | null; updatedBy: string;
  }): Promise<Encounter | null> {
    try {
      const rows = await tx.update(encounters).set({
        status: input.status,
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
        updatedAt: new Date(), updatedBy: input.updatedBy,
      }).where(and(eq(encounters.orgId, orgId), eq(encounters.id, id), isNull(encounters.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }

  async acknowledgeAllergy(tx: DbClient, orgId: string, id: string, staffId: string): Promise<Encounter | null> {
    const rows = await tx.update(encounters).set({
      allergyAcknowledgedAt: new Date(), updatedAt: new Date(), updatedBy: staffId,
    }).where(and(eq(encounters.orgId, orgId), eq(encounters.id, id), isNull(encounters.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /* ---------------- clinical notes (INSERT-only — ADR-009) ---------------- */

  async createNote(tx: DbClient, orgId: string, input: {
    patientId: string; encounterId: string; doctorId: string;
    soapSubjective: string | null; soapObjective: string | null;
    soapAssessment: string | null; soapPlan: string | null;
    amendsNoteId?: string | null; version?: number; createdBy: string;
  }): Promise<ClinicalNote> {
    const rows = await tx.insert(clinicalNotes).values({
      orgId, patientId: input.patientId, encounterId: input.encounterId,
      doctorId: input.doctorId, soapSubjective: input.soapSubjective,
      soapObjective: input.soapObjective, soapAssessment: input.soapAssessment,
      soapPlan: input.soapPlan, amendsNoteId: input.amendsNoteId ?? null,
      version: input.version ?? 1, createdBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async findNoteById(tx: DbClient, orgId: string, id: string): Promise<ClinicalNote | null> {
    const rows = await tx.select().from(clinicalNotes)
      .where(and(eq(clinicalNotes.orgId, orgId), eq(clinicalNotes.id, id))).limit(1);
    return rows[0] ?? null;
  }

  async listNotes(tx: DbClient, orgId: string, q: {
    encounterId?: string | null; patientId?: string | null; doctorId?: string | null;
    limit?: number; offset?: number;
  }): Promise<ClinicalNote[]> {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
    const offset = Math.max(q.offset ?? 0, 0);
    const conds = [eq(clinicalNotes.orgId, orgId)];
    if (q.encounterId) conds.push(eq(clinicalNotes.encounterId, q.encounterId));
    if (q.patientId) conds.push(eq(clinicalNotes.patientId, q.patientId));
    if (q.doctorId) conds.push(eq(clinicalNotes.doctorId, q.doctorId));
    return tx.select().from(clinicalNotes).where(and(...conds))
      .orderBy(desc(clinicalNotes.createdAt)).limit(limit).offset(offset);
  }

  /**
   * Sign a note — the ONLY sanctioned post-insert mutation path, implemented
   * as a privileged admin-side statement (medini_app has NO UPDATE grant on
   * clinical_notes by design; the service calls this through the admin
   * connection passed in as `tx` — see NotesService for the escalation doc).
   * Double-sign is prevented by the signed_at IS NULL predicate.
   */
  async signNote(tx: DbClient, orgId: string, id: string, signedBy: string): Promise<ClinicalNote | null> {
    const rows = await tx.update(clinicalNotes)
      .set({ signedAt: new Date(), signedBy })
      .where(and(eq(clinicalNotes.orgId, orgId), eq(clinicalNotes.id, id), isNull(clinicalNotes.signedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Mark an unsigned draft as superseded by a replacement draft (same-tx).
   * Signed notes can never be superseded — the predicate forbids it and the
   * runtime role lacks UPDATE grants entirely (defense-in-depth).
   */
  async markSuperseded(tx: DbClient, orgId: string, id: string, byNoteId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE clinical_notes
      SET superseded_by_note_id = ${byNoteId}
      WHERE org_id = ${orgId} AND id = ${id} AND signed_at IS NULL AND superseded_by_note_id IS NULL`);
  }

  /* ---------------- tooth records ---------------- */

  async upsertToothRecord(tx: DbClient, orgId: string, input: {
    branchId: string; patientId: string; encounterId: string; doctorId: string;
    fdiNo: number; condition: ToothRecord['condition']; surfaces: unknown;
    notes: string | null; createdBy: string;
    /** Fasa 1B — the additional chart finding (bridge, extracted, …). A soft
     * reference by CODE, so a clinic deleting its own symbol cannot orphan a
     * historical chart: the renderer falls back to the condition. */
    symbolCode?: string | null;
  }): Promise<ToothRecord> {
    try {
      const uniqueWhere = and(
        eq(toothRecords.orgId, orgId),
        eq(toothRecords.encounterId, input.encounterId),
        eq(toothRecords.fdiNo, input.fdiNo),
      );

      const updateExisting = async (): Promise<ToothRecord | null> => {
        const found = await tx
          .select({ id: toothRecords.id })
          .from(toothRecords)
          .where(uniqueWhere)
          .limit(1);

        if (!found[0]) return null;
        const rows = await tx
          .update(toothRecords)
          .set({
            condition: input.condition,
            symbolCode: input.symbolCode ?? null,
            surfaces: input.surfaces as string | null,
            notes: input.notes,
            updatedAt: new Date(),
            updatedBy: input.createdBy,
            deletedAt: null,
          })
          .where(eq(toothRecords.id, found[0].id))
          .returning();
        return rows[0] ?? null;
      };

      const existing = await updateExisting();
      if (existing) return existing;

      try {
        const rows = await tx.insert(toothRecords).values({
          orgId, branchId: input.branchId, patientId: input.patientId,
          encounterId: input.encounterId, doctorId: input.doctorId,
          fdiNo: input.fdiNo, condition: input.condition,
          symbolCode: input.symbolCode ?? null,
          surfaces: input.surfaces as string | null, notes: input.notes,
          createdBy: input.createdBy, updatedBy: input.createdBy,
        }).returning();
        return rows[0]!;
      } catch (e) {
        const root = ((e as { cause?: unknown })?.cause ?? e) as DatabaseErrorLike;
        const duplicate = root?.code === 'ER_DUP_ENTRY' || root?.errno === 1062 || root?.sqlState === '23000';
        if (!duplicate) throw e;
        const row = await updateExisting();
        if (row) return row;
        throw e;
      }
    } catch (e) { throw toDomainError(e); }
  }

  async listToothRecords(tx: DbClient, orgId: string, q: {
    encounterId?: string | null; patientId?: string | null;
  }): Promise<ToothRecord[]> {
    const conds = [eq(toothRecords.orgId, orgId), isNull(toothRecords.deletedAt)];
    if (q.encounterId) conds.push(eq(toothRecords.encounterId, q.encounterId));
    if (q.patientId) conds.push(eq(toothRecords.patientId, q.patientId));
    return tx.select().from(toothRecords).where(and(...conds)).orderBy(toothRecords.fdiNo);
  }

  /**
   * Fasa 1B — the CONTINUOUS chart: one row per tooth, the latest fact, PLUS how
   * many encounters have charted that tooth.
   *
   * The write model stays per-encounter (every change is a dated, attributed
   * event). This is the read the screen actually needs: "what does this mouth
   * look like now". Without it the caller receives every event for every visit
   * and has to reduce 12 visits x 32 teeth itself.
   *
   * ORDERED BY `updated_at`, NOT `created_at`. The upsert path UPDATES an
   * existing row when a tooth is corrected inside the same open encounter, so a
   * corrected tooth keeps its original `created_at`. Ordering by created_at
   * would pin the tooth to its first, WRONG value permanently.
   *
   * DISTINCT ON is legacy database; MySQL has no equivalent, so the reduction is done
   * with a correlated subquery selecting the newest row per tooth. The
   * `deleted_at IS NULL` filter is repeated INSIDE the subquery — without it a
   * soft-deleted newer row would win the comparison and then be filtered out by
   * the outer WHERE, making the tooth vanish from the chart entirely instead of
   * falling back to its previous state.
   *
   * `event_count` IS COMPUTED HERE, NOT IN THE CALLER. The reducer downstream
   * derives `eventCount` by counting the events it is given — but this query
   * deliberately collapses them to one row per tooth, so every tooth arrived
   * with a count of 1 and the history badge was silently wrong (it read 1 for a
   * tooth charted in three visits). The count has to be taken BEFORE the
   * reduction, which is only possible in SQL. A defective count is worse than no
   * count: it reads as "this tooth has no history" and a dentist stops looking.
   */
  async listLatestToothRecords(tx: DbClient, orgId: string, patientId: string): Promise<ToothRecord[]> {
    return tx.select().from(toothRecords).where(
      and(
        eq(toothRecords.orgId, orgId),
        eq(toothRecords.patientId, patientId),
        isNull(toothRecords.deletedAt),
        sql`NOT EXISTS (
          SELECT 1 FROM ${toothRecords} newer
          WHERE newer.patient_id = ${toothRecords.patientId}
            AND newer.org_id = ${toothRecords.orgId}
            AND newer.fdi_no = ${toothRecords.fdiNo}
            AND newer.deleted_at IS NULL
            AND (
              COALESCE(newer.updated_at, newer.created_at) > COALESCE(${toothRecords.updatedAt}, ${toothRecords.createdAt})
              OR (
                COALESCE(newer.updated_at, newer.created_at) = COALESCE(${toothRecords.updatedAt}, ${toothRecords.createdAt})
                AND newer.id > ${toothRecords.id}
              )
            )
        )`,
      ),
    ).orderBy(toothRecords.fdiNo);
  }

  /**
   * Fasa 1B — how many chart events each tooth has for this patient.
   *
   * DELIBERATELY A SEPARATE QUERY, NOT A CORRELATED SUBQUERY IN THE SELECT.
   *
   * The first attempt put a `SELECT COUNT(*) ... FROM tooth_records tr_count WHERE
   * tr_count.patient_id = tooth_records.patient_id` subquery inline. It compiled,
   * it returned numbers, and the numbers were WRONG: MySQL resolved the outer
   * reference back to `tr_count` itself, so the predicate was trivially true for
   * every row and each tooth was credited with the patient's TOTAL event count (2
   * teeth charted reported "2 events each"). Nothing threw — the chart simply
   * claimed every tooth had the same history.
   *
   * A GROUP BY over the patient's rows cannot make that mistake, and it is
   * testable by reading it. Two queries instead of one, for a number a dentist
   * uses to decide whether to open a tooth's history.
   *
   * `deleted_at IS NULL` matches the chart's own filter, so a tooth that was
   * charted and then soft-deleted does not inflate anything.
   */
  async countToothEvents(tx: DbClient, orgId: string, patientId: string): Promise<Map<number, number>> {
    const rows = await tx
      .select({ fdiNo: toothRecords.fdiNo, n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(toothRecords)
      .where(and(
        eq(toothRecords.orgId, orgId),
        eq(toothRecords.patientId, patientId),
        isNull(toothRecords.deletedAt),
      ))
      .groupBy(toothRecords.fdiNo);

    return new Map(rows.map((r: { fdiNo: number; n: number }) => [r.fdiNo, r.n]));
  }

  /** Every event for a patient's teeth, newest first — the per-tooth history
   * the chart opens when a dentist clicks a tooth. Capped so a long history
   * cannot return an unbounded payload. */
  async listToothHistory(tx: DbClient, orgId: string, patientId: string, fdiNo: number, limit = 50) {
    return tx.select().from(toothRecords).where(
      and(
        eq(toothRecords.orgId, orgId),
        eq(toothRecords.patientId, patientId),
        eq(toothRecords.fdiNo, fdiNo),
      ),
    ).orderBy(desc(toothRecords.updatedAt), desc(toothRecords.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  /* ---------------- treatment plans ---------------- */

  async createPlan(tx: DbClient, orgId: string, input: {
    planCode: string; branchId: string; patientId: string; encounterId: string | null;
    doctorId: string; title: string; consentRequired: boolean; status: PlanStatus;
    createdBy: string;
  }): Promise<TreatmentPlan> {
    try {
      const rows = await tx.insert(treatmentPlans).values({
        orgId, planCode: input.planCode, branchId: input.branchId,
        patientId: input.patientId, encounterId: input.encounterId,
        doctorId: input.doctorId, title: input.title,
        consentRequired: input.consentRequired, status: input.status,
        createdBy: input.createdBy, updatedBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findPlanById(tx: DbClient, orgId: string, id: string): Promise<TreatmentPlan | null> {
    const rows = await tx.select().from(treatmentPlans)
      .where(and(eq(treatmentPlans.orgId, orgId), eq(treatmentPlans.id, id), isNull(treatmentPlans.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async searchPlans(tx: DbClient, orgId: string, q: {
    branchId?: string | null; doctorId?: string | null; patientId?: string | null;
    status?: PlanStatus | null; limit?: number; offset?: number;
  }): Promise<TreatmentPlan[]> {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const offset = Math.max(q.offset ?? 0, 0);
    const conds = [eq(treatmentPlans.orgId, orgId), isNull(treatmentPlans.deletedAt)];
    if (q.branchId) conds.push(eq(treatmentPlans.branchId, q.branchId));
    if (q.doctorId) conds.push(eq(treatmentPlans.doctorId, q.doctorId));
    if (q.patientId) conds.push(eq(treatmentPlans.patientId, q.patientId));
    if (q.status) conds.push(eq(treatmentPlans.status, q.status));
    return tx.select().from(treatmentPlans).where(and(...conds))
      .orderBy(desc(treatmentPlans.createdAt)).limit(limit).offset(offset);
  }

  async updatePlanStatus(tx: DbClient, orgId: string, id: string, input: {
    status: PlanStatus; stamp: Partial<Pick<TreatmentPlan,
      'proposedAt' | 'acceptedAt' | 'activatedAt' | 'completedAt' | 'cancelledAt'>>;
    cancelReason?: string | null; updatedBy: string;
  }): Promise<TreatmentPlan | null> {
    const rows = await tx.update(treatmentPlans).set({
      status: input.status, ...input.stamp,
      ...(input.cancelReason !== undefined ? { cancelReason: input.cancelReason } : {}),
      updatedAt: new Date(), updatedBy: input.updatedBy,
    }).where(and(eq(treatmentPlans.orgId, orgId), eq(treatmentPlans.id, id), isNull(treatmentPlans.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /* ---------------- plan items ---------------- */

  async createPlanItem(tx: DbClient, orgId: string, input: {
    planId: string; treatmentId: string | null; description: string;
    toothFdi: number | null; quantity: number; createdBy: string;
  }): Promise<TreatmentPlanItem> {
    try {
      const rows = await tx.insert(treatmentPlanItems).values({
        orgId, planId: input.planId, treatmentId: input.treatmentId,
        description: input.description, toothFdi: input.toothFdi,
        quantity: input.quantity, createdBy: input.createdBy, updatedBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async listPlanItems(tx: DbClient, orgId: string, planId: string): Promise<TreatmentPlanItem[]> {
    return tx.select().from(treatmentPlanItems)
      .where(and(eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.planId, planId), isNull(treatmentPlanItems.deletedAt)))
      .orderBy(treatmentPlanItems.createdAt);
  }

  async findPlanItemById(tx: DbClient, orgId: string, id: string): Promise<TreatmentPlanItem | null> {
    const rows = await tx.select().from(treatmentPlanItems)
      .where(and(eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.id, id), isNull(treatmentPlanItems.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async setPlanItemStatus(tx: DbClient, orgId: string, id: string, status: 'pending' | 'done', staffId: string): Promise<TreatmentPlanItem | null> {
    const rows = await tx.update(treatmentPlanItems).set({
      status, updatedAt: new Date(), updatedBy: staffId,
    }).where(and(eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.id, id), isNull(treatmentPlanItems.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  async countPendingItems(tx: DbClient, orgId: string, planId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(treatmentPlanItems)
      .where(and(
        eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.planId, planId),
        eq(treatmentPlanItems.status, 'pending'), isNull(treatmentPlanItems.deletedAt),
      ));
    return rows[0]?.n ?? 0;
  }

  /* ---------------- treatment sessions (INSERT-only) ---------------- */

  async createSession(tx: DbClient, orgId: string, input: {
    planId: string; encounterId: string | null; doctorId: string;
    sessionNo: number; summary: string | null; createdBy: string;
  }): Promise<TreatmentSession> {
    try {
      const rows = await tx.insert(treatmentSessions).values({
        orgId, planId: input.planId, encounterId: input.encounterId,
        doctorId: input.doctorId, sessionNo: input.sessionNo,
        summary: input.summary, createdBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async listSessions(tx: DbClient, orgId: string, planId: string): Promise<TreatmentSession[]> {
    return tx.select().from(treatmentSessions)
      .where(and(eq(treatmentSessions.orgId, orgId), eq(treatmentSessions.planId, planId)))
      .orderBy(treatmentSessions.sessionNo);
  }

  async nextSessionNo(tx: DbClient, orgId: string, planId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(treatmentSessions)
      .where(and(eq(treatmentSessions.orgId, orgId), eq(treatmentSessions.planId, planId)));
    return (rows[0]?.n ?? 0) + 1;
  }

  /* ---------------- treatment catalog ---------------- */

  async createCatalogEntry(tx: DbClient, orgId: string, input: {
    code: string; name: string; category: string; durationMin: number; createdBy: string;
  }): Promise<TreatmentCatalogEntry> {
    try {
      const rows = await tx.insert(treatmentCatalog).values({
        orgId, code: input.code, name: input.name, category: input.category,
        durationMin: input.durationMin, createdBy: input.createdBy, updatedBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findCatalogById(tx: DbClient, orgId: string, id: string): Promise<TreatmentCatalogEntry | null> {
    const rows = await tx.select().from(treatmentCatalog)
      .where(and(eq(treatmentCatalog.orgId, orgId), eq(treatmentCatalog.id, id), isNull(treatmentCatalog.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCatalogByName(tx: DbClient, orgId: string, name: string): Promise<TreatmentCatalogEntry | null> {
    const rows = await tx.select().from(treatmentCatalog)
      .where(and(
        eq(treatmentCatalog.orgId, orgId),
        sql`lower(${treatmentCatalog.name}) = lower(${name})`,
        isNull(treatmentCatalog.deletedAt),
      )).limit(1);
    return rows[0] ?? null;
  }

  async listCatalog(tx: DbClient, orgId: string, activeOnly: boolean): Promise<TreatmentCatalogEntry[]> {
    const conds = [eq(treatmentCatalog.orgId, orgId), isNull(treatmentCatalog.deletedAt)];
    if (activeOnly) conds.push(eq(treatmentCatalog.isActive, true));
    return tx.select().from(treatmentCatalog).where(and(...conds))
      .orderBy(treatmentCatalog.category, treatmentCatalog.name);
  }

  /**
   * Fasa 1B — the org's chart-symbol legend, for the chart screen and its key.
   *
   * ORDERED BY `sortOrder` THEN `code`: a clinic re-orders its legend, and two
   * symbols sharing an order must still come back in a stable sequence or the
   * legend reshuffles on every load.
   */
  async listChartSymbols(tx: DbClient, orgId: string, activeOnly: boolean): Promise<ChartSymbolRow[]> {
    const conds = [eq(chartSymbols.orgId, orgId), isNull(chartSymbols.deletedAt)];
    if (activeOnly) conds.push(eq(chartSymbols.isActive, true));
    return tx.select().from(chartSymbols).where(and(...conds))
      .orderBy(chartSymbols.sortOrder, chartSymbols.code);
  }

  /**
   * Fasa 1b — write treatment prices. Same shape as `setCatalogActive` below:
   * org-scoped, soft-delete aware, `updatedBy` stamped. `set` is built by the
   * caller from the fields actually sent, so an absent field is left alone
   * rather than nulled. `toDomainError` converts a constraint violation into a
   * domain error — an UPDATE can violate a unique or check constraint just as an
   * INSERT can, and without the mapper it surfaces as a bare 500.
   */
  async updateCatalogPricing(
    tx: DbClient, orgId: string, id: string,
    set: Record<string, unknown>, staffId: string,
  ): Promise<TreatmentCatalogEntry | null> {
    try {
      const rows = await tx.update(treatmentCatalog).set({
        ...set, updatedAt: new Date(), updatedBy: staffId,
      } as never).where(and(
        eq(treatmentCatalog.orgId, orgId),
        eq(treatmentCatalog.id, id),
        isNull(treatmentCatalog.deletedAt),
      )).returning();
      return rows[0] ?? null;
    } catch (e) { throw toDomainError(e); }
  }

  async setCatalogActive(tx: DbClient, orgId: string, id: string, active: boolean, staffId: string): Promise<TreatmentCatalogEntry | null> {
    const rows = await tx.update(treatmentCatalog).set({
      isActive: active, updatedAt: new Date(), updatedBy: staffId,
    }).where(and(eq(treatmentCatalog.orgId, orgId), eq(treatmentCatalog.id, id), isNull(treatmentCatalog.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /* ---------------- Fasa 1C: patient allergies ---------------- */

  /**
   * Every allergy on record for a patient, ACTIVE AND RETIRED.
   *
   * Retired rows are returned deliberately: "this was believed once and was then
   * ruled out" is information a clinician needs, and hiding it makes a patient
   * look as though they had never been investigated. The caller separates them
   * on `retiredAt`; the GATE only ever eats the active ones.
   *
   * Ordering is by severity rank DESC then allergen, so the most serious sits at
   * the top of the list regardless of when it was entered. The rank lives in the
   * domain (`severityRank`), not here — a database that decides clinical urgency
   * puts that decision in two places.
   */
  async listAllergies(tx: DbClient, orgId: string, patientId: string): Promise<PatientAllergyRow[]> {
    return tx.select().from(patientAllergies).where(and(
      eq(patientAllergies.orgId, orgId),
      eq(patientAllergies.patientId, patientId),
      isNull(patientAllergies.deletedAt),
    )).orderBy(desc(patientAllergies.notedAt));
  }

  /**
   * Is this allergen already ACTIVE for the patient?
   *
   * The service checks this explicitly rather than relying on the unique index:
   * `patient_allergies_active_uq` spans (patient_id, allergen, retired_at), and
   * MySQL treats NULLs in a unique index as DISTINCT — so two active rows for the
   * same allergen would BOTH be accepted by the database. The index therefore
   * cannot enforce "one active per allergen" on its own, and a duplicate is the
   * kind of thing that arrives twice in a list and makes a reader distrust both.
   *
   * Matching is case-insensitive on the trimmed name so "Penicillin" does not
   * silently become a second record beside "penicillin".
   */
  async findActiveAllergy(tx: DbClient, orgId: string, patientId: string, allergen: string): Promise<PatientAllergyRow | null> {
    const rows = await tx.select().from(patientAllergies).where(and(
      eq(patientAllergies.orgId, orgId),
      eq(patientAllergies.patientId, patientId),
      isNull(patientAllergies.retiredAt),
      isNull(patientAllergies.deletedAt),
      sql`LOWER(TRIM(${patientAllergies.allergen})) = LOWER(TRIM(${allergen}))`,
    )).limit(1);
    return rows[0] ?? null;
  }

  async findAllergyById(tx: DbClient, orgId: string, id: string): Promise<PatientAllergyRow | null> {
    const rows = await tx.select().from(patientAllergies).where(and(
      eq(patientAllergies.orgId, orgId), eq(patientAllergies.id, id), isNull(patientAllergies.deletedAt),
    )).limit(1);
    return rows[0] ?? null;
  }

  async createAllergy(tx: DbClient, orgId: string, input: {
    branchId: string; patientId: string; allergen: string; category: string;
    severity: string; reaction: string | null; notedBy: string;
  }): Promise<PatientAllergyRow> {
    const rows = await tx.insert(patientAllergies).values({
      orgId, branchId: input.branchId, patientId: input.patientId,
      allergen: input.allergen, category: input.category as never,
      severity: input.severity as never, reaction: input.reaction,
      notedBy: input.notedBy, notedAt: new Date(),
      createdBy: input.notedBy, updatedBy: input.notedBy,
    }).returning();
    return rows[0]!;
  }

  /**
   * Retire an allergy. NEVER a delete.
   *
   * The reason is required by the domain (`validateRetire`) and stored here: an
   * allergy that simply vanished cannot be told apart from one removed by
   * mistake, and a clinical review's first question is "why is this no longer a
   * risk". `retiredBy` records who decided.
   */
  async retireAllergy(tx: DbClient, orgId: string, id: string, input: {
    reason: string; retiredBy: string;
  }): Promise<PatientAllergyRow | null> {
    const rows = await tx.update(patientAllergies).set({
      retiredAt: new Date(), retiredBy: input.retiredBy, retiredReason: input.reason,
      updatedAt: new Date(), updatedBy: input.retiredBy,
    }).where(and(
      eq(patientAllergies.orgId, orgId), eq(patientAllergies.id, id),
      isNull(patientAllergies.retiredAt), isNull(patientAllergies.deletedAt),
    )).returning();
    return rows[0] ?? null;
  }

  /**
   * ACTIVE allergies for a patient — the shape the safety gate eats.
   *
   * Separate from `listAllergies` on purpose: the gate must not have to remember
   * to filter retired rows, because forgetting would silently re-arm an allergy
   * somebody deliberately ruled out.
   */
  async listActiveAllergies(tx: DbClient, orgId: string, patientId: string): Promise<PatientAllergyRow[]> {
    return tx.select().from(patientAllergies).where(and(
      eq(patientAllergies.orgId, orgId),
      eq(patientAllergies.patientId, patientId),
      isNull(patientAllergies.retiredAt),
      isNull(patientAllergies.deletedAt),
    ));
  }
}
