import { Injectable } from '@nestjs/common';
import { DbContextService } from '../../core/auth/db-context.service';
import { Principal } from '../../core/auth/principal';
import { SettingsRepository } from '../../modules/settings/infrastructure/settings.repository';
import { resolveEffective, ScopeLevel } from '../../modules/settings/domain/settings-lifecycle';

/**
 * ConfigResolverPort — sanctioned CROSS-MODULE governance read boundary for
 * configuration (Sprint 7 T4). Lives in shared so any domain can resolve the
 * EFFECTIVE governed value for a key WITHOUT importing the settings module's
 * internals or touching its tables directly.
 *
 * Domain-neutral: "Is feature X enabled for branch B?" → resolve(key, ctx).
 * Read-only. The caller supplies a Principal (RLS context applies via runAs).
 */
@Injectable()
export class ConfigResolverPort {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: SettingsRepository,
  ) {}

  /**
   * Resolve the effective value for a config key in a context.
   * Returns { value, scope } where scope is the winning scope (null = default).
   * Unknown key → { value: null, scope: null } (fail-safe; caller decides default).
   */
  async resolve(
    principal: Principal,
    key: string,
    ctx: { branchId?: string | null; role?: string | null; feature?: string | null } = {},
  ): Promise<{ value: unknown; scope: ScopeLevel | null }> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const def = await this.repo.findDefinition(tx, principal.orgId, key);
      if (!def) return { value: null, scope: null };
      const values = await this.repo.listValuesForKey(tx, principal.orgId, key);
      return resolveEffective(
        values.map((v) => ({ scope: v.scope as ScopeLevel, scopeRef: v.scopeRef, value: v.value })),
        { branchId: ctx.branchId ?? principal.branchId, role: ctx.role ?? principal.role, feature: ctx.feature ?? null },
        def.defaultValue,
      );
    });
  }

  /** Convenience: is a boolean feature flag effectively enabled? */
  async isEnabled(principal: Principal, key: string, ctx: { branchId?: string | null; role?: string | null; feature?: string | null } = {}): Promise<boolean> {
    const { value } = await this.resolve(principal, key, ctx);
    return value === true;
  }
}
