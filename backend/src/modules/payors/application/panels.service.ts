import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import { PanelsRepository } from '../infrastructure/panels.repository';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { canTransition } from '../domain/payor-status';
import { normalizePayorName } from '../domain/normalize-name';
import { findBuiltinPanel, BUILTIN_PANEL_LIBRARY, BuiltinPanel } from '../domain/panel-library';
import { PanelCompany } from '../../../infrastructure/database/schema';

const createPanelSchema = z.object({
  name: z.string().trim().min(2).max(256),
  pic: z.string().trim().max(256).nullish(),
  phone: z.string().max(64).nullish(),
  address: z.string().max(2000).nullish(),
});

const updatePanelSchema = z.object({
  name: z.string().trim().min(2).max(256).optional(),
  pic: z.string().trim().max(256).nullish(),
  phone: z.string().max(64).nullish(),
  address: z.string().max(2000).nullish(),
});

const statusSchema = z.object({
  status: z.enum(['Active', 'Inactive']),
});

const cloneSchema = z.object({
  libraryKey: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(256).optional(),
});

/**
 * PanelsService — Panel master data application layer (Sprint 2A T3).
 *
 * Scope model (T1): payors are ORG-WIDE master data — no branch context is
 * required or consulted. Write operations are HQ-only (RLS WITH CHECK is the
 * DB backstop; the service asserts the role first for a clean 403). Reads are
 * allowed for hq + branch_manager (RLS USING). org_id is ALWAYS taken from
 * the authenticated Principal — never from the request body.
 *
 * Every mutation runs inside runAs() with the audit write on the SAME
 * transaction (Blocker-1 contract: audit failure rolls back the mutation).
 */
@Injectable()
export class PanelsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: PanelsRepository,
    private readonly audit: AuditService,
  ) {}

  /* Write operations are HQ-only (mirrors T1 RLS WITH CHECK). */
  private assertCanWrite(p: Principal): void {
    if (p.role !== 'hq') {
      throw new ForbiddenError('Only HQ can manage panel master data');
    }
  }

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }

  async create(principal: Principal, raw: unknown): Promise<PanelCompany> {
    this.assertCanWrite(principal);
    const parsed = createPanelSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const name = normalizePayorName(input.name);
    if (!name) throw new ValidationError({ name: ['name is required'] });

    return this.dbCtx.runAs(principal, async (tx) => {
      const existing = await this.repo.findByName(tx, principal.orgId, name);
      if (existing) throw new ConflictError('Panel name already exists');
      const code = await new OrgAllocator(tx).nextPanelCode(principal.orgId);
      const panel = await this.repo.create(tx, principal.orgId, { ...input, name, code, source: 'custom' });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'panel_created', entity: 'panel_companies', entityId: panel.id,
        orgId: principal.orgId, branchId: null, source: 'api',
        after: { code: panel.code, name: panel.name, source: 'custom' },
      }, tx);
      return panel;
    });
  }

  async getById(principal: Principal, id: string): Promise<PanelCompany> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const panel = await this.repo.findById(tx, principal.orgId, id);
      if (!panel) throw new NotFoundError('Panel', id);
      return panel;
    });
  }

  async search(principal: Principal, q?: string, limit?: number, offset?: number): Promise<PanelCompany[]> {
    return this.dbCtx.runAs(principal, async (tx) =>
      this.repo.search(tx, principal.orgId, { q, limit, offset }));
  }

  async update(principal: Principal, id: string, raw: unknown): Promise<PanelCompany> {
    this.assertCanWrite(principal);
    const parsed = updatePanelSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    if (input.name !== undefined) {
      const n = normalizePayorName(input.name);
      if (!n) throw new ValidationError({ name: ['name must not be empty'] });
      input.name = n;
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Panel', id);
      if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
        const dup = await this.repo.findByName(tx, principal.orgId, input.name);
        if (dup && dup.id !== id) throw new ConflictError('Panel name already exists');
      }
      const updated = await this.repo.update(tx, principal.orgId, id, input);
      if (!updated) throw new NotFoundError('Panel', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'panel_updated', entity: 'panel_companies', entityId: id,
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

  async changeStatus(principal: Principal, id: string, raw: unknown): Promise<PanelCompany> {
    this.assertCanWrite(principal);
    const parsed = statusSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const target = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Panel', id);
      if (!canTransition(before.status, target)) {
        throw new ConflictError(`Illegal transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before; /* no-op: no mutation, no audit */
      const updated = await this.repo.updateStatus(tx, principal.orgId, id, target);
      if (!updated) throw new NotFoundError('Panel', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: target === 'Active' ? 'panel_activated' : 'panel_deactivated',
        entity: 'panel_companies', entityId: id,
        orgId: principal.orgId, branchId: null, source: 'api',
        before: { status: before.status }, after: { status: target },
      }, tx);
      return updated;
    });
  }

  /** Static built-in library — read-only, no DB, no audit (view-only). */
  listLibrary(): BuiltinPanel[] {
    return [...BUILTIN_PANEL_LIBRARY];
  }

  async clone(principal: Principal, raw: unknown): Promise<PanelCompany> {
    this.assertCanWrite(principal);
    const parsed = cloneSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    const entry = findBuiltinPanel(input.libraryKey);
    if (!entry) throw new ValidationError({ libraryKey: ['Unknown built-in panel'] });
    const name = normalizePayorName(input.name ?? entry.name);
    if (!name) throw new ValidationError({ name: ['name is required'] });

    return this.dbCtx.runAs(principal, async (tx) => {
      const existing = await this.repo.findByName(tx, principal.orgId, name);
      if (existing) throw new ConflictError('Panel name already exists');
      const code = await new OrgAllocator(tx).nextPanelCode(principal.orgId);
      const panel = await this.repo.create(tx, principal.orgId, {
        code, name, pic: null, phone: null, address: entry.address, source: 'builtin',
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'panel_created', entity: 'panel_companies', entityId: panel.id,
        orgId: principal.orgId, branchId: null, source: 'api',
        after: { code: panel.code, name: panel.name, source: 'builtin', libraryKey: input.libraryKey },
      }, tx);
      return panel;
    });
  }
}
