import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ConflictError, ForbiddenError, NotFoundError,
} from '../../../shared/errors/errors';
import { AppointmentsRepository } from '../infrastructure/appointments.repository';
import {
  canTransition, canReschedule, allowedTransitions,
} from '../domain/appointment-flow';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { Appointment } from '../../../infrastructure/database/schema';

const bookSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string().trim().min(2).max(256),
  doctorId: z.string().uuid().nullish(),
  treatmentRef: z.string().max(256).nullish(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.number().int().min(5).max(480).optional(),
  notes: z.string().max(4000).nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

const statusSchema = z.object({
  status: z.enum([
    'booked', 'confirmed', 'checked-in', 'waiting', 'called',
    'in-progress', 'completed', 'cancelled', 'no-show',
  ]),
});

const rescheduleSchema = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.number().int().min(5).max(480).optional(),
  expectedVersion: z.number().int().min(1),
});

const listSchema = z.object({
  branchId: z.string().uuid().nullish(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.string().max(32).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * AppointmentsService — Sprint 2 remediation #3 (HQ access).
 * Branch contract (same as patients):
 *  - non-HQ: branch = principal.branchId (guard enforces explicit target match)
 *  - HQ: reads org-wide (RLS sees all); booking REQUIRES explicit branchId (422)
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: AppointmentsRepository,
    private readonly readPort: PatientsReadPort,
    private readonly audit: AuditService,
  ) {}

  private readBranch(p: Principal): string | null {
    if (p.role === 'hq') return null;
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  private mutateBranch(p: Principal, explicit: string | null | undefined): string {
    if (p.role === 'hq') {
      if (!explicit) throw new ValidationError({ branchId: ['branchId is required for HQ booking'] });
      return explicit;
    }
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  async book(principal: Principal, raw: unknown): Promise<Appointment> {
    const parsed = bookSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const branchId = this.mutateBranch(principal, parsed.data.branchId);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.readPort.getPatientById(tx as never, principal.orgId, input.patientId);
      if (!patient) throw new NotFoundError('Patient', input.patientId);

      if (input.doctorId) {
        const clash = await this.repo.findDoctorOverlap(
          tx, principal.orgId, branchId, input.doctorId,
          input.scheduledDate, input.scheduledTime, input.durationMin ?? 30,
        );
        if (clash) {
          throw new ConflictError(
            `Doctor already has an appointment ${clash.scheduledTime} on ${clash.scheduledDate}`,
          );
        }
      }

      const code = await new OrgAllocator(tx).nextAptCode(principal.orgId);
      const appt = await this.repo.create(tx, principal.orgId, branchId, {
        code,
        patientId: input.patientId,
        patientName: input.patientName,
        doctorId: input.doctorId ?? null,
        treatmentRef: input.treatmentRef ?? null,
        scheduledDate: input.scheduledDate,
        scheduledTime: input.scheduledTime,
        durationMin: input.durationMin ?? 30,
        notes: input.notes ?? null,
      });

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'appointment_booked', entity: 'appointments', entityId: appt.id,
        orgId: principal.orgId, branchId, source: 'api',
        after: {
          date: input.scheduledDate, time: input.scheduledTime,
          doctorId: input.doctorId ?? null, patientId: input.patientId,
        },
      }, tx);
      return appt;
    });
  }

  async getById(principal: Principal, id: string): Promise<Appointment> {
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const appt = await this.repo.findById(tx, principal.orgId, id);
      if (!appt) throw new NotFoundError('Appointment', id);
      return appt;
    });
  }

  /** S10 T1: list appointments (paginated, scoped, filtered). */
  async list(principal: Principal, raw: unknown): Promise<Appointment[]> {
    const parsed = listSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const filters = parsed.data;
    const branchId = this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      return this.repo.list(tx, principal.orgId, branchId, filters);
    });
  }

  async changeStatus(principal: Principal, id: string, raw: unknown): Promise<Appointment> {
    const parsed = statusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    this.readBranch(principal);

    return this.dbCtx.runAs(principal, async (tx) => {
      const appt = await this.repo.findById(tx, principal.orgId, id);
      if (!appt) throw new NotFoundError('Appointment', id);
      if (!canTransition(appt.status, parsed.data.status)) {
        throw new ConflictError(
          `Illegal transition ${appt.status} → ${parsed.data.status} (allowed: ${allowedTransitions(appt.status).join(', ') || 'none'})`,
        );
      }
      const updated = await this.repo.updateStatus(tx, principal.orgId, id, parsed.data.status, appt.version);
      if (!updated) throw new ConflictError('Concurrent modification — reload and retry');

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'appointment_status_changed', entity: 'appointments', entityId: id,
        orgId: principal.orgId, branchId: principal.branchId, source: 'api',
        before: { status: appt.status }, after: { status: parsed.data.status },
      }, tx);
      return updated;
    });
  }

  async reschedule(principal: Principal, id: string, raw: unknown): Promise<Appointment> {
    const parsed = rescheduleSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    this.readBranch(principal);

    return this.dbCtx.runAs(principal, async (tx) => {
      const appt = await this.repo.findById(tx, principal.orgId, id);
      if (!appt) throw new NotFoundError('Appointment', id);
      if (!canReschedule(appt.status)) {
        throw new ConflictError(`Cannot reschedule an appointment in status '${appt.status}'`);
      }
      if (appt.doctorId) {
        const clash = await this.repo.findDoctorOverlap(
          tx, principal.orgId, appt.branchId, appt.doctorId,
          parsed.data.scheduledDate, parsed.data.scheduledTime,
          parsed.data.durationMin ?? appt.durationMin, id,
        );
        if (clash) throw new ConflictError('New time clashes with an existing appointment');
      }
      const updated = await this.repo.reschedule(tx, principal.orgId, id, {
        scheduledDate: parsed.data.scheduledDate,
        scheduledTime: parsed.data.scheduledTime,
        durationMin: parsed.data.durationMin ?? appt.durationMin,
      }, parsed.data.expectedVersion);
      if (!updated) throw new ConflictError('Concurrent modification — reload and retry');

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'appointment_rescheduled', entity: 'appointments', entityId: id,
        orgId: principal.orgId, branchId: appt.branchId, source: 'api',
        before: {
          date: appt.scheduledDate, time: appt.scheduledTime, durationMin: appt.durationMin,
        },
        after: {
          date: updated.scheduledDate, time: updated.scheduledTime, durationMin: updated.durationMin,
        },
      }, tx);
      return updated;
    });
  }

  /** Day queue: branch-scoped by definition. HQ must pass an explicit branchId. */
  async queue(principal: Principal, date: string, branchIdParam?: string): Promise<Appointment[]> {
    let branchId: string;
    if (principal.role === 'hq') {
      if (!branchIdParam) throw new ValidationError({ branchId: ['branchId is required for HQ queue'] });
      branchId = branchIdParam;
    } else {
      if (!principal.branchId) throw new ForbiddenError('No branch context — access denied');
      branchId = principal.branchId;
    }
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.dayQueue(tx, principal.orgId, branchId, date));
  }

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }
}
