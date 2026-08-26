import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { IdempotencyService } from '../../../shared/idempotency/idempotency.service';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/errors';
import { OperationsRepository } from '../infrastructure/operations.repository';
import {
  canTransitionDoctorStatus, canTransitionChecklist, canTransitionTask, canTransitionIncident,
  DoctorStatusState, ChecklistState, TaskState, IncidentState,
} from '../domain/operations-lifecycle';
import { checklists, tasks, incidents, labCases } from '../../../infrastructure/database/schema';
import { ClinicalReadPort } from '../../../shared/ports/clinical.read-port';
import { AppointmentsReadPort } from '../../../shared/ports/appointments.read-port';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const statusInput = z.object({ status: z.string(), note: z.string().max(512).nullish() });
const doctorStatusInput = z.object({ branchId: uuid, doctorId: uuid, status: z.enum(['available','busy','break','offline']), note: z.string().max(256).nullish() });
const checklistInput = z.object({ branchId: uuid, checklistDate: date, shift: z.string().max(32).nullish(), title: z.string().trim().min(1).max(256), items: z.array(z.object({ label: z.string().min(1).max(256), done: z.boolean().default(false) })).min(1), ownerId: uuid.nullish() });
const taskInput = z.object({ branchId: uuid, title: z.string().trim().min(1).max(256), description: z.string().max(1024).nullish(), priority: z.enum(['urgent','high','normal','low']).default('normal'), assigneeId: uuid.nullish(), dueDate: date.nullish(), idempotencyKey: z.string().trim().min(8).max(256).nullish() });
const incidentInput = z.object({ branchId: uuid, title: z.string().trim().min(1).max(256), description: z.string().max(2048).nullish(), severity: z.enum(['critical','high','medium','low']), ownerId: uuid.nullish(), idempotencyKey: z.string().trim().min(8).max(256).nullish() });
const labCaseInput = z.object({ branchId: uuid, patientId: uuid, encounterId: uuid.nullish(), labVendor: z.string().trim().min(1).max(256), workDescription: z.string().trim().min(1).max(512), dueDate: date.nullish(), idempotencyKey: z.string().trim().min(8).max(256).nullish() });

