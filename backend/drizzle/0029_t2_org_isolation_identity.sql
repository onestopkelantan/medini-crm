-- ============================================================================
-- 0029_t2_org_isolation_identity.sql
-- Tier 2 (T2-A) — Org-isolation defense-in-depth for identity tables.
--
-- FAMILY-1 (P1-F2, P4-F2, P4-F3, P5-F1, P8-F5): the identity tables
-- (staff, role_assignments) had NO org-scoped RLS, so a principal with a
-- non-canonical app.org_id GUC could READ cross-organization identity data
-- at the DB layer. The API/service layer (requireHq + p.orgId scoping +
-- PermissionGuard) closes this today; this migration adds the DB-layer
-- backstop (defense-in-depth) WITHOUT relying on API filters.
--
-- PROOF OF THE GAP (pre-0029, medini_app, hq GUC, test org
-- aaaaaaaa-…-0701 which has 5 staff / 0 branches):
--   SELECT staff            → 11 rows (cross-org: canonical 5 + test 5 + other 1)
--   SELECT role_assignments →  5 rows (cross-org)
-- Post-0029 the same GUC sees 5 staff / 0 role_assignments; the canonical org
-- is unchanged (5 staff / 5 ra); the no-GUC pre-auth login lookup still works
-- (11 staff — deny inert without GUC).
--
-- DESIGN — SELECT-only RESTRICTIVE, NULL-org inert:
--   `app_org_id() IS NULL OR org_id = app_org_id()`
--   - app_org_id() IS NULL → passes ALL rows. Keeps the pre-auth login lookup
--     and PrincipalResolver working (raw pool, no GUC). Org scoping is a
--     tenant boundary, not an auth boundary — it must not break login.
--   - app_org_id() set → enforces org_id = app_org_id(), closing the cross-org
--     READ leak for any authenticated runAs context.
--   - SELECT-ONLY (not FOR ALL): closes the read-exposure (the heart of
--     FAMILY-1) WITHOUT blocking legitimate write paths. Writes were NOT part
--     of the finding and are already guarded by role/worker/developer denies
--     (0023/0027/0028), API requireHq + p.orgId scoping, and last-HQ service
--     protection. A FOR-ALL policy would break the established S8/S9 seeding
--     pattern (scratch orgs referencing shared canonical branches) and prod
--     seed/ops writes that legitimately span orgs — over-restriction, not
--     hardening.
--
-- SCOPE — staff + role_assignments ONLY (deliberate):
--   branches / organizations were evaluated and EXCLUDED:
--   - branches: app_branch_ids() resolves via the branches table; an org
--     policy there silently empties branch scope for scratch/non-canonical
--     orgs and breaks the treatment_plans_scope PERMISSIVE chain (verified
--     live during remediation: treatment_mix aggregate returned 0). Branches
--     are low-sensitivity reference data (code/name), already denied to
--     developer (0028) and org-scoped for workers (s8_branches_worker_read).
--   - organizations: single canonical row; AdministrationService reads the
--     CANONICAL org by design (single-tenant G1). Low sensitivity (org name).
--   Both remain covered by their existing role policies; the READ exposure of
--   identity data (usernames, roles, invite tokens, password hashes) lives in
--   staff / role_assignments — that is what FAMILY-1 is about, and that is
--   what this migration closes.
--
-- Role/worker/developer denies (0023/0027/0028) are UNCHANGED and remain the
-- primary write guards; these SELECT org policies are strictly additive.
-- ADDITIVE ONLY. No historical migration (0000–0028) is modified. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. staff — org isolation (SELECT)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS t2_staff_org_isolation ON staff;
--> statement-breakpoint
CREATE POLICY t2_staff_org_isolation ON staff AS RESTRICTIVE FOR SELECT
  TO medini_app
  USING (app_org_id() IS NULL OR org_id = app_org_id());
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. role_assignments — org isolation (SELECT)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS t2_role_assignments_org_isolation ON role_assignments;
--> statement-breakpoint
CREATE POLICY t2_role_assignments_org_isolation ON role_assignments AS RESTRICTIVE FOR SELECT
  TO medini_app
  USING (app_org_id() IS NULL OR org_id = app_org_id());
--> statement-breakpoint
