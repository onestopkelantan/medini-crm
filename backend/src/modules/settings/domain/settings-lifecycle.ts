/**
 * Settings domain — config resolution + lifecycle (Sprint 7 T2). Pure functions.
 *
 * Scope precedence (approved, most-specific-wins):
 *   FEATURE > ROLE > BRANCH > ORGANIZATION > SYSTEM
 * The effective value for a key in a context is the FIRST set value found
 * walking from most-specific to least-specific; otherwise the definition's
 * default_value.
 */

export type ScopeLevel = 'system' | 'organization' | 'branch' | 'role' | 'feature';

/** Ordered from most-specific to least-specific. */
export const SCOPE_PRECEDENCE: readonly ScopeLevel[] = [
  'feature', 'role', 'branch', 'organization', 'system',
];

/** Rank for comparison (lower = more specific = higher precedence). */
export function scopeRank(scope: ScopeLevel): number {
  return SCOPE_PRECEDENCE.indexOf(scope);
}

export interface ScopedValue {
  scope: ScopeLevel;
  scopeRef: string | null;
  value: unknown;
}

/**
 * Resolve the effective value from a set of scoped values. `ctx` supplies the
 * current branch / role / feature so the correct scope_ref rows are matched.
 * The most-specific matching scope wins. Falls back to `defaultValue`.
 */
export function resolveEffective(
  values: ScopedValue[],
  ctx: { branchId?: string | null; role?: string | null; feature?: string | null },
  defaultValue: unknown,
): { value: unknown; scope: ScopeLevel | null } {
  /* Candidate scope_ref for each level in precedence order. */
  const candidates: Array<{ scope: ScopeLevel; ref: string | null }> = [
    { scope: 'feature', ref: ctx.feature ?? null },
    { scope: 'role', ref: ctx.role ?? null },
    { scope: 'branch', ref: ctx.branchId ?? null },
    { scope: 'organization', ref: null },
    { scope: 'system', ref: null },
  ];
  for (const c of candidates) {
    const hit = values.find(
      (v) => v.scope === c.scope && (c.scope === 'system' || c.scope === 'organization' ? true : v.scopeRef === c.ref),
    );
    if (hit) return { value: hit.value, scope: hit.scope };
  }
  return { value: defaultValue, scope: null };
}

/** Validate a value against its declared type. Returns error string or null. */
export function validateValueType(valueType: string, value: unknown): string | null {
  switch (valueType) {
    case 'string': return typeof value === 'string' ? null : 'must be a string';
    case 'number': return typeof value === 'number' && !Number.isNaN(value) ? null : 'must be a number';
    case 'boolean': return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'json': return value !== null && typeof value === 'object' ? null : 'must be an object/array';
    default: return `unknown value_type '${valueType}'`;
  }
}
