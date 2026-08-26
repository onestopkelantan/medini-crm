import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../../../shared/errors/errors';
import { SettingsRepository } from '../infrastructure/settings.repository';
import {
  resolveEffective, validateValueType, ScopeLevel,
} from '../domain/settings-lifecycle';

const scopeEnum = z.enum(['system', 'organization', 'branch', 'role', 'feature']);
const valueTypeEnum = z.enum(['string', 'number', 'boolean', 'json']);

const definitionInput = z.object({
  key: z.string().trim().min(1).max(128).regex(/^[a-z0-9_.-]+$/, 'lowercase key form'),
  valueType: valueTypeEnum,
  description: z.string().trim().max(1024).nullish(),
  category: z.string().trim().max(64).nullish(),
  defaultValue: z.unknown().optional(),
  allowedScopes: z.array(scopeEnum).min(1).optional(),
  branchOverridable: z.boolean().optional(),
  locked: z.boolean().optional(),
});
const setValueInput = z.object({
  value: z.unknown(),
  scope: scopeEnum,
  scopeRef: z.string().trim().max(128).nullish(),
  reason: z.string().trim().min(2).max(512),
});
const secretRefInput = z.object({
  key: z.string().trim().min(1).max(128),
  vaultPath: z.string().trim().min(1).max(256),
  lastFour: z.string().trim().max(8).nullish(),
  status: z.enum(['ABSENT', 'REGISTERED', 'ROTATED', 'REVOKED']).optional(),
}).passthrough(); /* passthrough so the raw-secret hard guard can inspect extra keys */

/* P3 hardening — secret-looking keys that must NEVER appear in a SecretRef
 * payload (they indicate an actual secret value is being smuggled in). */
const FORBIDDEN_SECRET_KEYS = ['value', 'secret', 'apiKey', 'api_key', 'token', 'accessToken', 'access_token', 'clientSecret', 'client_secret', 'password', 'privateKey', 'private_key'];

