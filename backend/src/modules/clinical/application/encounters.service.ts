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
import { canTransitionEncounter } from '../domain/encounter-status';
import { evaluateCompletionGate } from '../domain/safety-gate';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import { Encounter } from '../../../infrastructure/database/schema';

const createEncounterSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().nullish(),
  chiefComplaint: z.string().trim().max(512).nullish(),
});

const transitionSchema = z.object({
  status: z.enum(['completed', 'cancelled']),
});

/**
 * EncountersService — canonical clinical case (Sprint 3 S3-C/D).
 *
 * SECURITY MODEL (strict doctor own-scope — Sprint 3 discovery decision):
 *  - doctor: reads/writes ONLY encounters where doctor_id = principal.doctorId
 *    (principal.doctorId is the staff id — server-derived, never client input)
 *  - hq: read all (ROLE_DOMAIN_MATRIX clinical = view only)
 *  - branch_manager: read branch (view only)
 *  - branch_admin: clinical = NONE → PermissionGuard denies before this layer
 * RLS (0007) re-enforces the identical boundary at the DB layer.
 *
 * Every mutation: runAs() + same-tx audit (Blocker-1) + same-tx timeline.
 */
@Injectable()
export class EncountersService {
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

  /** Clinical writes are doctor-only (matrix: hq/bm clinical = view). */
  private assertDoctor(p: Principal): asserts p is Principal & { doctorId: string; branchId: string } {
    if (p.role !== 'doctor' || !p.doctorId || !p.branchId) {
      throw new ForbiddenError('Only doctors can create or modify clinical records');
    }
  }

  /** Read-scope guard: doctors see their own; hq/bm rely on RLS + matrix view. */
  private assertCanView(p: Principal, enc: Encounter): void {
    if (p.role === 'doctor' && enc.doctorId !== p.doctorId) {
      throw new NotFoundError('Encounter', enc.id); /* no existence leak */
    }
    if (p.role === 'branch_manager' && p.branchId && enc.branchId !== p.branchId) {
      throw new NotFoundError('Encounter', enc.id);
    }
  }

  private assertOwns(p: Principal, enc: Encounter): void {
    if (enc.doctorId !== p.doctorId) {
      throw new NotFoundError('Encounter', enc.id); /* cross-doctor → 404 */
    }
  }

  async create(principal: Principal, raw: unknown): Promise<Encounter> {
    this.assertDoctor(principal);
    const parsed = createEncounterSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Canonical patient identity — PatientsReadPort, never duplicated. */
      const patient = await this.patients.getPatientById(tx, principal.orgId, input.patientId);
      if (!patient) throw new NotFoundError('Patient', input.patientId);
      if (patient.branchId !== principal.branchId) {
        throw new ForbiddenError('Patient belongs to a different branch');
      }

      const code = await new OrgAllocator(tx).nextEncounterCode(principal.orgId);
      const enc = await this.core.createEncounter(tx, principal.orgId, {
        encounterCode: code, branchId: patient.branchId, patientId: patient.id,
        appointmentId: input.appointmentId ?? null, doctorId: principal.doctorId,
        chiefComplaint: input.chiefComplaint ?? null, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'encounter_created', entity: 'encounters', entityId: enc.id,
        orgId: principal.orgId, branchId: enc.branchId, source: 'api',
        after: { code: enc.encounterCode, patientId: enc.patientId, appointmentId: enc.appointmentId },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: enc.patientId, type: 'encounter_created',
        summary: `Encounter ${enc.encounterCode} opened`,
        payload: { encounterId: enc.id, code: enc.encounterCode },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return enc;
    });
  }

  async getById(principal: Principal, id: string): Promise<Encounter> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const enc = await this.core.findEncounterById(tx, principal.orgId, id);
      if (!enc) throw new NotFoundError('Encounter', id);
      this.assertCanView(principal, enc);
      return enc;
    });
  }

  async search(principal: Principal, q: {
    patientId?: string; branchId?: string; limit?: number; offset?: number;
  }): Promise<Encounter[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.core.searchEncounters(tx, principal.orgId, {
      /* doctors are hard-scoped to their own encounters (strict own). */
      doctorId: principal.role === 'doctor' ? principal.doctorId : null,
      branchId: principal.role === 'hq' ? (q.branchId ?? null) : principal.branchId,
      patientId: q.patientId ?? null, limit: q.limit, offset: q.offset,
    }));
  }

  /** open → completed (safety gate) | cancelled. Same-state = no-op. */
  async transition(principal: Principal, id: string, raw: unknown): Promise<Encounter> {
    this.assertDoctor(principal);
    const parsed = transitionSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.core.findEncounterById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Encounter', id);
      this.assertOwns(principal, before);
      if (!canTransitionEncounter(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before; /* no-op */

      if (target === 'completed') {
        /* Safety gate (Blueprint §310): severe-allergy signal must be
         * acknowledged before completion — BLOCK, not warn. */
        const severe = await this.ext.countSevereAdverseEvents(tx, principal.orgId, before.patientId);
        const verdict = evaluateCompletionGate({
          severeAdverseEventCount: severe, allergyAcknowledgedAt: before.allergyAcknowledgedAt,
        });
        if (!verdict.allowed) {
          throw new ConflictError(`Safety gate blocked completion: ${verdict.blockers.join(', ')}`);
        }
      }

      const updated = await this.core.updateEncounterStatus(tx, principal.orgId, id, {
        status: target, completedAt: target === 'completed' ? new Date() : null,
        updatedBy: principal.staffId,
      });
      if (!updated) throw new NotFoundError('Encounter', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: `encounter_${target}`, entity: 'encounters', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: before.patientId, type: `encounter_${target}`,
        summary: `Encounter ${before.encounterCode} ${target}`,
        payload: { encounterId: id, code: before.encounterCode },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return updated;
    });
  }

  /** Explicit allergy acknowledgement (safety gate input). */
  async acknowledgeAllergy(principal: Principal, id: string): Promise<Encounter> {
    this.assertDoctor(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.core.findEncounterById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Encounter', id);
      this.assertOwns(principal, before);
      if (before.status !== 'open') throw new ConflictError('Encounter is not open');
      const updated = await this.core.acknowledgeAllergy(tx, principal.orgId, id, principal.staffId);
      if (!updated) throw new NotFoundError('Encounter', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'encounter_allergy_acknowledged', entity: 'encounters', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        after: { allergyAcknowledged: true },
      }, tx);
      return updated;
    });
  }
}
