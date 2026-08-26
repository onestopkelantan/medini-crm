/**
 * Principal — "WHO is making this request?" (identity only, NOT authorization).
 *
 * Sprint 1 Task 2: derived from the authenticated staff record + the
 * authoritative role_assignments table. NEVER built from client-supplied
 * role/branch/doctor values — those are derived server-side from trusted DB
 * rows. Keep identity (Principal) conceptually separate from authorization
 * (ScopeService / can()).
 *
 * Only the minimum claims needed for authorization live here; sensitive data
 * (password hash, secrets) is NEVER placed on the Principal or in the JWT.
 */
export interface Principal {
  /** staff.id (uuid) — the authenticated staff member. */
  readonly staffId: string;
  /** username (immutable natural key) — for display/audit. */
  readonly username: string;
  /** effective role from role_assignments (hq | branch_manager | branch_admin | doctor). */
  readonly role: string;
  /** organization id (single-tenant reserved). */
  readonly orgId: string;
  /** branch the staff is scoped to (null only for hq). */
  readonly branchId: string | null;
  /** doctor identity for doctor role (doctorRef), else null. */
  readonly doctorId: string | null;
}
