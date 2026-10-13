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
import { assertClinicalWriter, isActingDoctor } from '../domain/clinical-writer';
import {
  validateAllergyDraft, validateRetire, sortAllergies, requiresAcknowledgement,
  ALLERGY_SEVERITIES, ALLERGY_CATEGORIES, type AllergySeverity,
} from '../domain/allergies';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import {
  TreatmentCatalogEntry, ConsentTemplate, ConsentRecord, ImagingRecord,
  Prescription, AdverseEvent, Referral, PatientAllergyRow,
} from '../../../infrastructure/database/schema';

const catalogCreateSchema = z.object({
  name: z.string().trim().min(2).max(256),
  category: z.string().trim().min(2).max(64),
  durationMin: z.number().int().positive().max(600).optional(),
});

/* Fasa 1C — allergy intake.
 *
 * These lists are DERIVED from the domain constants, not retyped. A second
 * hand-maintained copy of the severity enum is how "life_threatening" quietly
 * becomes un-submittable because someone added it to the database and not to the
 * schema — and the failure would look like a client bug, not a missing option.
 *
 * `.optional()` on category because `drug` is the commonest and the DB has a
 * default; requiring it would make the UI send a value it does not care about. */
const allergySchema = z.object({
  allergen: z.string().trim().min(2).max(256),
  category: z.enum(ALLERGY_CATEGORIES).optional().default('drug'),
  severity: z.enum(ALLERGY_SEVERITIES),
  reaction: z.string().trim().max(512).nullish(),
});

const retireSchema = z.object({ reason: z.string().trim().min(3).max(512) });
const catalogActiveSchema = z.object({ isActive: z.boolean() });

/**
 * Fasa 1b — treatment PRICING.
 *
 * Every field is `.nullable()` and `.optional()`, and `null` means "clear it".
 * The two states are genuinely different and the columns exist to tell them
 * apart: a treatment whose fee is not decided yet is NULL, one the clinic gives
 * away free is 0. Collapsing them (a default of 0) would make the price list
 * silently claim every treatment costs nothing.
 *
 * Prices arrive in SEN (integer), already converted by the caller — the columns
 * are INT so applying an SST percentage later cannot introduce float drift.
 * Money crosses this boundary as an integer, never a float.
 *
 * `classificationCode` is LHDN's e-Invoice code: free text, short, and stored
 * now even though e-Invoice is a later phase.
 */
const catalogPricingSchema = z.object({
  price: z.number().int().min(0).max(100_000_000).nullable().optional(),
  price2: z.number().int().min(0).max(100_000_000).nullable().optional(),
  panelPrice: z.number().int().min(0).max(100_000_000).nullable().optional(),
  cost: z.number().int().min(0).max(100_000_000).nullable().optional(),
  localSstPct: z.number().min(0).max(100).nullable().optional(),
  foreignerSstPct: z.number().min(0).max(100).nullable().optional(),
  classificationCode: z.string().trim().max(16).nullable().optional(),
  keyboardLetter: z.string().trim().max(4).nullable().optional(),
});

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
  doctorId: z.string().uuid().nullish(),
  kind: z.enum(['xray', 'cbct', 'opg', 'photo', 'before_after', 'consent', 'document']),
  title: z.string().trim().min(2).max(256),
  fileRef: z.string().trim().max(512).nullish(),
  takenAt: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().trim().max(512).nullish(),
});

const prescriptionSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  /* HQ memilih doktor (owner direction 8 Okt: HQ serba-boleh); doktor sendiri
   * diabaikan — servis memakai identiti principal. */
  doctorId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  medication: z.string().trim().min(2).max(256),
  dosage: z.string().trim().max(128).nullish(),
  frequency: z.string().trim().max(128).nullish(),
  durationDays: z.number().int().positive().max(365).nullish(),
  notes: z.string().trim().max(512).nullish(),
});

const adverseSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  doctorId: z.string().uuid().nullish(),
  severity: z.enum(['mild', 'moderate', 'severe']),
  description: z.string().trim().min(2).max(8000),
  actionTaken: z.string().trim().max(8000).nullish(),
});

const referralCreateSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  doctorId: z.string().uuid().nullish(),
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

  /* OWNER DIRECTION (8 Okt 2026): HQ serba-boleh. Tulis klinikal atas nama
   * doktor dipilih (pola sesi/preskripsi/pelan): doktor sendiri guna
   * identitinya; HQ WAJIB doctorId; manager kekal ditolak. */
  private resolveClinicalWriter(
    p: Principal, input: { doctorId?: string | null },
  ): string {
    if (p.role === 'doctor' && p.doctorId) return p.doctorId;
    if (p.role === 'hq') {
      if (!input.doctorId) throw new ForbiddenError('HQ mesti memilih doktor (doctorId) untuk rekod klinikal ini');
      return input.doctorId;
    }
    throw new ForbiddenError('Only doctors can create or modify clinical records');
  }

  /* Doktor: pesakit mesti cawangannya. HQ (scope 'all'): pesakit mana-mana. */
  private async patientOrAny(
    tx: Parameters<Parameters<DbContextService['runAs']>[1]>[0],
    p: Principal, patientId: string,
  ) {
    if (p.role === 'hq') {
      const patient = await this.patients.getPatientById(tx, p.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      return patient;
    }
    return this.patientInBranch(tx, p as Principal & { branchId: string }, patientId);
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

  /**
   * Fasa 1C — branch containment for a record that carries its own branchId.
   *
   * Mirrors `patientInBranch` but for rows reached by their own id (an allergy),
   * where the patient is not in hand. HQ is unrestricted; a branch role may only
   * touch its own branch. The answer is **403, never a silently empty result** —
   * a caller who is refused knows to stop, while an empty list reads as "this
   * patient has no allergies", which is the single most dangerous wrong answer in
   * this sub-phase.
   */
  private assertBranchRecord(p: Principal, branchId: string): void {
    if (p.role === 'hq') return;
    if (!p.branchId) throw new ForbiddenError('Your account is not attached to a branch');
    if (branchId !== p.branchId) throw new ForbiddenError('Record belongs to a different branch');
  }

  /** Stored row -> the narrow shape the domain gate evaluates. Kept as a method
   * so the mapping lives next to the code that uses it and cannot drift. */
  private toDomainAllergy(row: PatientAllergyRow) {
    return {
      id: row.id,
      allergen: row.allergen,
      severity: row.severity as AllergySeverity,
      reaction: row.reaction ?? null,
    };
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

  /**
   * Fasa 1B — the chart legend.
   *
   * Readable by every clinical role (it is reference data the chart needs to
   * draw at all), writable by nobody here: symbols are org-wide master data on
   * the HQ path, exactly like the treatment catalog. `activeOnly=false` is what
   * lets a settings screen show a deactivated symbol so it can be re-enabled —
   * without it, switching one off would make it unreachable forever.
   */
  async listChartSymbols(principal: Principal, activeOnly: boolean) {
    return this.dbCtx.runAs(principal, async (tx) =>
      this.core.listChartSymbols(tx, principal.orgId, activeOnly));
  }

  /**
   * Fasa 1b — write a treatment's prices.
   *
   * HQ-only, same gate as the rest of the catalogue master data
   * (`createCatalogEntry`, `setCatalogActive`). This is the pricing MASTER: a
   * number entered here applies to every branch on every future bill, so it is
   * not a per-patient decision a doctor makes at the chair. Recording money
   * against ONE patient is a different act with a different gate
   * (`finance:create` → `treatment-costs`); the two must not be conflated.
   *
   * Only the FIELDS PRESENT in the payload are written. That matters because the
   * dialog saves what fits on the screen: a clinic often knows its scaling fee
   * long before its braces fee, and an absent field must mean "leave it as it
   * is", not "set it to null". An explicit `null` is how a value is CLEARED.
   *
   * The audit row records before/after so a price change is traceable — a fee
   * that moved without a record is how a billing dispute becomes unwinnable.
   */
  async updateCatalogPricing(principal: Principal, id: string, raw: unknown): Promise<TreatmentCatalogEntry> {
    this.assertHq(principal);
    const parsed = catalogPricingSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.core.findCatalogById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Treatment', id);

      /* Build the SET from keys the caller actually sent. `undefined` = absent =
       * untouched; an explicit `null` = clear the value. */
      const set: Record<string, unknown> = {};
      const fields = ['price', 'price2', 'panelPrice', 'cost',
        'localSstPct', 'foreignerSstPct', 'classificationCode', 'keyboardLetter'] as const;
      for (const f of fields) {
        if (input[f] !== undefined) set[f] = input[f];
      }
      if (Object.keys(set).length === 0) return before; /* nothing to do */

      const updated = await this.core.updateCatalogPricing(tx, principal.orgId, id, set, principal.staffId);
      if (!updated) throw new NotFoundError('Treatment', id);

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'treatment_catalog_priced', entity: 'treatment_catalog', entityId: id,
        orgId: principal.orgId, branchId: null, source: 'api',
        before: {
          price: before.price, price2: before.price2, panelPrice: before.panelPrice,
          cost: before.cost, localSstPct: before.localSstPct,
          foreignerSstPct: before.foreignerSstPct,
          classificationCode: before.classificationCode, keyboardLetter: before.keyboardLetter,
        },
        after: set,
      }, tx);
      return updated;
    });
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
      /* Consent templates are ONE family of the 1G form engine, so both the version lookup
       * and the insert carry the kind. The consent route predates the other families and
       * deliberately keeps its own contract — it never had to say which family it was. */
      const version = (await this.ext.latestTemplateVersion(tx, principal.orgId, input.title, 'consent')) + 1;
      const tpl = await this.ext.createTemplate(tx, principal.orgId, {
        title: input.title, body: input.body, version, createdBy: principal.staffId, kind: 'consent',
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
    const parsed = imagingSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const actingDoctorId = this.resolveClinicalWriter(principal, input);

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientOrAny(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== actingDoctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const rec = await this.ext.createImaging(tx, principal.orgId, {
        branchId: patient.branchId, patientId: patient.id,
        encounterId: input.encounterId ?? null, uploadedBy: actingDoctorId,
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
    /* OWNER DIRECTION (8 Okt 2026): doktor menulis sendiri; HQ menulis ATAS
     * NAMA doktor yang dipilihnya (doctorId dari body — HQ tiada identiti
     * doktor sendiri, doctor_ref NULL). Manager/branch_admin tetap ditolak. */
    assertClinicalWriter(principal);
    const parsed = prescriptionSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const writerDoctorId = isActingDoctor(principal)
      ? principal.doctorId
      : (input.doctorId ?? null);
    if (!writerDoctorId) {
      throw new ForbiddenError('HQ mesti memilih doktor (doctorId) untuk preskripsi ini');
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Doktor: pesakit mesti cawangannya. HQ: bebas (skop 'all'). */
      const patient = isActingDoctor(principal)
        ? await this.patientInBranch(tx, principal, input.patientId)
        : await this.patients.getPatientById(tx, principal.orgId, input.patientId);
      if (!patient) throw new NotFoundError('Patient', input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== writerDoctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const rx = await this.ext.createPrescription(tx, principal.orgId, {
        branchId: patient.branchId, patientId: patient.id,
        encounterId: input.encounterId ?? null, doctorId: writerDoctorId,
        medication: input.medication, dosage: input.dosage ?? null,
        frequency: input.frequency ?? null, durationDays: input.durationDays ?? null,
        notes: input.notes ?? null, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'prescription_created', entity: 'prescriptions', entityId: rx.id,
        orgId: principal.orgId, branchId: patient.branchId, source: 'api',
        after: { patientId: patient.id, medication: rx.medication, onBehalfDoctorId: isActingDoctor(principal) ? undefined : writerDoctorId },
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
    const parsed = adverseSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const actingDoctorId = this.resolveClinicalWriter(principal, input);

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientOrAny(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== actingDoctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const ev = await this.ext.createAdverseEvent(tx, principal.orgId, {
        patientId: patient.id, encounterId: input.encounterId ?? null,
        reportedBy: actingDoctorId, severity: input.severity,
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
    const parsed = referralCreateSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const actingDoctorId = this.resolveClinicalWriter(principal, input);

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patientOrAny(tx, principal, input.patientId);
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== actingDoctorId) throw new NotFoundError('Encounter', input.encounterId);
      }
      const ref = await this.ext.createReferral(tx, principal.orgId, {
        branchId: patient.branchId, patientId: patient.id,
        encounterId: input.encounterId ?? null, doctorId: actingDoctorId,
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
    /* HQ serba-boleh (owner direction): doktor ATAU HQ boleh kemaskini status. */
    if (principal.role !== 'doctor' && principal.role !== 'hq') {
      throw new ForbiddenError('Only doctors can create or modify clinical records');
    }
    const parsed = referralStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target: ReferralStatus = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.ext.findReferralById(tx, principal.orgId, id);
      /* Doktor: hanya rujukan sendiri. HQ (scope 'all'): mana-mana. */
      if (!before || (principal.role === 'doctor' && before.doctorId !== principal.doctorId)) throw new NotFoundError('Referral', id);
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

  /* ---------------- Fasa 1C: patient allergies ---------------- */

  /**
   * List a patient's allergies, ACTIVE FIRST and most serious first within each
   * group. Retired entries are kept in the payload but pushed last.
   *
   * WHO MAY WRITE (see the controller): `clinical:create`, which the matrix grants
   * to the doctor role alone. Recording an allergy is therefore doctor-only today.
   */
  async listAllergies(principal: Principal, patientId: string) {
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patients.getPatientById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      this.assertBranchRecord(principal, patient.branchId);

      const rows = await this.core.listAllergies(tx, principal.orgId, patientId);
      const active = sortAllergies(rows.filter((r) => r.retiredAt == null).map((r) => this.toDomainAllergy(r)));
      const retired = rows.filter((r) => r.retiredAt != null)
        .slice().sort((a, b) => String(b.retiredAt).localeCompare(String(a.retiredAt)));

      return {
        patientId,
        active,
        retired,
        /* Named for the UI, not a count: a banner that can say WHICH allergy
         * blocks is the difference between a clinician reading it and clicking
         * through. */
        blocking: active.filter((a) => requiresAcknowledgement(a.severity)),
      };
    });
  }

  /**
   * Record an allergy.
   *
   * `notedBy` is the caller, never a body field — otherwise one user could
   * attribute a clinical finding to another, and the audit trail would name the
   * wrong person. A retired duplicate of the same allergen does NOT block a new
   * record (that is how a mistaken retire is undone), but an ACTIVE duplicate
   * does: two live rows for one allergen arrive in the list twice and make a
   * reader distrust both.
   */
  async createAllergy(principal: Principal, patientId: string, raw: unknown) {
    const parsed = allergySchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    const domainErrors = validateAllergyDraft({
      allergen: input.allergen, severity: input.severity, reaction: input.reaction ?? null,
    });
    if (Object.keys(domainErrors).length > 0) throw new ValidationError(domainErrors);

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patients.getPatientById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      this.assertBranchRecord(principal, patient.branchId);

      const allergen = input.allergen.trim();
      const dup = await this.core.findActiveAllergy(tx, principal.orgId, patientId, allergen);
      if (dup) {
        throw new ConflictError(
          `"${allergen}" is already an active allergy for this patient (severity ${dup.severity}). `
          + 'Retire the existing record first if it is no longer correct.',
        );
      }

      const row = await this.core.createAllergy(tx, principal.orgId, {
        branchId: patient.branchId,
        patientId,
        allergen,
        category: input.category,
        severity: input.severity,
        reaction: input.reaction ?? null,
        notedBy: principal.staffId,
      });

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'allergy_recorded', entity: 'patient_allergies', entityId: row.id,
        orgId: principal.orgId, branchId: patient.branchId, source: 'api',
        /* Severity is the field that decides whether the safety gate fires, so it
         * belongs in the audit record: "this was recorded as mild" is the fact a
         * review needs if a patient later reacts. */
        after: { allergen, severity: input.severity, category: input.category },
      }, tx);

      return row;
    });
  }

  /**
   * Retire an allergy — the ONLY way it stops being active. Never a delete.
   *
   * `assertBranch` plus the repository's `isNull(retiredAt)` guard means retiring
   * is idempotent-safe: a second attempt returns null and the service reports a
   * 404 rather than silently moving the retire timestamp, which would erase when
   * the decision was actually made.
   */
  async retireAllergy(principal: Principal, allergyId: string, raw: unknown) {
    const parsed = retireSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);

    const domainErrors = validateRetire({ reason: parsed.data.reason });
    if (Object.keys(domainErrors).length > 0) throw new ValidationError(domainErrors);

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.core.findAllergyById(tx, principal.orgId, allergyId);
      if (!before) throw new NotFoundError('Allergy', allergyId);
      this.assertBranchRecord(principal, before.branchId);
      if (before.retiredAt != null) throw new ConflictError('This allergy is already retired');

      const row = await this.core.retireAllergy(tx, principal.orgId, allergyId, {
        reason: parsed.data.reason.trim(), retiredBy: principal.staffId,
      });
      if (!row) throw new NotFoundError('Allergy', allergyId);

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'allergy_retired', entity: 'patient_allergies', entityId: allergyId,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { allergen: before.allergen, severity: before.severity },
        after: { retiredReason: parsed.data.reason.trim() },
      }, tx);

      return row;
    });
  }
}

