import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import { ClinicalCoreRepository } from '../infrastructure/clinical-core.repository';
import { ClinicalExtendedRepository } from '../infrastructure/clinical-extended.repository';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { canTransitionReferral, ReferralStatus } from '../domain/referral-status';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import {
  TreatmentCatalogEntry, ConsentTemplate, ConsentRecord, ImagingRecord,
  Prescription, AdverseEvent, Referral,
} from '../../../infrastructure/database/schema';

const catalogCreateSchema = z.object({
  name: z.string().trim().min(2).max(256),
  category: z.string().trim().min(2).max(64),
  durationMin: z.number().int().positive().max(600).optional(),
});
const catalogActiveSchema = z.object({ isActive: z.boolean() });

const templateSchema = z.object({
  title: z.string().trim().min(2).max(256),
  body: z.string().trim().min(10).max(20000),
});
const templateActiveSchema = z.object({ isActive: z.boolean() });

const consentSchema = z.object({
  patientId: z.string().uuid(),
  templateId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  planId: z.string().uuid().nullish(),
  method: z.enum(['verbal', 'written', 'electronic']),
  consentedBy: z.string().trim().min(2).max(256),
  witnessedBy: z.string().uuid().nullish(),
  notes: z.string().trim().max(1024).nullish(),
});

const imagingSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  kind: z.enum(['xray', 'cbct', 'opg', 'photo', 'before_after', 'consent', 'document']),
  title: z.string().trim().min(2).max(256),
  fileRef: z.string().trim().max(512).nullish(),
  takenAt: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().trim().max(512).nullish(),
});

const prescriptionSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  medication: z.string().trim().min(2).max(256),
  dosage: z.string().trim().max(128).nullish(),
  frequency: z.string().trim().max(128).nullish(),
  durationDays: z.number().int().positive().max(365).nullish(),
  notes: z.string().trim().max(512).nullish(),
});

const adverseSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  severity: z.enum(['mild', 'moderate', 'severe']),
  description: z.string().trim().min(2).max(8000),
  actionTaken: z.string().trim().max(8000).nullish(),
});

const referralCreateSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  toSpecialty: z.string().trim().min(2).max(128),
  toProvider: z.string().trim().max(256).nullish(),
  reason: z.string().trim().min(2).max(8000),
});
const referralStatusSchema = z.object({
  status: z.enum(['pending', 'sent', 'acknowledged', 'completed']),
});

/**
 * ClinicalExtendedService — catalog, consents, imaging (metadata only),
 * prescriptions, adverse events, referrals (Sprint 3 S3-C/D).
 *
 * Write ownership: catalog + consent templates = HQ (org-wide master data);
 * everything clinical-record = doctor own-scope (strict). Reads follow the
 * matrix (hq all / bm branch / doctor own) with RLS as the DB backstop.
 */
