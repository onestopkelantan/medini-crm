import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import {
  patients,
  consentTemplates, ConsentTemplate, consentRecords, ConsentRecord,
  imagingRecords, ImagingRecord, prescriptions, Prescription,
  adverseEvents, AdverseEvent, referrals, Referral,
  clinicalTimelineEvents, ClinicalTimelineEvent,
  issuedForms, IssuedForm,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/database-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { ReferralStatus } from '../domain/referral-status';

/**
 * ClinicalExtendedRepository — consents, imaging (metadata only),
 * prescriptions, adverse events, referrals, clinical timeline (Sprint 3 S3-C).
 * Same discipline as ClinicalCoreRepository: runAs() tx everywhere,
 * server-derived org_id, INSERT-only for immutable tables (ADR-009).
 */
@Injectable()
export class ClinicalExtendedRepository {
  /* ---------------- consent templates (org-wide, versioned) ---------------- */

  async createTemplate(tx: DbClient, orgId: string, input: {
    title: string; body: string; version: number; createdBy: string; kind?: string;
  }): Promise<ConsentTemplate> {
    try {
      const rows = await tx.insert(consentTemplates).values({
        orgId, title: input.title, body: input.body, version: input.version,
        /* Defaults to 'consent' so every pre-1G caller keeps its meaning; the forms service
         * passes the family explicitly. */
        kind: (input.kind ?? 'consent') as 'consent',
        createdBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findTemplateById(tx: DbClient, orgId: string, id: string): Promise<ConsentTemplate | null> {
    const rows = await tx.select().from(consentTemplates)
      .where(and(eq(consentTemplates.orgId, orgId), eq(consentTemplates.id, id))).limit(1);
    return rows[0] ?? null;
  }

  async listTemplates(tx: DbClient, orgId: string, activeOnly: boolean, kind?: string): Promise<ConsentTemplate[]> {
    const conds = [eq(consentTemplates.orgId, orgId)];
    if (activeOnly) conds.push(eq(consentTemplates.isActive, true));
    /* `kind` narrows to one form family (Fasa 1G). Omitted means every family, which is
     * what the HQ template screen wants and what the consent screen must NOT get. */
    if (kind) conds.push(eq(consentTemplates.kind, kind as 'consent'));
    return tx.select().from(consentTemplates).where(and(...conds))
      .orderBy(consentTemplates.title, desc(consentTemplates.version));
  }

  /** Latest version WITHIN one family. Two families may share a title, so the kind has to
   * be part of the lookup or an MC would inherit the version number of a consent form
   * that happens to have the same name. */
  async latestTemplateVersion(tx: DbClient, orgId: string, title: string, kind: string): Promise<number> {
    const rows = await tx.select({ v: sql<number>`coalesce(max(version), 0)` })
      .from(consentTemplates)
      .where(and(
        eq(consentTemplates.orgId, orgId),
        eq(consentTemplates.kind, kind as 'consent'),
        sql`lower(${consentTemplates.title}) = lower(${title})`,
      ));
    return rows[0]?.v ?? 0;
  }

  async setTemplateActive(tx: DbClient, orgId: string, id: string, active: boolean): Promise<ConsentTemplate | null> {
    const rows = await tx.update(consentTemplates).set({ isActive: active })
      .where(and(eq(consentTemplates.orgId, orgId), eq(consentTemplates.id, id))).returning();
    return rows[0] ?? null;
  }

  /* ---------------- issued forms + serial counters (Fasa 1G) ---------------- */

  /**
   * The highest serial number already issued for (org, kind, BRANCH, year).
   *
   * WHY THE BRANCH IS IN THE LOOKUP
   *
   * `serial_no` carries the branch code (`MC-SETIATROPIKA-2026-00001`), so the sequence is
   * per-branch in the patient's eyes. An earlier version searched organisation-wide and the
   * first run produced this:
   *
   *     Gelang Patah         -> MC-GELANGPATAH-2026-00001
   *     Klinik Pergigian UDA -> MC-KLINIKPERGIGIANUDA-2026-00002   <-- not 00001
   *     Meor Ahmad           -> MC-MEORAHMAD-2026-00003            <-- not 00001
   *
   * Each branch's FIRST certificate carried a number borrowed from a different clinic, and
   * Setia Tropika's day-one sequence began at 00009. An auditor asking "where are numbers
   * 1 to 8?" would be shown certificates from other branches — a numbered gap in a medical
   * sequence is exactly what an audit exists to find, so the numbers must be explainable
   * from the branch that issued them.
   *
   * NOTE the uniqueness key is still (org, kind, YEAR, serial_no) — organisation-wide. That
   * is deliberate: it is the guarantee that forbids a duplicate serial anywhere in the
   * group, and it stays the authority if this per-branch read ever races. The two are not
   * in conflict: this read makes numbers SEQUENTIAL per branch; the unique key makes them
   * UNIQUE across the group.
   */
  async highestSerialFor(
    tx: DbClient, orgId: string, kind: string, year: number, branchId: string | null,
  ): Promise<number> {
    /* The serial ends in five digits (…-00042), so the numeric part is the last five
     * characters. `RIGHT(...,5)` keeps this a pure index scan on the existing
     * (org_id, kind, serial_year, serial_no) key instead of parsing the whole string. */
    const conds = [
      eq(issuedForms.orgId, orgId),
      eq(issuedForms.kind, kind as 'consent'),
      eq(issuedForms.serialYear, year),
    ];
    /* A NULL branch means an organisation-wide sequence (HQ has no branch), which is a
     * different sequence from any clinic's and must not be mixed with one. */
    if (branchId) conds.push(eq(issuedForms.branchId, branchId));

    const rows = await tx.select({
      n: sql<number>`COALESCE(MAX(CAST(RIGHT(${issuedForms.serialNo}, 5) AS UNSIGNED)), 0)`,
    })
      .from(issuedForms)
      .where(and(...conds));
    return Number(rows[0]?.n ?? 0);
  }

  async createIssuedForm(tx: DbClient, orgId: string, input: {
    branchId: string | null; kind: string; serialNo: string; serialYear: number;
    templateId: string; templateVersion: number;
    titleSnapshot: string; bodySnapshot: string;
    patientId: string | null; staffId: string | null; encounterId: string | null;
    subject: string | null; details: string | null;
    issuedBy: string | null; createdBy: string;
  }): Promise<IssuedForm> {
    try {
      const rows = await tx.insert(issuedForms).values({
        orgId, branchId: input.branchId, kind: input.kind as 'consent',
        serialNo: input.serialNo, serialYear: input.serialYear,
        templateId: input.templateId, templateVersion: input.templateVersion,
        titleSnapshot: input.titleSnapshot, bodySnapshot: input.bodySnapshot,
        patientId: input.patientId, staffId: input.staffId, encounterId: input.encounterId,
        subject: input.subject, details: input.details,
        issuedBy: input.issuedBy, createdBy: input.createdBy,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async listIssuedForms(tx: DbClient, orgId: string, f: {
    kind?: string | null; patientId?: string | null; staffId?: string | null;
    year?: number | null; limit?: number;
  }): Promise<IssuedForm[]> {
    /* No `deletedAt` filter: an issued form is evidence and is never soft-deleted. A form
     * that should not count is CANCELLED, which keeps the row and its serial number so a
     * gap in the sequence always means something. */
    const conds = [eq(issuedForms.orgId, orgId)];
    if (f.kind) conds.push(eq(issuedForms.kind, f.kind as 'consent'));
    if (f.patientId) conds.push(eq(issuedForms.patientId, f.patientId));
    if (f.staffId) conds.push(eq(issuedForms.staffId, f.staffId));
    if (f.year) conds.push(eq(issuedForms.serialYear, f.year));
    return tx.select().from(issuedForms).where(and(...conds))
      .orderBy(desc(issuedForms.issuedAt))
      .limit(f.limit ?? 200);
  }

  async findIssuedFormById(tx: DbClient, orgId: string, id: string): Promise<IssuedForm | null> {
    const rows = await tx.select().from(issuedForms)
      .where(and(eq(issuedForms.orgId, orgId), eq(issuedForms.id, id))).limit(1);
    return rows[0] ?? null;
  }

  /** Cancel — the row is KEPT and keeps its serial number. Deleting it would open a gap
   * that looks identical to a removed record, which is exactly what an auditor hunts for. */
  async cancelIssuedForm(tx: DbClient, orgId: string, id: string, reason: string): Promise<IssuedForm | null> {
    const rows = await tx.update(issuedForms)
      .set({ status: 'cancelled' as const, cancelReason: reason })
      .where(and(eq(issuedForms.orgId, orgId), eq(issuedForms.id, id))).returning();
    return rows[0] ?? null;
  }

  /* ---------------- consent records (INSERT-only — ADR-009) ---------------- */

  async createConsent(tx: DbClient, orgId: string, input: {
    patientId: string; templateId: string; templateVersion: number;
    encounterId: string | null; planId: string | null;
    method: ConsentRecord['method']; consentedBy: string;
    witnessedBy: string | null; recordedBy: string; notes: string | null; createdBy: string;
  }): Promise<ConsentRecord> {
    const rows = await tx.insert(consentRecords).values({
      orgId, patientId: input.patientId, templateId: input.templateId,
      templateVersion: input.templateVersion, encounterId: input.encounterId,
      planId: input.planId, method: input.method, consentedBy: input.consentedBy,
      witnessedBy: input.witnessedBy, recordedBy: input.recordedBy,
      notes: input.notes, createdBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async listConsents(tx: DbClient, orgId: string, q: {
    patientId?: string | null; planId?: string | null; recordedBy?: string | null;
  }): Promise<ConsentRecord[]> {
    const conds = [eq(consentRecords.orgId, orgId)];
    if (q.patientId) conds.push(eq(consentRecords.patientId, q.patientId));
    if (q.planId) conds.push(eq(consentRecords.planId, q.planId));
    if (q.recordedBy) conds.push(eq(consentRecords.recordedBy, q.recordedBy));
    return tx.select().from(consentRecords).where(and(...conds))
      .orderBy(desc(consentRecords.consentedAt)).limit(100);
  }

  async countConsentsForPlan(tx: DbClient, orgId: string, planId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(consentRecords)
      .where(and(eq(consentRecords.orgId, orgId), eq(consentRecords.planId, planId)));
    return rows[0]?.n ?? 0;
  }

  /* ---------------- imaging records (metadata ONLY) ---------------- */

  async createImaging(tx: DbClient, orgId: string, input: {
    branchId: string; patientId: string; encounterId: string | null;
    uploadedBy: string; kind: ImagingRecord['kind']; title: string;
    fileRef: string | null; takenAt: Date | null; notes: string | null; createdBy: string;
  }): Promise<ImagingRecord> {
    const rows = await tx.insert(imagingRecords).values({
      orgId, branchId: input.branchId, patientId: input.patientId,
      encounterId: input.encounterId, uploadedBy: input.uploadedBy,
      kind: input.kind, title: input.title, fileRef: input.fileRef,
      takenAt: input.takenAt, notes: input.notes,
      createdBy: input.createdBy, updatedBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async listImaging(tx: DbClient, orgId: string, q: {
    branchId?: string | null; patientId?: string | null; encounterId?: string | null;
    uploadedBy?: string | null; kind?: string | null;
  }): Promise<ImagingRecord[]> {
    const conds = [eq(imagingRecords.orgId, orgId), isNull(imagingRecords.deletedAt)];
    if (q.branchId) conds.push(eq(imagingRecords.branchId, q.branchId));
    if (q.patientId) conds.push(eq(imagingRecords.patientId, q.patientId));
    if (q.encounterId) conds.push(eq(imagingRecords.encounterId, q.encounterId));
    if (q.uploadedBy) conds.push(eq(imagingRecords.uploadedBy, q.uploadedBy));
    if (q.kind) conds.push(eq(imagingRecords.kind, q.kind as ImagingRecord['kind']));
    return tx.select().from(imagingRecords).where(and(...conds))
      .orderBy(desc(imagingRecords.createdAt)).limit(100);
  }

  /* ---------------- prescriptions ---------------- */

  async createPrescription(tx: DbClient, orgId: string, input: {
    branchId: string; patientId: string; encounterId: string | null; doctorId: string;
    medication: string; dosage: string | null; frequency: string | null;
    durationDays: number | null; notes: string | null; createdBy: string;
  }): Promise<Prescription> {
    const rows = await tx.insert(prescriptions).values({
      orgId, branchId: input.branchId, patientId: input.patientId,
      encounterId: input.encounterId, doctorId: input.doctorId,
      medication: input.medication, dosage: input.dosage, frequency: input.frequency,
      durationDays: input.durationDays, notes: input.notes,
      createdBy: input.createdBy, updatedBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async listPrescriptions(tx: DbClient, orgId: string, q: {
    branchId?: string | null; patientId?: string | null; doctorId?: string | null;
  }): Promise<Prescription[]> {
    const conds = [eq(prescriptions.orgId, orgId), isNull(prescriptions.deletedAt)];
    if (q.branchId) conds.push(eq(prescriptions.branchId, q.branchId));
    if (q.patientId) conds.push(eq(prescriptions.patientId, q.patientId));
    if (q.doctorId) conds.push(eq(prescriptions.doctorId, q.doctorId));
    /* +patientName: jadual preskripsi tanpa kolum pesakit tidak nyambung
     * (aduan pemilik). LEFT JOIN nama pesakit. */
    return tx.select({
      id: prescriptions.id,
      orgId: prescriptions.orgId,
      branchId: prescriptions.branchId,
      patientId: prescriptions.patientId,
      encounterId: prescriptions.encounterId,
      doctorId: prescriptions.doctorId,
      medication: prescriptions.medication,
      dosage: prescriptions.dosage,
      frequency: prescriptions.frequency,
      durationDays: prescriptions.durationDays,
      notes: prescriptions.notes,
      createdAt: prescriptions.createdAt,
      createdBy: prescriptions.createdBy,
      updatedAt: prescriptions.updatedAt,
      updatedBy: prescriptions.updatedBy,
      deletedAt: prescriptions.deletedAt,
      patientName: patients.name,
    })
      .from(prescriptions)
      .leftJoin(patients, eq(patients.id, prescriptions.patientId))
      .where(and(...conds))
      .orderBy(desc(prescriptions.createdAt)).limit(100);
  }

  /* ---------------- adverse events (INSERT-only — immutable) ---------------- */

  async createAdverseEvent(tx: DbClient, orgId: string, input: {
    patientId: string; encounterId: string | null; reportedBy: string;
    severity: AdverseEvent['severity']; description: string;
    actionTaken: string | null; createdBy: string;
  }): Promise<AdverseEvent> {
    const rows = await tx.insert(adverseEvents).values({
      orgId, patientId: input.patientId, encounterId: input.encounterId,
      reportedBy: input.reportedBy, severity: input.severity,
      description: input.description, actionTaken: input.actionTaken,
      createdBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async listAdverseEvents(tx: DbClient, orgId: string, q: {
    patientId?: string | null; reportedBy?: string | null;
  }): Promise<AdverseEvent[]> {
    const conds = [eq(adverseEvents.orgId, orgId)];
    if (q.patientId) conds.push(eq(adverseEvents.patientId, q.patientId));
    if (q.reportedBy) conds.push(eq(adverseEvents.reportedBy, q.reportedBy));
    /* +patientName: sama sebab seperti preskripsi - senarai tanpa pesakit
     * tidak menjawab "siapa yang mengalami apa". */
    return tx.select({
      id: adverseEvents.id,
      orgId: adverseEvents.orgId,
      patientId: adverseEvents.patientId,
      encounterId: adverseEvents.encounterId,
      reportedBy: adverseEvents.reportedBy,
      severity: adverseEvents.severity,
      description: adverseEvents.description,
      actionTaken: adverseEvents.actionTaken,
      reportedAt: adverseEvents.reportedAt,
      createdAt: adverseEvents.createdAt,
      createdBy: adverseEvents.createdBy,
      patientName: patients.name,
    })
      .from(adverseEvents)
      .leftJoin(patients, eq(patients.id, adverseEvents.patientId))
      .where(and(...conds))
      .orderBy(desc(adverseEvents.reportedAt)).limit(100);
  }

  async countSevereAdverseEvents(tx: DbClient, orgId: string, patientId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)` }).from(adverseEvents)
      .where(and(
        eq(adverseEvents.orgId, orgId), eq(adverseEvents.patientId, patientId),
        eq(adverseEvents.severity, 'severe'),
      ));
    return rows[0]?.n ?? 0;
  }

  /* ---------------- referrals ---------------- */

  async createReferral(tx: DbClient, orgId: string, input: {
    branchId: string; patientId: string; encounterId: string | null; doctorId: string;
    toSpecialty: string; toProvider: string | null; reason: string; createdBy: string;
  }): Promise<Referral> {
    const rows = await tx.insert(referrals).values({
      orgId, branchId: input.branchId, patientId: input.patientId,
      encounterId: input.encounterId, doctorId: input.doctorId,
      toSpecialty: input.toSpecialty, toProvider: input.toProvider,
      reason: input.reason, createdBy: input.createdBy, updatedBy: input.createdBy,
    }).returning();
    return rows[0]!;
  }

  async findReferralById(tx: DbClient, orgId: string, id: string): Promise<Referral | null> {
    const rows = await tx.select().from(referrals)
      .where(and(eq(referrals.orgId, orgId), eq(referrals.id, id), isNull(referrals.deletedAt))).limit(1);
    return rows[0] ?? null;
  }

  async listReferrals(tx: DbClient, orgId: string, q: {
    branchId?: string | null; patientId?: string | null; doctorId?: string | null;
  }): Promise<Referral[]> {
    const conds = [eq(referrals.orgId, orgId), isNull(referrals.deletedAt)];
    if (q.branchId) conds.push(eq(referrals.branchId, q.branchId));
    if (q.patientId) conds.push(eq(referrals.patientId, q.patientId));
    if (q.doctorId) conds.push(eq(referrals.doctorId, q.doctorId));
    return tx.select({
      id: referrals.id,
      orgId: referrals.orgId,
      branchId: referrals.branchId,
      patientId: referrals.patientId,
      encounterId: referrals.encounterId,
      doctorId: referrals.doctorId,
      toSpecialty: referrals.toSpecialty,
      toProvider: referrals.toProvider,
      reason: referrals.reason,
      status: referrals.status,
      sentAt: referrals.sentAt,
      acknowledgedAt: referrals.acknowledgedAt,
      createdAt: referrals.createdAt,
      createdBy: referrals.createdBy,
      updatedAt: referrals.updatedAt,
      updatedBy: referrals.updatedBy,
      deletedAt: referrals.deletedAt,
      patientName: patients.name,
    })
      .from(referrals)
      .leftJoin(patients, eq(patients.id, referrals.patientId))
      .where(and(...conds))
      .orderBy(desc(referrals.createdAt)).limit(100);
  }

  async updateReferralStatus(tx: DbClient, orgId: string, id: string, input: {
    status: ReferralStatus; sentAt?: Date | null; acknowledgedAt?: Date | null; updatedBy: string;
  }): Promise<Referral | null> {
    const rows = await tx.update(referrals).set({
      status: input.status,
      ...(input.sentAt !== undefined ? { sentAt: input.sentAt } : {}),
      ...(input.acknowledgedAt !== undefined ? { acknowledgedAt: input.acknowledgedAt } : {}),
      updatedAt: new Date(), updatedBy: input.updatedBy,
    }).where(and(eq(referrals.orgId, orgId), eq(referrals.id, id), isNull(referrals.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /* ---------------- clinical timeline (append-only derived feed) ---------------- */

  async appendTimeline(tx: DbClient, orgId: string, input: {
    patientId: string; type: string; summary: string;
    payload?: Record<string, unknown> | null;
    actorId: string | null; actorRole: string | null; correlationId: string | null;
  }): Promise<ClinicalTimelineEvent> {
    const rows = await tx.insert(clinicalTimelineEvents).values({
      orgId, patientId: input.patientId, type: input.type, summary: input.summary,
      payload: input.payload ?? null, actorId: input.actorId,
      actorRole: input.actorRole, correlationId: input.correlationId,
    }).returning();
    return rows[0]!;
  }

  async listTimeline(tx: DbClient, orgId: string, patientId: string, limit = 50): Promise<ClinicalTimelineEvent[]> {
    return tx.select().from(clinicalTimelineEvents)
      .where(and(eq(clinicalTimelineEvents.orgId, orgId), eq(clinicalTimelineEvents.patientId, patientId)))
      .orderBy(desc(clinicalTimelineEvents.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
  }
}
