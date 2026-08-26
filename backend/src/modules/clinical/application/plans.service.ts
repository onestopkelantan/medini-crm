import { Injectable, Inject } from '@nestjs/common';
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
import { canTransitionPlan, transitionStamp, PlanStatus } from '../domain/plan-lifecycle';
import { evaluateConsentGate } from '../domain/consent-gate';
import { parseFdi } from '../domain/fdi';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import { DATABASE } from '../../../infrastructure/database/database.module';
import { Database } from '../../../infrastructure/database/database';
import { domainEvents, TreatmentPlan, TreatmentPlanItem, TreatmentSession } from '../../../infrastructure/database/schema';
import { ScopedOutboxDispatcher } from '../../../infrastructure/outbox/outbox.dispatcher';
import { ScopedOutboxEvent } from '../../../infrastructure/outbox/outbox.types';

const createPlanSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().nullish(),
  title: z.string().trim().min(3).max(256),
  consentRequired: z.boolean().optional(),
  items: z.array(z.object({
    treatmentId: z.string().uuid().nullish(),
    description: z.string().trim().min(2).max(256),
    toothFdi: z.union([z.number().int(), z.string().regex(/^\d{2}$/)]).nullish(),
    quantity: z.number().int().positive().max(99).optional(),
  })).min(1).max(50),
});

const statusSchema = z.object({
  status: z.enum(['draft', 'proposed', 'accepted', 'active', 'completed', 'cancelled']),
  cancelReason: z.string().trim().max(512).nullish(),
});

const addItemSchema = z.object({
  treatmentId: z.string().uuid().nullish(),
  description: z.string().trim().min(2).max(256),
  toothFdi: z.union([z.number().int(), z.string().regex(/^\d{2}$/)]).nullish(),
  quantity: z.number().int().positive().max(99).optional(),
});

const itemStatusSchema = z.object({ status: z.enum(['pending', 'done']) });

const sessionSchema = z.object({
  encounterId: z.string().uuid().nullish(),
  summary: z.string().trim().min(2).max(1024).nullish(),
});

