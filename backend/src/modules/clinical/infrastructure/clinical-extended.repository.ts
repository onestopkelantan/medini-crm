import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import {
  consentTemplates, ConsentTemplate, consentRecords, ConsentRecord,
  imagingRecords, ImagingRecord, prescriptions, Prescription,
  adverseEvents, AdverseEvent, referrals, Referral,
  clinicalTimelineEvents, ClinicalTimelineEvent,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
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
    title: string; body: string; version: number; createdBy: string;
  }): Promise<ConsentTemplate> {
    try {
      const rows = await tx.insert(consentTemplates).values({
        orgId, title: input.title, body: input.body, version: input.version,
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

  async listTemplates(tx: DbClient, orgId: string, activeOnly: boolean): Promise<ConsentTemplate[]> {
    const conds = [eq(consentTemplates.orgId, orgId)];
    if (activeOnly) conds.push(eq(consentTemplates.isActive, true));
    return tx.select().from(consentTemplates).where(and(...conds))
      .orderBy(consentTemplates.title, desc(consentTemplates.version));
  }

  async latestTemplateVersion(tx: DbClient, orgId: string, title: string): Promise<number> {
    const rows = await tx.select({ v: sql<number>`coalesce(max(version), 0)::int` })
      .from(consentTemplates)
      .where(and(eq(consentTemplates.orgId, orgId), sql`lower(${consentTemplates.title}) = lower(${title})`));
    return rows[0]?.v ?? 0;
  }

  async setTemplateActive(tx: DbClient, orgId: string, id: string, active: boolean): Promise<ConsentTemplate | null> {
    const rows = await tx.update(consentTemplates).set({ isActive: active })
      .where(and(eq(consentTemplates.orgId, orgId), eq(consentTemplates.id, id))).returning();
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
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(consentRecords)
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
    return tx.select().from(prescriptions).where(and(...conds))
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
    return tx.select().from(adverseEvents).where(and(...conds))
      .orderBy(desc(adverseEvents.reportedAt)).limit(100);
  }

  async countSevereAdverseEvents(tx: DbClient, orgId: string, patientId: string): Promise<number> {
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(adverseEvents)
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
    return tx.select().from(referrals).where(and(...conds))
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