/**
 * SettingsService — configuration governance (Sprint 7 T2).
 * Registry + hierarchical scopes + versioned values + inheritance resolution +
 * SecretRef metadata (NO secret values, approved G9).
 *
 * RBAC (canonical matrix): hq view/edit/approve; branch_manager view + own-branch
 * override; branch_admin/receptionist/doctor view only. PermissionGuard enforces
 * the route; the service enforces scope rules (defense-in-depth); RLS is the DB
 * backstop.
 *
 * Invariants:
 *  - Non-overridable (branch_overridable=false) rejects branch/role/feature override.
 *  - Locked config requires HQ + reason.
 *  - Every change = new value row (version++) + immutable version history + audit.
 *  - SecretRef NEVER stores a secret value — only vault path/metadata.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new ValidationError(Object.fromEntries(result.error.issues.map((x) => [x.path.join('.'), [x.message]])));
    return result.data;
  }
  private auditEvent(p: Principal, action: string, entity: string, id: string, branchId: string | null, before?: Record<string, unknown>, after?: Record<string, unknown>) {
    return { actorId: p.staffId, actorRole: p.role, action, entity, entityId: id, orgId: p.orgId, branchId, source: 'api' as const, before, after };
  }

  /* ==========================================================================
     DEFINITIONS (registry) — HQ-managed
     ==========================================================================*/
  async listDefinitions(p: Principal, category?: string) {
    return this.dbCtx.runAs(p, (tx) => this.repo.listDefinitions(tx, p.orgId, category));
  }

  async createDefinition(p: Principal, raw: unknown) {
    if (p.role !== 'hq') throw new ForbiddenError('Only HQ may register configuration definitions');
    const input = this.parse(definitionInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const existing = await this.repo.findDefinition(tx, p.orgId, input.key);
      if (existing) throw new ConflictError(`Setting '${input.key}' is already registered`);
      const row = await this.repo.createDefinition(tx, {
        orgId: p.orgId, key: input.key, valueType: input.valueType,
        description: input.description ?? null, category: input.category ?? null,
        defaultValue: (input.defaultValue ?? null) as never,
        allowedScopes: (input.allowedScopes ?? ['system', 'organization', 'branch']) as never,
        branchOverridable: input.branchOverridable ?? true,
        locked: input.locked ?? false,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'settings_definition_created', 'settings_definitions', row.id, null, undefined, { key: input.key }), tx);
      return row;
    });
  }

  /* ==========================================================================
     VALUES — scoped set + effective resolution
     ==========================================================================*/
  /** Effective value for a key in the caller's context (branch/role/feature). */
  async getEffective(p: Principal, key: string, ctx: { branchId?: string; role?: string; feature?: string } = {}) {
    return this.dbCtx.runAs(p, async (tx) => {
      const def = await this.repo.findDefinition(tx, p.orgId, key);
      if (!def) throw new NotFoundError('setting', key);
      const values = await this.repo.listValuesForKey(tx, p.orgId, key);
      /* Resolve using the request context; branch defaults to caller's branch. */
      const resolved = resolveEffective(
        values.map((v) => ({ scope: v.scope as ScopeLevel, scopeRef: v.scopeRef, value: v.value })),
        { branchId: ctx.branchId ?? p.branchId, role: ctx.role ?? p.role, feature: ctx.feature ?? null },
        def.defaultValue,
      );
      return { key, value: resolved.value, scope: resolved.scope, valueType: def.valueType, default: def.defaultValue };
    });
  }

  /** Set a value at a scope. Enforces override + locked + RBAC scope rules. */
  async setValue(p: Principal, key: string, raw: unknown) {
    const input = this.parse(setValueInput, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const def = await this.repo.findDefinition(tx, p.orgId, key);
      if (!def) throw new NotFoundError('setting', key);

      /* Type validation */
      const typeErr = validateValueType(def.valueType, input.value);
      if (typeErr) throw new ValidationError({ value: [`Invalid value for type '${def.valueType}': ${typeErr}`] });

      /* Scope allowed by definition */
      if (!(def.allowedScopes as string[]).includes(input.scope)) {
        throw new ValidationError({ scope: [`Setting '${key}' cannot be set at scope '${input.scope}'`] });
      }

      /* RBAC scope rules (service-level, defense-in-depth over the matrix):
       *  - hq may set any scope.
       *  - branch_manager may set ONLY branch scope for their own branch.
       *  - others may not set. */
      const scopeRef = input.scope === 'branch' ? (input.scopeRef ?? p.branchId) : (input.scopeRef ?? null);
      if (p.role === 'hq') {
        /* hq unrestricted */
      } else if (p.role === 'branch_manager') {
        if (input.scope !== 'branch') throw new ForbiddenError('Branch Manager may only set branch-scoped values');
        if (scopeRef !== p.branchId) throw new ForbiddenError('Branch Manager may only configure their own branch');
      } else {
        throw new ForbiddenError('Your role may only view configuration');
      }

      /* Non-overridable: only system/organization scopes may hold a value. */
      if (!def.branchOverridable && (input.scope === 'branch' || input.scope === 'role' || input.scope === 'feature')) {
        throw new ForbiddenError(`Setting '${key}' is non-overridable at ${input.scope} level`);
      }
      /* Locked config: HQ only + reason (already have reason). */
      if (def.locked && p.role !== 'hq') {
        throw new ForbiddenError(`Setting '${key}' is locked (HQ-only)`);
      }

      const before = await this.repo.findValue(tx, p.orgId, key, input.scope, scopeRef);
      const updated = await this.repo.upsertValue(tx, p.orgId, key, input.scope, scopeRef, input.value, p.staffId);
      await this.repo.createVersion(tx, {
        orgId: p.orgId, key, scope: input.scope, scopeRef,
        oldValue: (before?.value ?? null) as never, newValue: input.value as never,
        version: updated.version, changedBy: p.staffId, reason: input.reason,
      });
      await this.audit.record(
        this.auditEvent(p, 'settings_value_set', 'settings_values', updated.id, scopeRef,
          { value: before?.value ?? null }, { value: input.value, scope: input.scope, reason: input.reason }), tx);
      return updated;
    });
  }

  /** Version history for a key (read). */
  async getVersions(p: Principal, key: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const def = await this.repo.findDefinition(tx, p.orgId, key);
      if (!def) throw new NotFoundError('setting', key);
      return this.repo.listVersions(tx, p.orgId, key);
    });
  }

  /* ==========================================================================
     SECRET REFS (metadata ONLY — approved G9). HQ-only. No secret values.
     ==========================================================================*/
  async listSecretRefs(p: Principal) {
    if (p.role !== 'hq') throw new ForbiddenError('Secret references are HQ-only');
    return this.dbCtx.runAs(p, (tx) => this.repo.listSecretRefs(tx, p.orgId));
  }

  async registerSecretRef(p: Principal, raw: unknown) {
    if (p.role !== 'hq') throw new ForbiddenError('Secret references are HQ-only');
    const input = this.parse(secretRefInput, raw);
    /* Hard guard: never accept anything resembling a raw secret value (P3:
     * extended to common secret-carrying key names). */
    const body = input as Record<string, unknown>;
    const smuggled = FORBIDDEN_SECRET_KEYS.find((k) => body[k] !== undefined);
    if (smuggled) {
      throw new ValidationError({ [smuggled]: [`Secret VALUES are never stored — '${smuggled}' is forbidden; provide vaultPath metadata only`] });
    }
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.upsertSecretRef(tx, {
        orgId: p.orgId, key: input.key, vaultPath: input.vaultPath,
        lastFour: input.lastFour ?? null, status: input.status ?? 'REGISTERED',
        rotatedAt: input.status === 'ROTATED' ? new Date() : null,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(this.auditEvent(p, 'secret_ref_registered', 'secret_refs', row.id, null, undefined, { key: input.key, status: row.status }), tx);
      return row;
    });
  }
}