@Injectable()
export class ClinicalExtendedService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly core: ClinicalCoreRepository,
    private readonly ext: ClinicalExtendedRepository,
    private readonly patients: PatientsReadPort,
    private readonly audit: AuditService,
  ) {}

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }

  private assertHq(p: Principal): void {
    if (p.role !== 'hq') throw new ForbiddenError('Only HQ can manage clinical master data');
  }

  private assertDoctor(p: Principal): asserts p is Principal & { doctorId: string; branchId: string } {
    if (p.role !== 'doctor' || !p.doctorId || !p.branchId) {
      throw new ForbiddenError('Only doctors can create or modify clinical records');
    }
  }

  private async patientInBranch(
    tx: Parameters<Parameters<DbContextService['runAs']>[1]>[0],
    p: Principal & { branchId: string }, patientId: string,
  ) {
    const patient = await this.patients.getPatientById(tx, p.orgId, patientId);
    if (!patient) throw new NotFoundError('Patient', patientId);
    if (patient.branchId !== p.branchId) throw new ForbiddenError('Patient belongs to a different branch');
    return patient;
  }

  /* ---------------- treatment catalog (HQ write, all read) ---------------- */

  async createCatalogEntry(principal: Principal, raw: unknown): Promise<TreatmentCatalogEntry> {
    this.assertHq(principal);
    const parsed = catalogCreateSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const dup = await this.core.findCatalogByName(tx, principal.orgId, input.name);
      if (dup) throw new ConflictError('Treatment name already exists');
      const code = await new OrgAllocator(tx).nextTreatmentCode(principal.orgId);
      const entry = await this.core.createCatalogEntry(tx, principal.orgId, {
        code, name: input.name, category: input.category,
        durationMin: input.durationMin ?? 30, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'treatment_catalog_created', entity: 'treatment_catalog', entityId: entry.id,
        orgId: principal.orgId, branchId: null, source: 'api',
        after: { code: entry.code, name: entry.name, category: entry.category },
      }, tx);
      return entry;
    });
  }

  async listCatalog(principal: Principal, activeOnly: boolean): Promise<TreatmentCatalogEntry[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.core.listCatalog(tx, principal.orgId, activeOnly));
  }

  async setCatalogActive(principal: Principal, id: string, raw: unknown): Promise<TreatmentCatalogEntry> {
    this.assertHq(principal);
    const parsed = catalogActiveSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.core.findCatalogById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Treatment', id);
      if (before.isActive === parsed.data.isActive) return before; /* no-op */
      const updated = await this.core.setCatalogActive(tx, principal.orgId, id, parsed.data.isActive, principal.staffId);
      if (!updated) throw new NotFoundError('Treatment', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: parsed.data.isActive ? 'treatment_catalog_activated' : 'treatment_catalog_deactivated',
        entity: 'treatment_catalog', entityId: id,
        orgId: principal.orgId, branchId: null, source: 'api',
        before: { isActive: before.isActive }, after: { isActive: parsed.data.isActive },
      }, tx);
      return updated;
    });
  }

  /* ---------------- consent templates (HQ write) ---------------- */

  async createTemplate(principal: Principal, raw: unknown): Promise<ConsentTemplate> {
    this.assertHq(principal);
    const parsed = templateSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const version = (await this.ext.latestTemplateVersion(tx, principal.orgId, input.title)) + 1;
      const tpl = await this.ext.createTemplate(tx, principal.orgId, {
        title: input.title, body: input.body, version, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'consent_template_created', entity: 'consent_templates', entityId: tpl.id,
        orgId: principal.orgId, branchId: null, source: 'api',
        after: { title: tpl.title, version: tpl.version },
      }, tx);
      return tpl;
    });
  }

  async listTemplates(principal: Principal, activeOnly: boolean): Promise<ConsentTemplate[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.ext.listTemplates(tx, principal.orgId, activeOnly));
  }

  async setTemplateActive(principal: Principal, id: string, raw: unknown): Promise<ConsentTemplate> {
    this.assertHq(principal);
    const parsed = templateActiveSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.ext.findTemplateById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('ConsentTemplate', id);
      if (before.isActive === parsed.data.isActive) return before;
      const updated = await this.ext.setTemplateActive(tx, principal.orgId, id, parsed.data.isActive);
      if (!updated) throw new NotFoundError('ConsentTemplate', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: parsed.data.isActive ? 'consent_template_activated' : 'consent_template_deactivated',
        entity: 'consent_templates', entityId: id,
        orgId: principal.orgId, branchId: null, source: 'api',
        before: { isActive: before.isActive }, after: { isActive: parsed.data.isActive },
      }, tx);
      return updated;
    });
  }

  /* ---------------- consent records (doctor, immutable) ---------------- */

  async recordConsent(principal: Principal, raw: unknown): Promise<ConsentRecord> {
    this.assertDoctor(principal);
    const parsed = consentSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientInBranch(tx, principal, input.patientId);
      const tpl = await this.ext.findTemplateById(tx, principal.orgId, input.templateId);
      if (!tpl) throw new NotFoundError('ConsentTemplate', input.templateId);
      if (!tpl.isActive) throw new ConflictError('Consent template is not active');

      let planBranch: string | null = null;
      if (input.planId) {
        const plan = await this.core.findPlanById(tx, principal.orgId, input.planId);
        if (!plan || plan.doctorId !== principal.doctorId) throw new NotFoundError('TreatmentPlan', input.planId);
        planBranch = plan.branchId;
      }
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== principal.doctorId) throw new NotFoundError('Encounter', input.encounterId);
      }

      const rec = await this.ext.createConsent(tx, principal.orgId, {
        patientId: patient.id, templateId: tpl.id, templateVersion: tpl.version,
        encounterId: input.encounterId ?? null, planId: input.planId ?? null,
        method: input.method, consentedBy: input.consentedBy,
        witnessedBy: input.witnessedBy ?? null, recordedBy: principal.doctorId,
        notes: input.notes ?? null, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'consent_recorded', entity: 'consent_records', entityId: rec.id,
        orgId: principal.orgId, branchId: planBranch ?? patient.branchId, source: 'api',
        after: { patientId: patient.id, templateId: tpl.id, templateVersion: tpl.version, planId: input.planId ?? null },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: patient.id, type: 'consent_recorded',
        summary: `Consent recorded: ${tpl.title} v${tpl.version}`,
        payload: { consentId: rec.id, templateId: tpl.id, planId: input.planId ?? null },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return rec;
    });
  }

  async listConsents(principal: Principal, q: { patientId?: string; planId?: string }): Promise<ConsentRecord[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.ext.listConsents(tx, principal.orgId, {
      patientId: q.patientId ?? null, planId: q.planId ?? null,
      recordedBy: principal.role === 'doctor' ? principal.doctorId : null,
    }));
  }

  /* ---------------- imaging (metadata ONLY — no storage engine) ---------------- */

  async createImaging(principal: Principal, raw: unknown): Promise<ImagingRecord> {
    this.assertDoctor(principal);
    const parsed = imagingSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientInBranch(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== principal.doctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const rec = await this.ext.createImaging(tx, principal.orgId, {
        branchId: patient.branchId, patientId: patient.id,
        encounterId: input.encounterId ?? null, uploadedBy: principal.doctorId,
        kind: input.kind, title: input.title, fileRef: input.fileRef ?? null,
        takenAt: input.takenAt ? new Date(input.takenAt) : null,
        notes: input.notes ?? null, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'imaging_recorded', entity: 'imaging_records', entityId: rec.id,
        orgId: principal.orgId, branchId: patient.branchId, source: 'api',
        after: { patientId: patient.id, kind: rec.kind, title: rec.title },
      }, tx);
      return rec;
    });
  }

  async listImaging(principal: Principal, q: {
    patientId?: string; encounterId?: string; kind?: string;
  }): Promise<ImagingRecord[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.ext.listImaging(tx, principal.orgId, {
      branchId: principal.role === 'hq' ? null : principal.branchId,
      patientId: q.patientId ?? null, encounterId: q.encounterId ?? null,
      uploadedBy: principal.role === 'doctor' ? principal.doctorId : null,
      kind: q.kind ?? null,
    }));
  }

  /* ---------------- prescriptions (doctor own) ---------------- */

  async createPrescription(principal: Principal, raw: unknown): Promise<Prescription> {
    this.assertDoctor(principal);
    const parsed = prescriptionSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientInBranch(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== principal.doctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const rx = await this.ext.createPrescription(tx, principal.orgId, {
        branchId: patient.branchId, patientId: patient.id,
        encounterId: input.encounterId ?? null, doctorId: principal.doctorId,
        medication: input.medication, dosage: input.dosage ?? null,
        frequency: input.frequency ?? null, durationDays: input.durationDays ?? null,
        notes: input.notes ?? null, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'prescription_created', entity: 'prescriptions', entityId: rx.id,
        orgId: principal.orgId, branchId: patient.branchId, source: 'api',
        after: { patientId: patient.id, medication: rx.medication },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: patient.id, type: 'prescription_created',
        summary: `Prescription: ${rx.medication}`,
        payload: { prescriptionId: rx.id },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return rx;
    });
  }

  async listPrescriptions(principal: Principal, q: { patientId?: string }): Promise<Prescription[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.ext.listPrescriptions(tx, principal.orgId, {
      branchId: principal.role === 'hq' ? null : principal.branchId,
      patientId: q.patientId ?? null,
      doctorId: principal.role === 'doctor' ? principal.doctorId : null,
    }));
  }

  /* ---------------- adverse events (doctor, immutable) ---------------- */

  async reportAdverseEvent(principal: Principal, raw: unknown): Promise<AdverseEvent> {
    this.assertDoctor(principal);
    const parsed = adverseSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientInBranch(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== principal.doctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const ev = await this.ext.createAdverseEvent(tx, principal.orgId, {
        patientId: patient.id, encounterId: input.encounterId ?? null,
        reportedBy: principal.doctorId, severity: input.severity,
        description: input.description, actionTaken: input.actionTaken ?? null,
        createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'adverse_event_reported', entity: 'adverse_events', entityId: ev.id,
        orgId: principal.orgId, branchId: patient.branchId, source: 'api',
        after: { patientId: patient.id, severity: ev.severity },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: patient.id, type: 'adverse_event_reported',
        summary: `Adverse event (${ev.severity}) reported`,
        payload: { adverseEventId: ev.id, severity: ev.severity },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return ev;
    });
  }

  async listAdverseEvents(principal: Principal, q: { patientId?: string }): Promise<AdverseEvent[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.ext.listAdverseEvents(tx, principal.orgId, {
      patientId: q.patientId ?? null,
      reportedBy: principal.role === 'doctor' ? principal.doctorId : null,
    }));
  }

  /* ---------------- referrals (doctor own) ---------------- */

  async createReferral(principal: Principal, raw: unknown): Promise<Referral> {
    this.assertDoctor(principal);
    const parsed = referralCreateSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientInBranch(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== principal.doctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const ref = await this.ext.createReferral(tx, principal.orgId, {
        branchId: patient.branchId, patientId: patient.id,
        encounterId: input.encounterId ?? null, doctorId: principal.doctorId,
        toSpecialty: input.toSpecialty, toProvider: input.toProvider ?? null,
        reason: input.reason, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'referral_created', entity: 'referrals', entityId: ref.id,
        orgId: principal.orgId, branchId: patient.branchId, source: 'api',
        after: { patientId: patient.id, toSpecialty: ref.toSpecialty },
      }, tx);
      return ref;
    });
  }

  async updateReferralStatus(principal: Principal, id: string, raw: unknown): Promise<Referral> {
    this.assertDoctor(principal);
    const parsed = referralStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target: ReferralStatus = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.ext.findReferralById(tx, principal.orgId, id);
      if (!before || before.doctorId !== principal.doctorId) throw new NotFoundError('Referral', id);
      if (!canTransitionReferral(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before;
      const updated = await this.ext.updateReferralStatus(tx, principal.orgId, id, {
        status: target,
        sentAt: target === 'sent' ? new Date() : undefined,
        acknowledgedAt: target === 'acknowledged' ? new Date() : undefined,
        updatedBy: principal.staffId,
      });
      if (!updated) throw new NotFoundError('Referral', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `referral_${target}`, entity: 'referrals', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }

  async listReferrals(principal: Principal, q: { patientId?: string }): Promise<Referral[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.ext.listReferrals(tx, principal.orgId, {
      branchId: principal.role === 'hq' ? null : principal.branchId,
      patientId: q.patientId ?? null,
      doctorId: principal.role === 'doctor' ? principal.doctorId : null,
    }));
  }
}
