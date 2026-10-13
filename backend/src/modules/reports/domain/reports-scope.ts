/** S9 — Report scope resolution. PURE domain: no I/O.
 *
 * Scope is FULLY server-derived from the principal — never from client input
 * (AD-6, dashboard precedent). Roles outside the matrix get 'denied'.
 */

export type ReportScope =
  | { type: 'org' }
  | { type: 'branch'; branchId: string }
  | { type: 'denied'; reason: string };

export interface ScopePrincipal {
  role: string;
  branchId: string | null;
}

/** Roles allowed to read reports per Q1 governance decision (LOCK doc):
 *  hq (all), branch_manager (own branch). Doctor/receptionist/others: denied. */
const ALLOWED_ROLES = new Set(['hq', 'branch_manager']);

export function resolveReportScope(p: ScopePrincipal): ReportScope {
  if (!ALLOWED_ROLES.has(p.role)) {
    return { type: 'denied', reason: `role '${p.role}' has no reports access` };
  }
  if (p.role === 'hq') return { type: 'org' };
  // branch_manager without a branch assignment cannot scope → fail closed.
  if (!p.branchId) {
    return { type: 'denied', reason: 'branch_manager without branch assignment' };
  }
  return { type: 'branch', branchId: p.branchId };
}
