import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../shared/errors/errors';
import { FinanceConfigRepository } from '../infrastructure/finance-config.repository';
import { ExpenseCategory, PaymentMethod, FinanceAlertRule } from '../../../infrastructure/database/schema';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal');
const managedStatus = z.object({ status: z.enum(['active', 'archived']) });

const categoryCreate = z.object({
  branchId: uuid,
  name: z.string().trim().min(1).max(128),
  code: z.string().trim().max(64).nullish(),
  description: z.string().trim().max(256).nullish(),
});

const methodCreate = z.object({
  branchId: uuid,
  name: z.string().trim().min(1).max(128),
  kind: z.string().trim().max(32).nullish(), /* cash | card | bank_transfer | ewallet | other */
  details: z.string().trim().max(256).nullish(),
});

const severityEnum = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const comparatorEnum = z.enum(['lt', 'lte', 'gt', 'gte', 'eq']);

const ruleCreate = z.object({
  branchId: uuid,
  name: z.string().trim().min(1).max(256),
  metric: z.string().trim().min(1).max(64),   /* e.g. expense_due | revenue_below | payable_overdue */
  comparator: comparatorEnum,
  threshold: money,
  severity: severityEnum,
  windowDays: z.number().int().positive().max(3650).nullish(),
  active: z.boolean().optional(),
});

const ruleUpdate = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  metric: z.string().trim().min(1).max(64).optional(),
  comparator: comparatorEnum.optional(),
  threshold: money.optional(),
  severity: severityEnum.optional(),
  windowDays: z.number().int().positive().max(3650).nullish(),
  active: z.boolean().optional(),
});

/**
 * FinanceConfigService — managed finance config: expense categories, payment
 * methods, and alert-rule definitions.
 *
 * Access mirrors FinanceService: HQ + branch_manager may VIEW; only HQ may
 * create/edit (matches ROLE_DOMAIN_MATRIX.finance — branch_manager has no
 * create/edit, so the guard already blocks their writes; managers are pinned
 * to their own branch for reads).
 */