/**
 * PlansService — treatment plan lifecycle (Sprint 3 S3-C/D).
 * Lifecycle (Blueprint §28): draft→proposed→accepted→active→completed|cancelled.
 *  - consent_required plans cannot be ACCEPTED without a consent record (gate)
 *  - accepted→active emits TREATMENT_STARTED (outbox, same tx)
 *  - active→completed requires 0 pending items; emits TREATMENT_COMPLETED
 *    (emit-only — no Finance consumer exists yet; ADR-004 preserved)
 *  - strict doctor own-scope; hq/bm read-only via matrix + RLS
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly core: ClinicalCoreRepository,
    private readonly ext: ClinicalExtendedRepository,
    private readonly patients: PatientsReadPort,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Database | null,
    private readonly dispatcher?: ScopedOutboxDispatcher,
  ) {}

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }

  private assertDoctor(p: Principal): asserts p is Principal & { doctorId: string; branchId: string } {
    if (p.role !== 'doctor' || !p.doctorId || !p.branchId) {
      throw new ForbiddenError('Only doctors can create or modify clinical records');
    }
  }

  private assertCanView(p: Principal, plan: TreatmentPlan): void {
    if (p.role === 'doctor' && plan.doctorId !== p.doctorId) throw new NotFoundError('TreatmentPlan', plan.id);
    if (p.role === 'branch_manager' && p.branchId && plan.branchId !== p.branchId) {
      throw new NotFoundError('TreatmentPlan', plan.id);
    }
  }

  /** Persists the source-of-truth event in the business transaction. Dispatch is
   * deliberately post-commit; recovery re-enqueues an unpublished event safely. */
  private async emit(tx: Database, p: Principal, branchId: string, eventType: string, data: Record<string, unknown>): Promise<ScopedOutboxEvent> {
    const correlationId = getCorrelationId();
    const [row] = await tx.insert(domainEvents).values({
      orgId: p.orgId, branchId, eventType, payload: { ...data }, correlationId,
    }).returning();
    return { eventId: row!.id, eventType, orgId: p.orgId, branchId, correlationId, source: 'domain', payload: data };
  }

  async create(principal: Principal, raw: unknown): Promise<{ plan: TreatmentPlan; items: TreatmentPlanItem[] }> {
    this.assertDoctor(principal);
    const parsed = createPlanSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patients.getPatientById(tx, principal.orgId, input.patientId);
      if (!patient) throw new NotFoundError('Patient', input.patientId);
      if (patient.branchId !== principal.branchId) {
        throw new ForbiddenError('Patient belongs to a different branch');
      }

      /* Encounter linkage (optional) must be the caller's own encounter. */
      let encounterId: string | null = null;
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc || enc.doctorId !== principal.doctorId) throw new NotFoundError('Encounter', input.encounterId);
        encounterId = enc.id;
      }

      /* Catalog references must exist (reference data — NO pricing here). */
      for (const item of input.items) {
        if (item.treatmentId) {
          const t = await this.core.findCatalogById(tx, principal.orgId, item.treatmentId);
          if (!t) throw new ValidationError({ treatmentId: [`Unknown treatment: ${item.treatmentId}`] });
        }
        if (item.toothFdi != null && parseFdi(item.toothFdi) == null) {
          throw new ValidationError({ toothFdi: ['Invalid FDI tooth number (permanent 11–48)'] });
        }
      }

      const code = await new OrgAllocator(tx).nextPlanCode(principal.orgId);
      const plan = await this.core.createPlan(tx, principal.orgId, {
        planCode: code, branchId: patient.branchId, patientId: patient.id,
        encounterId, doctorId: principal.doctorId, title: input.title,
        consentRequired: input.consentRequired ?? false, status: 'draft',
        createdBy: principal.staffId,
      });
      const items: TreatmentPlanItem[] = [];
      for (const item of input.items) {
        items.push(await this.core.createPlanItem(tx, principal.orgId, {
          planId: plan.id, treatmentId: item.treatmentId ?? null,
          description: item.description,
          toothFdi: item.toothFdi != null ? parseFdi(item.toothFdi) : null,
          quantity: item.quantity ?? 1, createdBy: principal.staffId,
        }));
      }

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'plan_created', entity: 'treatment_plans', entityId: plan.id,
        orgId: principal.orgId, branchId: plan.branchId, source: 'api',
        after: { code: plan.planCode, title: plan.title, itemCount: items.length, consentRequired: plan.consentRequired },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: plan.patientId, type: 'plan_created',
        summary: `Treatment plan ${plan.planCode} drafted`,
        payload: { planId: plan.id, code: plan.planCode },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return { plan, items };
    });
  }

  async getById(principal: Principal, id: string): Promise<{ plan: TreatmentPlan; items: TreatmentPlanItem[]; sessions: TreatmentSession[] }> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const plan = await this.core.findPlanById(tx, principal.orgId, id);
      if (!plan) throw new NotFoundError('TreatmentPlan', id);
      this.assertCanView(principal, plan);
      const items = await this.core.listPlanItems(tx, principal.orgId, plan.id);
      const sessions = await this.core.listSessions(tx, principal.orgId, plan.id);
      return { plan, items, sessions };
    });
  }

  async search(principal: Principal, q: {
    patientId?: string; branchId?: string; status?: string; limit?: number; offset?: number;
  }): Promise<TreatmentPlan[]> {
    return this.dbCtx.runAs(principal, async (tx) => this.core.searchPlans(tx, principal.orgId, {
      doctorId: principal.role === 'doctor' ? principal.doctorId : null,
      branchId: principal.role === 'hq' ? (q.branchId ?? null) : principal.branchId,
      patientId: q.patientId ?? null,
      status: (q.status as PlanStatus | undefined) ?? null,
      limit: q.limit, offset: q.offset,
    }));
  }

  async changeStatus(principal: Principal, id: string, raw: unknown): Promise<TreatmentPlan> {
    this.assertDoctor(principal);
    const parsed = statusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    const committed = await this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.core.findPlanById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('TreatmentPlan', id);
      if (before.doctorId !== principal.doctorId) throw new NotFoundError('TreatmentPlan', id);
      if (!canTransitionPlan(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return { updated: before, event: null }; /* no-op: no mutation/audit/event */

      /* Consent gate: consent_required plans need a consent record first. */
      if (target === 'accepted') {
        const consents = await this.ext.countConsentsForPlan(tx, principal.orgId, id);
        const verdict = evaluateConsentGate({
          consentRequired: before.consentRequired, recordedConsentCount: consents,
        });
        if (!verdict.allowed) {
          throw new ConflictError(`Consent gate blocked acceptance: ${verdict.blockers.join(', ')}`);
        }
      }
      /* Completion requires all items done. */
      if (target === 'completed') {
        const pending = await this.core.countPendingItems(tx, principal.orgId, id);
        if (pending > 0) {
          throw new ConflictError(`Cannot complete plan with ${pending} pending item(s)`);
        }
      }

      const stampKey = transitionStamp(target);
      const stamp = stampKey ? { [stampKey]: new Date() } : {};
      const updated = await this.core.updatePlanStatus(tx, principal.orgId, id, {
        status: target, stamp,
        cancelReason: target === 'cancelled' ? (parsed.data.cancelReason ?? null) : undefined,
        updatedBy: principal.staffId,
      });
      if (!updated) throw new NotFoundError('TreatmentPlan', id);

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'plan_status_changed', entity: 'treatment_plans', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: before.patientId, type: 'plan_status_changed',
        summary: `Plan ${before.planCode}: ${before.status} → ${target}`,
        payload: { planId: id, code: before.planCode, from: before.status, to: target },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });

      let event: ScopedOutboxEvent | null = null;
      if (target === 'active') {
        event = await this.emit(tx as unknown as Database, principal, before.branchId, 'TREATMENT_STARTED', {
          planId: id, planCode: before.planCode, patientId: before.patientId,
          doctorId: before.doctorId, encounterId: before.encounterId,
        });
      }
      if (target === 'completed') {
        event = await this.emit(tx as unknown as Database, principal, before.branchId, 'TREATMENT_COMPLETED', {
          planId: id, planCode: before.planCode, patientId: before.patientId,
          doctorId: before.doctorId, encounterId: before.encounterId,
        });
      }
      return { updated, event };
    });
    if (committed.event) {
      try { await this.dispatcher?.dispatch(committed.event); }
      catch { /* Committed event remains unpublished; scoped recovery re-enqueues it. */ }
    }
    return committed.updated;
  }

  async addItem(principal: Principal, planId: string, raw: unknown): Promise<TreatmentPlanItem> {
    this.assertDoctor(principal);
    const parsed = addItemSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    if (input.toothFdi != null && parseFdi(input.toothFdi) == null) {
      throw new ValidationError({ toothFdi: ['Invalid FDI tooth number (permanent 11–48)'] });
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const plan = await this.core.findPlanById(tx, principal.orgId, planId);
      if (!plan || plan.doctorId !== principal.doctorId) throw new NotFoundError('TreatmentPlan', planId);
      if (plan.status !== 'draft' && plan.status !== 'proposed') {
        throw new ConflictError(`Items cannot be added while plan is ${plan.status}`);
      }
      if (input.treatmentId) {
        const t = await this.core.findCatalogById(tx, principal.orgId, input.treatmentId);
        if (!t) throw new ValidationError({ treatmentId: [`Unknown treatment: ${input.treatmentId}`] });
      }
      const item = await this.core.createPlanItem(tx, principal.orgId, {
        planId, treatmentId: input.treatmentId ?? null, description: input.description,
        toothFdi: input.toothFdi != null ? parseFdi(input.toothFdi) : null,
        quantity: input.quantity ?? 1, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'plan_item_added', entity: 'treatment_plan_items', entityId: item.id,
        orgId: principal.orgId, branchId: plan.branchId, source: 'api',
        after: { planId, description: item.description },
      }, tx);
      return item;
    });
  }

  async setItemStatus(principal: Principal, itemId: string, raw: unknown): Promise<TreatmentPlanItem> {
    this.assertDoctor(principal);
    const parsed = itemStatusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);

    return this.dbCtx.runAs(principal, async (tx) => {
      const item = await this.core.findPlanItemById(tx, principal.orgId, itemId);
      if (!item) throw new NotFoundError('TreatmentPlanItem', itemId);
      const plan = await this.core.findPlanById(tx, principal.orgId, item.planId);
      if (!plan || plan.doctorId !== principal.doctorId) throw new NotFoundError('TreatmentPlanItem', itemId);
      if (plan.status !== 'active') {
        throw new ConflictError('Items can only be completed while the plan is active');
      }
      if (item.status === parsed.data.status) return item; /* no-op */
      const updated = await this.core.setPlanItemStatus(tx, principal.orgId, itemId, parsed.data.status, principal.staffId);
      if (!updated) throw new NotFoundError('TreatmentPlanItem', itemId);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'plan_item_status_changed', entity: 'treatment_plan_items', entityId: itemId,
        orgId: principal.orgId, branchId: plan.branchId, source: 'api',
        before: { status: item.status }, after: { status: parsed.data.status },
      }, tx);
      return updated;
    });
  }

  async recordSession(principal: Principal, planId: string, raw: unknown): Promise<TreatmentSession> {
    this.assertDoctor(principal);
    const parsed = sessionSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);

    return this.dbCtx.runAs(principal, async (tx) => {
      const plan = await this.core.findPlanById(tx, principal.orgId, planId);
      if (!plan || plan.doctorId !== principal.doctorId) throw new NotFoundError('TreatmentPlan', planId);
      if (plan.status !== 'active') {
        throw new ConflictError('Sessions can only be recorded while the plan is active');
      }
      const sessionNo = await this.core.nextSessionNo(tx, principal.orgId, planId);
      const session = await this.core.createSession(tx, principal.orgId, {
        planId, encounterId: parsed.data.encounterId ?? plan.encounterId,
        doctorId: principal.doctorId, sessionNo,
        summary: parsed.data.summary ?? null, createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'treatment_session_recorded', entity: 'treatment_sessions', entityId: session.id,
        orgId: principal.orgId, branchId: plan.branchId, source: 'api',
        after: { planId, sessionNo },
      }, tx);
      return session;
    });
  }

  /* used only to satisfy the injected DATABASE token wiring check */
  protected databaseAvailable(): boolean { return this.db != null; }
}
