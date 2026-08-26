import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import { InsurancesRepository } from '../infrastructure/insurances.repository';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { canTransition } from '../domain/payor-status';
import { normalizePayorName } from '../domain/normalize-name';
import { InsuranceCompany } from '../../../infrastructure/database/schema';

const createInsuranceSchema = z.object({
  name: z.string().trim().min(2).max(256),
  pic: z.string().trim().max(256).nullish(),
  phone: z.string().max(64).nullish(),
  address: z.string().max(2000).nullish(),
});

const updateInsuranceSchema = z.object({
  name: z.string().trim().min(2).max(256).optional(),
  pic: z.string().trim().max(256).nullish(),
  phone: z.string().max(64).nullish(),
  address: z.string().max(2000).nullish(),
});

const statusSchema = z.object({
  status: z.enum(['Active', 'Inactive']),
});

/**
 * InsurancesService — Insurance master data application layer (Sprint 2A T4).
 * Mirrors PanelsService: org-wide master data (no branch context), HQ-only
 * writes (RLS WITH CHECK as DB backstop), org_id always from the Principal,
 * every mutation + audit on the SAME runAs() transaction.
 * NOTE: no built-in library / clone for Insurance (none required).
 */
@Injectable()
export class InsurancesService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: InsurancesRepository,
    private readonly audit: AuditService,
  ) {}

  private assertCanWrite(p: Principal): void {
    if (p.role !== 'hq') {
      throw new ForbiddenError('Only HQ can manage insurance master data');
    }
  }

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }

  async create(principal: Principal, raw: unknown): Promise<InsuranceCompany> {
    this.assertCanWrite(principal);
    const parsed = createInsuranceSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const name = normalizePayorName(input.name);
    if (!name) throw new ValidationError({ name: ['name is required'] });

    return this.dbCtx.runAs(principal, async (tx) => {
      const existing = await this.repo.findByName(tx, principal.orgId, name);
      if (existing) throw new ConflictError('Insurance name already exists');
      const code = await new OrgAllocator(tx).nextInsuranceCode(principal.orgId);
      const ins = await this.repo.create(tx, principal.orgId, { ...input, name, code, source: 'custom' });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'insurance_created', entity: 'insurance_companies', entityId: ins.id,
        orgId: principal.orgId, branchId: null, source: 'api',
        after: { code: ins.code, name: ins.name, source: 'custom' },
      }, tx);
      return ins;
    });
  }

  async getById(principal: Principal, id: string): Promise<InsuranceCompany> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const ins = await this.repo.findById(tx, principal.orgId, id);
      if (!ins) throw new NotFoundError('Insurance', id);
      return ins;
    });
  }

  async search(principal: Principal, q?: string, limit?: number, offset?: number): Promise<InsuranceCompany[]> {
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.search(tx, principal.orgId, { q, limit, offset }));
  }

  async update(principal: Principal, id: string, raw: unknown): Promise<InsuranceCompany> {
    this.assertCanWrite(principal);
    const parsed = updateInsuranceSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    if (input.name !== undefined) {
      const n = normalizePayorName(input.name);
      if (!n) throw new ValidationError({ name: ['name must not be empty'] });
      input.name = n;
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Insurance', id);
      if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
        const dup = await this.repo.findByName(tx, principal.orgId, input.name);
        if (dup && dup.id !== id) throw new ConflictError('Insurance name already exists');
      }
      const updated = await this.repo.update(tx, principal.orgId, id, input);
      if (!updated) throw new NotFoundError('Insurance', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'insurance_updated', entity: 'insurance_companies', entityId: id,
        orgId: principal.orgId, branchId: null, source: 'api',
        before: {
          name: before.name, pic: before.pic, phone: before.phone, address: before.address,
        },
        after: {
          name: updated.name, pic: updated.pic, phone: updated.phone, address: updated.address,
        },
      }, tx);
      return updated;
    });
  }

  async changeStatus(principal: Principal, id: string, raw: unknown): Promise<InsuranceCompany> {
    this.assertCanWrite(principal);
    const parsed = statusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Insurance', id);
      if (!canTransition(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before; /* no-op: no mutation, no audit */
      const updated = await this.repo.updateStatus(tx, principal.orgId, id, target);
      if (!updated) throw new NotFoundError('Insurance', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: target === 'Active' ? 'insurance_activated' : 'insurance_deactivated',
        entity: 'insurance_companies', entityId: id,
        orgId: principal.orgId, branchId: null, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }
}
