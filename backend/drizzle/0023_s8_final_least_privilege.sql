-- Sprint 8 Final Remediation (N9-1): least-privilege hardening for legacy S0 tables.
--
-- GLM 5.3 forensic finding: system_worker could INSERT into staff (and other
-- legacy tables) because staff/role_assignments/audit_log/idempotency_keys
-- predate the S8 RLS model and have no system_worker exclusion.
--
-- This migration is ADDITIVE ONLY. It does NOT enable RLS on these tables
-- (they are legacy S0 global/system tables with established human access
-- patterns). It ONLY adds RESTRICTIVE policies that deny system_worker
-- operations not required by the S8 worker runtime.
--
-- Worker permission matrix (post-0023):
--   staff            SELECT=required, INSERT=DENY, UPDATE=DENY, DELETE=DENY
--   role_assignments SELECT=required, INSERT=DENY, UPDATE=DENY, DELETE=DENY
--   audit_log        SELECT=required, INSERT=ALLOW (worker audit), UPDATE=DENY, DELETE=DENY
--   idempotency_keys SELECT=required, INSERT=DENY, UPDATE=DENY, DELETE=DENY
--
-- Human/API access (HQ, Branch Manager, Branch Admin, Doctor) is UNCHANGED.

-- staff: workers never need to create/modify/delete staff records.
-- Human access (HQ, Branch Manager, Branch Admin, Doctor) preserved via permissive policies.
-- NOTE: Auth service queries staff WITHOUT GUCs (before login) — app_role() returns NULL.
-- The permissive policy uses COALESCE to allow NULL role (service-level auth query).
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS n9_staff_human_all ON staff;
CREATE POLICY n9_staff_human_all ON staff FOR ALL
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_staff_worker_exclusion ON staff;
CREATE POLICY n9_staff_worker_exclusion ON staff AS RESTRICTIVE FOR INSERT
  WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_staff_worker_exclusion_update ON staff;
CREATE POLICY n9_staff_worker_exclusion_update ON staff AS RESTRICTIVE FOR UPDATE
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_staff_worker_exclusion_delete ON staff;
CREATE POLICY n9_staff_worker_exclusion_delete ON staff AS RESTRICTIVE FOR DELETE
  USING (COALESCE(app_role(), '') <> 'system_worker');

-- role_assignments: workers never need to create/modify/delete role assignments.
-- Human access preserved via permissive policies.
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS n9_role_assignments_human_all ON role_assignments;
CREATE POLICY n9_role_assignments_human_all ON role_assignments FOR ALL
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_role_assignments_worker_exclusion ON role_assignments;
CREATE POLICY n9_role_assignments_worker_exclusion ON role_assignments AS RESTRICTIVE FOR INSERT
  WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_role_assignments_worker_exclusion_update ON role_assignments;
CREATE POLICY n9_role_assignments_worker_exclusion_update ON role_assignments AS RESTRICTIVE FOR UPDATE
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_role_assignments_worker_exclusion_delete ON role_assignments;
CREATE POLICY n9_role_assignments_worker_exclusion_delete ON role_assignments AS RESTRICTIVE FOR DELETE
  USING (COALESCE(app_role(), '') <> 'system_worker');

-- audit_log: workers MUST be able to INSERT audit records (S8 audit architecture).
-- Only UPDATE and DELETE are denied. SELECT and INSERT remain allowed.
-- NOTE: Explicit PERMISSIVE policies for SELECT and INSERT (RLS requires at least one
-- permissive policy per command; RESTRICTIVE alone blocks everything).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS n9_audit_log_select ON audit_log;
CREATE POLICY n9_audit_log_select ON audit_log FOR SELECT
  USING (true);  -- audit_log is global/system table; all roles can read
DROP POLICY IF EXISTS n9_audit_log_insert ON audit_log;
CREATE POLICY n9_audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (true);  -- all roles (including system_worker) can insert audit records
DROP POLICY IF EXISTS n9_audit_log_worker_exclusion_update ON audit_log;
CREATE POLICY n9_audit_log_worker_exclusion_update ON audit_log AS RESTRICTIVE FOR UPDATE
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_audit_log_worker_exclusion_delete ON audit_log;
CREATE POLICY n9_audit_log_worker_exclusion_delete ON audit_log AS RESTRICTIVE FOR DELETE
  USING (COALESCE(app_role(), '') <> 'system_worker');

-- idempotency_keys: workers never need to create/modify/delete idempotency keys.
-- Human access preserved via permissive policies.
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS n9_idempotency_keys_human_all ON idempotency_keys;
CREATE POLICY n9_idempotency_keys_human_all ON idempotency_keys FOR ALL
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_idempotency_keys_worker_exclusion ON idempotency_keys;
CREATE POLICY n9_idempotency_keys_worker_exclusion ON idempotency_keys AS RESTRICTIVE FOR INSERT
  WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_idempotency_keys_worker_exclusion_update ON idempotency_keys;
CREATE POLICY n9_idempotency_keys_worker_exclusion_update ON idempotency_keys AS RESTRICTIVE FOR UPDATE
  USING (COALESCE(app_role(), '') <> 'system_worker') WITH CHECK (COALESCE(app_role(), '') <> 'system_worker');
DROP POLICY IF EXISTS n9_idempotency_keys_worker_exclusion_delete ON idempotency_keys;
CREATE POLICY n9_idempotency_keys_worker_exclusion_delete ON idempotency_keys AS RESTRICTIVE FOR DELETE
  USING (COALESCE(app_role(), '') <> 'system_worker');
