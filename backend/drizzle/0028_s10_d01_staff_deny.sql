-- ============================================================================
-- 0028_s10_d01_staff_deny.sql
-- S10 GLM 5.3 Final Remediation — D-01 (HIGH) + dev/replay drift reconciliation.
--
-- D-01 ROOT CAUSE (independently proven by GLM 5.3):
--   The `staff` table was excluded from the 0027 s10_developer_deny layer
--   because the auth pipeline must read `staff` to build the Principal.
--   BUT the exclusion was ALL-OR-NOTHING: n9_staff_human_all (ALL, PERMISSIVE,
--   "any non-worker role") grants developer full read+write — INSERT staff,
--   create role='hq', doctor→hq escalation, status→Active, invite_token and
--   password_hash manipulation. The API/RBAC layer protects /system-admin/*,
--   but the DB layer gave NO third independent protection for staff.
--
-- REMEDIATION MODEL (narrowest possible, three new policies):
--   1. s10_developer_staff_write_deny (RESTRICTIVE FOR ALL, staff):
--      denies developer ALL writes. COALESCE(app_role(),'') is REQUIRED —
--      login/PrincipalResolver read staff with NO GUC set (app_role() NULL);
--      NULL <> 'developer' evaluates NULL → a RESTRICTIVE policy would deny
--      the pre-auth login lookup itself. COALESCE keeps legitimate no-GUC
--      paths working while still denying developer.
--   2. s10_developer_staff_read_deny (RESTRICTIVE FOR SELECT, staff):
--      developer must not observe staff rows (invite tokens, password hashes).
--      The approved developer surface is technical-only — SystemAdminService
--      (overview/health/readiness) holds ZERO staff queries by construction,
--      so the deny cannot break the approved surface. Developer auth still
--      works: login reads staff via the no-GUC pool (deny inert: COALESCE →
--      NULL role <> 'developer' → allowed); refresh_tokens is excluded from
--      deny layers (0027); logout only touches refresh_tokens.
--   3. s10_developer_ra_deny (RESTRICTIVE FOR ALL, role_assignments):
--      no approved developer code path reads or writes role assignments —
--      no role mining, no self-elevation via a second table.
--   Plus matching org/branch denies (5): org/branch data is business data,
--   not diagnostics — a technical-only role has no business reading it.
--
-- SECURITY INVARIANTS PRESERVED (unchanged):
--   - Worker isolation: n9_staff_worker_exclusion_{update,delete} re-created
--     exactly as 0026 scoped them (0026 is part of replay history).
--   - Registration SECURITY DEFINER flow (register_staff_with_token) unchanged.
--   - Human access for hq/doctor/manager/receptionist unchanged.
--   - HQ access contract, RBAC, API guards, fail-closed behavior unchanged.
--
-- DRIFT RECONCILIATION (GLM: dev 288 vs replay 289 policies):
--   Cause 1 — dev missing `n9_staff_worker_exclusion` (INSERT RESTRICTIVE):
--     dropped manually during the S10-01 investigation; the replay creates it
--     in 0023 and nothing re-drops it. → Encoded here (§4b).
--   Cause 2 — dev `n9_staff_human_all` lost its WITH CHECK: removed manually
--     (S8 N9-1 lesson: the implicit WITH CHECK copy blocked worker rows) and
--     never encoded. → Encoded here (§4a).
--   After 0028, replay 0000→0028 and dev hold the IDENTICAL policy set.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. D-01 — developer write-deny on staff (RESTRICTIVE, FOR ALL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS s10_developer_staff_write_deny ON staff;
--> statement-breakpoint
CREATE POLICY s10_developer_staff_write_deny ON staff AS RESTRICTIVE FOR ALL
  TO medini_app
  USING (COALESCE(app_role(), '') <> 'developer')
  WITH CHECK (COALESCE(app_role(), '') <> 'developer');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. D-01 — developer read-deny on staff (RESTRICTIVE, FOR SELECT)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS s10_developer_staff_read_deny ON staff;
--> statement-breakpoint
CREATE POLICY s10_developer_staff_read_deny ON staff AS RESTRICTIVE FOR SELECT
  TO medini_app
  USING (COALESCE(app_role(), '') <> 'developer');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. D-01 — developer read+write deny on role_assignments (RESTRICTIVE)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS s10_developer_ra_deny ON role_assignments;
--> statement-breakpoint
CREATE POLICY s10_developer_ra_deny ON role_assignments AS RESTRICTIVE FOR ALL
  TO medini_app
  USING (COALESCE(app_role(), '') <> 'developer')
  WITH CHECK (COALESCE(app_role(), '') <> 'developer');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. DRIFT — encode the manual dev-state changes into migration history
-- ---------------------------------------------------------------------------

-- 4a. n9_staff_human_all: current intended state has NO WITH CHECK (the
--     implicit copy blocked system_worker rows; S8 N9-1 lesson). Deterministic
--     drop+recreate so replay matches dev.
DROP POLICY IF EXISTS n9_staff_human_all ON staff;
--> statement-breakpoint
CREATE POLICY n9_staff_human_all ON staff FOR ALL
  USING (COALESCE(app_role(), '') <> 'system_worker');
--> statement-breakpoint

-- 4b. n9_staff_worker_exclusion (INSERT RESTRICTIVE, from 0023): dropped in
--     dev during the S10-01 investigation; superseded by the SECURITY DEFINER
--     registration function + scoped update exclusion. Encode the drop.
DROP POLICY IF EXISTS n9_staff_worker_exclusion ON staff;
--> statement-breakpoint

-- 4c. Deterministic re-create of the 0026-scoped worker exclusions (idempotent
--     reconciliation; identical text to 0026 so replay state == dev state).
DROP POLICY IF EXISTS n9_staff_worker_exclusion_update ON staff;
--> statement-breakpoint
CREATE POLICY n9_staff_worker_exclusion_update ON staff AS RESTRICTIVE FOR UPDATE
  USING (COALESCE(app_role(), '') <> 'system_worker' OR invite_token IS NOT NULL);
--> statement-breakpoint

DROP POLICY IF EXISTS n9_staff_worker_exclusion_delete ON staff;
--> statement-breakpoint
CREATE POLICY n9_staff_worker_exclusion_delete ON staff AS RESTRICTIVE FOR DELETE
  USING (COALESCE(app_role(), '') <> 'system_worker');
--> statement-breakpoint

-- 4d. s10_staff_registration_update: dev lost its WITH CHECK during the S10-01
--     investigation (it is redundant — the SECURITY DEFINER registration
--     function performs the update as the table owner, bypassing RLS — but
--     for exact dev/replay parity we encode the dev state).
DROP POLICY IF EXISTS s10_staff_registration_update ON staff;
--> statement-breakpoint
CREATE POLICY s10_staff_registration_update ON staff FOR UPDATE
  USING (app_role() = 'system_worker' AND invite_token IS NOT NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. D-01 completeness — developer deny on organizations + branches
--    (business data, not diagnostics — technical-only role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS s10_developer_org_deny ON organizations;
--> statement-breakpoint
CREATE POLICY s10_developer_org_deny ON organizations AS RESTRICTIVE FOR ALL
  TO medini_app
  USING (COALESCE(app_role(), '') <> 'developer')
  WITH CHECK (COALESCE(app_role(), '') <> 'developer');
--> statement-breakpoint

DROP POLICY IF EXISTS s10_developer_branch_deny ON branches;
--> statement-breakpoint
CREATE POLICY s10_developer_branch_deny ON branches AS RESTRICTIVE FOR ALL
  TO medini_app
  USING (COALESCE(app_role(), '') <> 'developer')
  WITH CHECK (COALESCE(app_role(), '') <> 'developer');
--> statement-breakpoint

-- 5c. audit_log — business action history (patient/invoice references) is
--     business data; the approved developer surface has no audit queries.
DROP POLICY IF EXISTS s10_developer_audit_deny ON audit_log;
--> statement-breakpoint
CREATE POLICY s10_developer_audit_deny ON audit_log AS RESTRICTIVE FOR ALL
  TO medini_app
  USING (COALESCE(app_role(), '') <> 'developer')
  WITH CHECK (COALESCE(app_role(), '') <> 'developer');
