import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import {
  encounters, Encounter, clinicalNotes, ClinicalNote,
  treatmentPlans, TreatmentPlan, treatmentPlanItems, TreatmentPlanItem,
  treatmentSessions, TreatmentSession, toothRecords, ToothRecord,
  treatmentCatalog, TreatmentCatalogEntry,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { PlanStatus } from '../domain/plan-lifecycle';
import { EncounterStatus } from '../domain/encounter-status';

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
    return tx.select().from(encounters).where(and(...conds))
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
    const rows = await tx.execute(sql`
      UPDATE clinical_notes
      SET signed_at = now(), signed_by = ${signedBy}
      WHERE org_id = ${orgId} AND id = ${id} AND signed_at IS NULL
      RETURNING *`);
    const list = (rows as unknown as { rows: ClinicalNote[] }).rows;
    return list[0] ?? null;
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
  }): Promise<ToothRecord> {
    try {
      const rows = await tx.insert(toothRecords).values({
        orgId, branchId: input.branchId, patientId: input.patientId,
        encounterId: input.encounterId, doctorId: input.doctorId,
        fdiNo: input.fdiNo, condition: input.condition,
        surfaces: input.surfaces as string | null, notes: input.notes,
        createdBy: input.createdBy, updatedBy: input.createdBy,
      }).onConflictDoUpdate({
        target: [toothRecords.encounterId, toothRecords.fdiNo],
        set: {
          condition: input.condition, surfaces: input.surfaces as string | null,
          notes: input.notes, updatedAt: new Date(), updatedBy: input.createdBy,
          deletedAt: null,
        },
      }).returning();
      return rows[0]!;
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
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(treatmentPlanItems)
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
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(treatmentSessions)
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

  async setCatalogActive(tx: DbClient, orgId: string, id: string, active: boolean, staffId: string): Promise<TreatmentCatalogEntry | null> {
    const rows = await tx.update(treatmentCatalog).set({
      isActive: active, updatedAt: new Date(), updatedBy: staffId,
    }).where(and(eq(treatmentCatalog.orgId, orgId), eq(treatmentCatalog.id, id), isNull(treatmentCatalog.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
