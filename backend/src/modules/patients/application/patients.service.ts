import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../shared/errors/errors';
import {
  PatientsRepository, CreatePatientInput,
} from '../infrastructure/patients.repository';
import { DuplicateCandidate } from '../domain/duplicate';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import {
  Patient, PatientRelationship, PatientTimelineEvent,
} from '../../../infrastructure/database/schema';

const createPatientSchema = z.object({
  name: z.string().trim().min(2).max(256),
  ic: z.string().trim().max(64).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  gender: z.string().max(8).nullish(),
  phone: z.string().max(64).nullish(),
  whatsapp: z.string().max(64).nullish(),
  email: z.string().email().max(256).nullish(),
  patientType: z.string().max(32).optional(),
  contactType: z.string().max(32).optional(),
  guardianId: z.string().uuid().nullish(),
  registrationReason: z.string().max(128).nullish(),
  preferredContact: z.string().max(32).nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

const relationshipSchema = z.object({
  relatedPatientId: z.string().uuid().nullish(),
  relatedName: z.string().trim().min(1).max(256).nullish(),
  type: z.enum(['spouse', 'father', 'mother', 'child', 'sibling', 'guardian', 'dependent']),
});

const updatePatientSchema = z.object({
  name: z.string().trim().min(2).max(256).optional(),
  ic: z.string().trim().max(64).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  gender: z.string().max(8).nullish(),
  phone: z.string().max(64).nullish(),
  whatsapp: z.string().max(64).nullish(),
  email: z.string().email().max(256).nullish(),
  patientType: z.string().max(32).optional(),
  contactType: z.string().max(32).optional(),
  preferredContact: z.string().max(32).nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

export interface RegisterPatientResult {
  patient: Patient;
  duplicates: DuplicateCandidate[];
}

/**
 * PatientsService — Sprint 2 remediation #3 (HQ access).
 * Branch resolution contract:
 *  - non-HQ (branch_manager/branch_admin/doctor): branch ALWAYS = principal.branchId;
 *    explicit target branch must equal own branch (PermissionGuard enforces);
 *    missing principal branch → DENY (fail-closed, unchanged).
 *  - HQ (branchId=null): reads are org-wide (branchId=null → RLS sees all);
 *    mutations REQUIRE an explicit target branchId in the payload (422 if absent).
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: PatientsRepository,
    private readonly audit: AuditService,
    private readonly readPort: PatientsReadPort,
  ) {}

  /** Branch for reads: non-HQ = own branch; HQ = null (org-wide). */
  private readBranch(p: Principal): string | null {
    if (p.role === 'hq') return null;
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  /** Branch for mutations: non-HQ = own branch; HQ = explicit target (validated). */
  private mutateBranch(p: Principal, explicit: string | null | undefined): string {
    if (p.role === 'hq') {
      if (!explicit) throw new ValidationError({ branchId: ['branchId is required for HQ mutation'] });
      return explicit;
    }
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  async register(principal: Principal, raw: unknown): Promise<RegisterPatientResult> {
    const parsed = createPatientSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    const branchId = this.mutateBranch(principal, parsed.data.branchId);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const duplicates = await this.repo.findDuplicateCandidates(tx, principal.orgId, branchId, {
        ic: input.ic, phone: input.phone, contactType: input.contactType,
      });
      const mrn = await new OrgAllocator(tx).nextMrn(principal.orgId);
      const patient = await this.repo.createPatient(tx, principal.orgId, branchId, {
        ...input,
        mrn,
        branchId: undefined,
      } as CreatePatientInput);
      await this.repo.appendTimeline(tx, principal.orgId, {
        patientId: patient.id,
        type: 'registration',
        summary: `Patient registered (${patient.mrn})`,
        actorId: principal.staffId, actorRole: principal.role,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_created', entity: 'patients', entityId: patient.id,
        orgId: principal.orgId, branchId, source: 'api',
      }, tx);
      return { patient, duplicates };
    });
  }

  async getById(principal: Principal, id: string): Promise<Patient> {
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, id);
      if (!patient) throw new NotFoundError('Patient', id);
      await this.assertDoctorCanSee(principal, patient.id, tx);
      return patient;
    });
  }

  /** S10 T1: update patient (partial). HQ may target any branch via branchId;
   *  non-HQ are pinned to their own branch by the guard + readBranch. */
  async update(principal: Principal, id: string, raw: unknown): Promise<Patient> {
    const parsed = updatePatientSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Patient', id);
      await this.assertDoctorCanSee(principal, id, tx);

      const set: Record<string, unknown> = {};
      const input = parsed.data;
      if (input.name !== undefined) set['name'] = input.name;
      if (input.ic !== undefined) set['ic'] = input.ic;
      if (input.dob !== undefined) set['dob'] = input.dob;
      if (input.gender !== undefined) set['gender'] = input.gender;
      if (input.phone !== undefined) set['phone'] = input.phone;
      if (input.whatsapp !== undefined) set['whatsapp'] = input.whatsapp;
      if (input.email !== undefined) set['email'] = input.email;
      if (input.patientType !== undefined) set['patientType'] = input.patientType;
      if (input.contactType !== undefined) set['contactType'] = input.contactType;
      if (input.preferredContact !== undefined) set['preferredContact'] = input.preferredContact;
      if (input.branchId !== undefined) set['branchId'] = input.branchId;

      const updated = await this.repo.updatePatient(tx, principal.orgId, id, set);
      if (!updated) throw new NotFoundError('Patient', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_updated', entity: 'patients', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { name: before.name, phone: before.phone, email: before.email },
        after: set,
      }, tx);
      return updated;
    });
  }

  async search(
    principal: Principal, q: string | undefined, limit?: number, offset?: number,
  ): Promise<Patient[]> {
    const branchId = this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.repo.search(tx, principal.orgId, branchId, { q, limit, offset });
      if (principal.role === 'doctor') {
        const visible: Patient[] = [];
        for (const p of rows) {
          if (await this.doctorLinked(principal, p.id, tx)) visible.push(p);
        }
        return visible;
      }
      return rows;
    });
  }

  async addRelationship(principal: Principal, patientId: string, raw: unknown): Promise<PatientRelationship> {
    const parsed = relationshipSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    if (!parsed.data.relatedPatientId && !parsed.data.relatedName) {
      throw new ValidationError({ related: ['relatedPatientId or relatedName is required'] });
    }
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      const rel = await this.repo.addRelationship(tx, principal.orgId, {
        patientId,
        relatedPatientId: parsed.data.relatedPatientId ?? null,
        relatedName: parsed.data.relatedName ?? null,
        type: parsed.data.type,
      });
      await this.repo.appendTimeline(tx, principal.orgId, {
        patientId,
        type: 'relationship_added',
        summary: `Relationship added (${parsed.data.type})`,
        actorId: principal.staffId, actorRole: principal.role,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_relationship_added', entity: 'patient_relationships',
        entityId: rel.id, orgId: principal.orgId, branchId: principal.branchId, source: 'api',
      }, tx);
      return rel;
    });
  }

  async listRelationships(principal: Principal, patientId: string): Promise<PatientRelationship[]> {
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      await this.assertDoctorCanSee(principal, patientId, tx);
      return this.repo.listRelationships(tx, principal.orgId, patientId);
    });
  }

  async timeline(principal: Principal, patientId: string, limit?: number): Promise<PatientTimelineEvent[]> {
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      await this.assertDoctorCanSee(principal, patientId, tx);
      return this.repo.listTimeline(tx, principal.orgId, patientId, limit);
    });
  }

  /* ---- doctor own-scope helpers (app-layer; DB RLS stays branch-level) ---- */

  private async assertDoctorCanSee(principal: Principal, patientId: string, tx: unknown): Promise<void> {
    if (principal.role !== 'doctor') return;
    if (!(await this.doctorLinked(principal, patientId, tx))) {
      throw new ForbiddenError('You do not have access to this patient');
    }
  }

  private async doctorLinked(principal: Principal, patientId: string, tx: unknown): Promise<boolean> {
    if (!principal.doctorId) return false;
    return this.readPort.doctorLinkedToPatient(
      tx as never,
      principal.orgId,
      principal.doctorId,
      patientId,
    );
  }
}