@Injectable()
export class FinanceConfigService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: FinanceConfigRepository,
    private readonly audit: AuditService,
  ) {}

  private assertAccess(p: Principal): void {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Finance access is restricted to HQ and branch managers');
    }
  }
  private resolveBranch(p: Principal, requested: string): string {
    if (p.role === 'hq') return requested;
    if (p.branchId && requested !== p.branchId) {
      throw new ForbiddenError('Branch manager cannot write outside own branch');
    }
    return requested;
  }
  private scopedBranch(p: Principal, requested?: string | null): string | null {
    return p.role === 'hq' ? (requested ?? null) : p.branchId;
  }
  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const r = schema.safeParse(raw);
    if (!r.success) {
      throw new ValidationError(Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), [i.message]])));
    }
    return r.data;
  }
  private auditEvent(p: Principal, action: string, entity: string, id: string, branchId: string, before?: Record<string, unknown>, after?: Record<string, unknown>) {
    return { actorId: p.staffId, actorRole: p.role, action, entity, entityId: id, orgId: p.orgId, branchId, source: 'api' as const, before, after };
  }

  /* ---------- expense categories ---------- */
  listCategories(p: Principal, q: { status?: string; branchId?: string }): Promise<ExpenseCategory[]> {
    this.assertAccess(p);
    return this.dbCtx.runAs(p, (tx) => this.repo.listCategories(tx, p.orgId, this.scopedBranch(p, q.branchId), q.status));
  }
  createCategory(p: Principal, raw: unknown): Promise<ExpenseCategory> {
    this.assertAccess(p);
    const input = this.parse(categoryCreate, raw);
    const branchId = this.resolveBranch(p, input.branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createCategory(tx, {
        orgId: p.orgId, branchId, name: input.name,
        code: input.code ?? null, description: input.description ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'finance_expense_category_created', 'expense_categories', row.id, branchId, undefined, { name: row.name }), tx);
      return row;
    });
  }
  setCategoryStatus(p: Principal, id: string, raw: unknown): Promise<ExpenseCategory> {
    this.assertAccess(p);
    const { status } = this.parse(managedStatus, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findCategory(tx, p.orgId, id);
      if (!before) throw new NotFoundError('expense_category', id);
      this.resolveBranch(p, before.branchId);
      if (before.status === status) return before;
      const updated = await this.repo.updateCategory(tx, p.orgId, id, { status });
      if (!updated) throw new NotFoundError('expense_category', id);
      await this.audit.record(this.auditEvent(p, 'finance_expense_category_status_changed', 'expense_categories', id, before.branchId, { status: before.status }, { status }), tx);
      return updated;
    });
  }

  /* ---------- payment methods ---------- */
  listMethods(p: Principal, q: { status?: string; branchId?: string }): Promise<PaymentMethod[]> {
    this.assertAccess(p);
    return this.dbCtx.runAs(p, (tx) => this.repo.listMethods(tx, p.orgId, this.scopedBranch(p, q.branchId), q.status));
  }
  createMethod(p: Principal, raw: unknown): Promise<PaymentMethod> {
    this.assertAccess(p);
    const input = this.parse(methodCreate, raw);
    const branchId = this.resolveBranch(p, input.branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createMethod(tx, {
        orgId: p.orgId, branchId, name: input.name,
        kind: input.kind ?? null, details: input.details ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'finance_payment_method_created', 'payment_methods', row.id, branchId, undefined, { name: row.name }), tx);
      return row;
    });
  }
  setMethodStatus(p: Principal, id: string, raw: unknown): Promise<PaymentMethod> {
    this.assertAccess(p);
    const { status } = this.parse(managedStatus, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findMethod(tx, p.orgId, id);
      if (!before) throw new NotFoundError('payment_method', id);
      this.resolveBranch(p, before.branchId);
      if (before.status === status) return before;
      const updated = await this.repo.updateMethod(tx, p.orgId, id, { status });
      if (!updated) throw new NotFoundError('payment_method', id);
      await this.audit.record(this.auditEvent(p, 'finance_payment_method_status_changed', 'payment_methods', id, before.branchId, { status: before.status }, { status }), tx);
      return updated;
    });
  }

  /* ---------- alert rules ---------- */
  listRules(p: Principal, q: { branchId?: string }): Promise<FinanceAlertRule[]> {
    this.assertAccess(p);
    return this.dbCtx.runAs(p, (tx) => this.repo.listRules(tx, p.orgId, this.scopedBranch(p, q.branchId)));
  }
  createRule(p: Principal, raw: unknown): Promise<FinanceAlertRule> {
    this.assertAccess(p);
    const input = this.parse(ruleCreate, raw);
    const branchId = this.resolveBranch(p, input.branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createRule(tx, {
        orgId: p.orgId, branchId, name: input.name, metric: input.metric,
        comparator: input.comparator, threshold: input.threshold, severity: input.severity,
        windowDays: input.windowDays ?? null, active: input.active ?? true,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'finance_alert_rule_created', 'finance_alert_rules', row.id, branchId, undefined, { name: row.name, metric: row.metric, severity: row.severity }), tx);
      return row;
    });
  }
  updateRule(p: Principal, id: string, raw: unknown): Promise<FinanceAlertRule> {
    this.assertAccess(p);
    const input = this.parse(ruleUpdate, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findRule(tx, p.orgId, id);
      if (!before) throw new NotFoundError('finance_alert_rule', id);
      this.resolveBranch(p, before.branchId);

      const set: Record<string, unknown> = {};
      if (input.name !== undefined) set['name'] = input.name;
      if (input.metric !== undefined) set['metric'] = input.metric;
      if (input.comparator !== undefined) set['comparator'] = input.comparator;
      if (input.threshold !== undefined) set['threshold'] = input.threshold;
      if (input.severity !== undefined) set['severity'] = input.severity;
      if (input.windowDays !== undefined) set['windowDays'] = input.windowDays;
      if (input.active !== undefined) set['active'] = input.active;

      const updated = await this.repo.updateRule(tx, p.orgId, id, set);
      if (!updated) throw new NotFoundError('finance_alert_rule', id);
      await this.audit.record(this.auditEvent(p, 'finance_alert_rule_updated', 'finance_alert_rules', id, before.branchId, { name: before.name }, set), tx);
      return updated;
    });
  }
}