/** Operations owns workflow records only. No scheduling side effects, no notifications, no Finance writes. */
@Injectable()
export class OperationsService {
  constructor(private readonly dbCtx: DbContextService, private readonly repo: OperationsRepository, private readonly patients: PatientsReadPort, private readonly clinical: ClinicalReadPort, private readonly appointments: AppointmentsReadPort, private readonly audit: AuditService, private readonly idempotency: IdempotencyService) {}
  private assertAccess(p: Principal) { if (p.role !== 'hq' && p.role !== 'branch_manager') throw new ForbiddenError('Operations access is restricted to HQ and branch managers'); }
  private branch(p: Principal, requested: string) { if (p.role === 'branch_manager' && p.branchId !== requested) throw new ForbiddenError('Branch manager cannot access another branch'); return requested; }
  private scoped(p: Principal, requested?: string) { return p.role === 'hq' ? (requested ?? null) : p.branchId; }
  private invalid(parsed: { error: { issues: Array<{ path: (string | number)[]; message: string }> } }) { return new ValidationError(Object.fromEntries(parsed.error.issues.map((x) => [x.path.join('.'), [x.message]]))); }
  private parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); if (!result.success) throw this.invalid(result); return result.data; }
  private auditEvent(p: Principal, action: string, entity: string, id: string, branchId: string, before?: Record<string, unknown>, after?: Record<string, unknown>) { return { actorId: p.staffId, actorRole: p.role, action, entity, entityId: id, orgId: p.orgId, branchId, source: 'api' as const, before, after }; }

  /* ---------- DOCTOR STATUS (append-only history) ---------- */
  async setDoctorStatus(p: Principal, raw: unknown) {
    this.assertAccess(p); const input = this.parse(doctorStatusInput, raw); const branchId = this.branch(p, input.branchId);
    return this.dbCtx.runAs(p, async tx => {
      const current = await this.repo.currentDoctorStatus(tx, p.orgId, input.doctorId);
      if (current && !canTransitionDoctorStatus(current.status as DoctorStatusState, input.status)) {
        throw new ConflictError(`Illegal transition ${current.status} → ${input.status}`);
      }
      if (current && current.status === input.status) return current;
      const row = await this.repo.createDoctorStatus(tx, { orgId: p.orgId, branchId, doctorId: input.doctorId, status: input.status, note: input.note ?? null, createdBy: p.staffId, updatedBy: p.staffId });
      await this.audit.record(this.auditEvent(p, 'doctor_status_changed', 'doctor_statuses', row.id, branchId, current ? { status: current.status } : undefined, { status: input.status }), tx);
      return row;
    });
  }
  async listDoctorStatuses(p: Principal, branchId?: string) { this.assertAccess(p); return this.dbCtx.runAs(p, tx => this.repo.listDoctorStatuses(tx, p.orgId, this.scoped(p, branchId))); }

  /* ---------- CHECKLIST ---------- */
  async createChecklist(p: Principal, raw: unknown) {
    this.assertAccess(p); const input = this.parse(checklistInput, raw); const branchId = this.branch(p, input.branchId);
    return this.dbCtx.runAs(p, async tx => {
      const row = await this.repo.createChecklist(tx, { orgId: p.orgId, branchId, checklistDate: input.checklistDate, shift: input.shift ?? null, title: input.title, items: input.items, ownerId: input.ownerId ?? null, createdBy: p.staffId, updatedBy: p.staffId });
      await this.audit.record(this.auditEvent(p, 'checklist_created', 'checklists', row.id, branchId), tx);
      return row;
    });
  }
  async listChecklists(p: Principal, branchId?: string) { this.assertAccess(p); return this.dbCtx.runAs(p, tx => this.repo.listChecklists(tx, p.orgId, this.scoped(p, branchId))); }

  /* ---------- TASK ---------- */
  async createTask(p: Principal, raw: unknown) {
    this.assertAccess(p); const input = this.parse(taskInput, raw); const branchId = this.branch(p, input.branchId);
    const exec = async () => this.dbCtx.runAs(p, async tx => {
      const row = await this.repo.createTask(tx, { orgId: p.orgId, branchId, title: input.title, description: input.description ?? null, priority: input.priority, assigneeId: input.assigneeId ?? null, dueDate: input.dueDate ?? null, createdBy: p.staffId, updatedBy: p.staffId });
      await this.audit.record(this.auditEvent(p, 'task_created', 'tasks', row.id, branchId, undefined, { title: row.title, priority: row.priority }), tx);
      return row;
    });
    if (!input.idempotencyKey) return exec();
    const scope = `operations:task:${p.orgId}:${branchId}`;
    const result = await this.idempotency.execute(input.idempotencyKey, scope, exec);
    if (result.inProgress || !result.result) throw new ConflictError('Task creation is already in progress');
    return result.result;
  }
  async listTasks(p: Principal, branchId?: string) { this.assertAccess(p); return this.dbCtx.runAs(p, tx => this.repo.listTasks(tx, p.orgId, this.scoped(p, branchId))); }

  /* ---------- INCIDENT ---------- */
  async createIncident(p: Principal, raw: unknown) {
    this.assertAccess(p); const input = this.parse(incidentInput, raw); const branchId = this.branch(p, input.branchId);
    const exec = async () => this.dbCtx.runAs(p, async tx => {
      const row = await this.repo.createIncident(tx, { orgId: p.orgId, branchId, title: input.title, description: input.description ?? null, severity: input.severity, ownerId: input.ownerId ?? null, createdBy: p.staffId, updatedBy: p.staffId });
      await this.audit.record(this.auditEvent(p, 'incident_created', 'incidents', row.id, branchId, undefined, { severity: row.severity }), tx);
      return row;
    });
    if (!input.idempotencyKey) return exec();
    const scope = `operations:incident:${p.orgId}:${branchId}`;
    const result = await this.idempotency.execute(input.idempotencyKey, scope, exec);
    if (result.inProgress || !result.result) throw new ConflictError('Incident creation is already in progress');
    return result.result;
  }
  async listIncidents(p: Principal, branchId?: string) { this.assertAccess(p); return this.dbCtx.runAs(p, tx => this.repo.listIncidents(tx, p.orgId, this.scoped(p, branchId))); }

  /* ---------- SHARED TRANSITIONS ---------- */
  private async transition(p: Principal, id: string, raw: unknown, entity: 'checklist' | 'task' | 'incident') {
    this.assertAccess(p); const input = this.parse(statusInput, raw);
    return this.dbCtx.runAs(p, async tx => {
      const before = entity === 'checklist' ? await this.repo.findChecklist(tx, p.orgId, id) : entity === 'task' ? await this.repo.findTask(tx, p.orgId, id) : await this.repo.findIncident(tx, p.orgId, id);
      if (!before) throw new NotFoundError(entity, id);
      this.branch(p, before.branchId);
      const okay = entity === 'checklist' ? canTransitionChecklist(before.status as ChecklistState, input.status as ChecklistState) : entity === 'task' ? canTransitionTask(before.status as TaskState, input.status as TaskState) : canTransitionIncident(before.status as IncidentState, input.status as IncidentState);
      if (!okay) throw new ConflictError(`Illegal transition ${before.status} → ${input.status}`);
      if (before.status === input.status) return before;
      const extra: Record<string, unknown> = {};
      if (input.status === 'completed') extra.completedAt = new Date();
      if (entity === 'incident' && input.status === 'resolved') extra.resolvedAt = new Date();
      if (entity === 'incident' && input.status === 'closed') extra.closedAt = new Date();
      const dbTable = entity === 'checklist' ? checklists : entity === 'task' ? tasks : incidents;
      const updated = await this.repo.updateStatus(tx, dbTable, p.orgId, id, input.status, extra);
      if (!updated) throw new NotFoundError(entity, id);
      const tableName = entity === 'checklist' ? 'checklists' : entity === 'task' ? 'tasks' : 'incidents';
      await this.audit.record(this.auditEvent(p, `operations_${entity}_${input.status}`, tableName, id, before.branchId, { status: before.status }, { status: input.status, note: input.note ?? null }), tx);
      return updated;
    });
  }
  transitionChecklist(p: Principal, id: string, raw: unknown) { return this.transition(p, id, raw, 'checklist'); }
  transitionTask(p: Principal, id: string, raw: unknown) { return this.transition(p, id, raw, 'task'); }
  transitionIncident(p: Principal, id: string, raw: unknown) { return this.transition(p, id, raw, 'incident'); }

  /* ---------- LABCASE (Operations-owned coordination record) ---------- */
  async createLabCase(p: Principal, raw: unknown) {
    this.assertAccess(p); const input = this.parse(labCaseInput, raw); const branchId = this.branch(p, input.branchId);
    const exec = async () => this.dbCtx.runAs(p, async tx => {
      const patient = await this.patients.getPatientById(tx, p.orgId, input.patientId);
      if (!patient) throw new ValidationError({ patientId: ['Unknown patient'] });
      if (patient.branchId !== branchId) throw new ForbiddenError('Patient is outside the requested branch');
      if (input.encounterId) {
        const enc = await this.clinical.getEncounterById(tx, p.orgId, input.encounterId);
        if (!enc) throw new ValidationError({ encounterId: ['Unknown encounter'] });
        if (enc.patientId !== input.patientId) throw new ValidationError({ encounterId: ['Encounter does not belong to the patient'] });
      }
      const row = await this.repo.createLabCase(tx, { orgId: p.orgId, branchId, patientId: input.patientId, encounterId: input.encounterId ?? null, labVendor: input.labVendor, workDescription: input.workDescription, dueDate: input.dueDate ?? null, createdBy: p.staffId, updatedBy: p.staffId });
      await this.audit.record(this.auditEvent(p, 'lab_case_created', 'lab_cases', row.id, branchId), tx);
      return row;
    });
    if (!input.idempotencyKey) return exec();
    const scope = `operations:labcase:${p.orgId}:${branchId}:${input.patientId}`;
    const result = await this.idempotency.execute(input.idempotencyKey, scope, exec);
    if (result.inProgress || !result.result) throw new ConflictError('Lab case creation is already in progress');
    return result.result;
  }
  async listLabCases(p: Principal, branchId?: string) { this.assertAccess(p); return this.dbCtx.runAs(p, tx => this.repo.listLabCases(tx, p.orgId, this.scoped(p, branchId))); }

  async transitionLabCase(p: Principal, id: string, raw: unknown) {
    this.assertAccess(p); const input = this.parse(statusInput, raw);
    return this.dbCtx.runAs(p, async tx => {
      const before = await this.repo.findLabCase(tx, p.orgId, id);
      if (!before) throw new NotFoundError('labCase', id);
      this.branch(p, before.branchId);
      const transitions: Record<string, readonly string[]> = {
        open: ['in_progress', 'cancelled'],
        in_progress: ['ready_for_billing', 'cancelled'],
        ready_for_billing: ['billing_submitted', 'cancelled'],
        billing_submitted: ['completed'],
        completed: [],
        cancelled: [],
      };
      if (before.status !== input.status && !(transitions[before.status] ?? []).includes(input.status)) throw new ConflictError(`Illegal transition ${before.status} → ${input.status}`);
      if (before.status === input.status) return before;
      const extra: Record<string, unknown> = {};
      if (input.status === 'billing_submitted') { extra.billingSubmittedAt = new Date(); extra.billingSubmittedBy = p.staffId; }
      const updated = await this.repo.updateStatus(tx, labCases, p.orgId, id, input.status, extra);
      if (!updated) throw new NotFoundError('labCase', id);
      await this.audit.record(this.auditEvent(p, `lab_case_${input.status}`, 'lab_cases', id, before.branchId, { status: before.status }, { status: input.status }), tx);
      return updated;
    });
  }
}
