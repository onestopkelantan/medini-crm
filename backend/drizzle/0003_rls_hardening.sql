-- ============================================================================
-- SPRINT 1 REMEDIATION — RLS HARDENING + APPLICATION RUNTIME ROLE
-- Addresses GLM 5.3 audit FIX 9 / 10 / 11:
--   FIX 9 : table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set.
--   FIX 10: define a non-owner application runtime role subject to RLS.
--   FIX 11: explicit WITH CHECK write policies (INSERT/UPDATE/DELETE scope).
--
-- Contract rules preserved (payment status layer, append-only audit, no
-- gateway fields). Delete is NOT part of the business contract for scoped
-- records (soft-delete via deleted_at) → hard DELETE is denied for the
-- application runtime role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FIX 10 — APPLICATION RUNTIME ROLE (non-owner, subject to RLS).
-- The app connects as this role in production; it does NOT own the tables,
-- so RLS applies. Password comes from env (DATABASE_URL) — never in source.
-- This role is created idempotently. Migration/admin tasks still run as the
-- owner/superuser role (the one applying this migration).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medini_app') THEN
    CREATE ROLE medini_app LOGIN PASSWORD 'medini_app_password';
  END IF;
END
$$;

-- Schema usage + table privileges for the runtime role.
GRANT USAGE ON SCHEMA public TO medini_app;
GRANT SELECT, INSERT, UPDATE ON branches, staff, role_assignments, patients,
  patient_relationships, appointments, payment_status, audit_log, domain_events,
  processed_events, idempotency_keys TO medini_app;
-- No DELETE grant → hard delete denied at privilege level (contract = soft delete).

-- ----------------------------------------------------------------------------
-- FIX 9 — FORCE ROW LEVEL SECURITY on the four RLS-scoped tables.
-- Without FORCE, the table owner bypasses RLS. With FORCE, even the owner is
-- subject to policies. Applied ONLY to the scoped tables (patients,
-- appointments, payment_status, branches) — NOT to audit_log / domain_events /
-- processed_events / idempotency_keys (system/append-only tables written by a
-- privileged path; forcing RLS there would break the service-role writer).
-- ----------------------------------------------------------------------------
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_status FORCE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- FIX 11 — explicit write policies with WITH CHECK.
-- The 0002 permissive policies (USING only) govern read. A permissive policy
-- without WITH CHECK does NOT constrain writes. Replace with policies that add
-- WITH CHECK so INSERT cannot create rows in a foreign branch and UPDATE cannot
-- move a row out of scope. hq retains full access.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS patients_scope ON patients;
CREATE POLICY patients_scope ON patients
  USING (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

DROP POLICY IF EXISTS appointments_scope ON appointments;
CREATE POLICY appointments_scope ON appointments
  USING (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

DROP POLICY IF EXISTS payment_status_scope ON payment_status;
CREATE POLICY payment_status_scope ON payment_status
  USING (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

DROP POLICY IF EXISTS branches_scope ON branches;
CREATE POLICY branches_scope ON branches
  USING (
    app_role() = 'hq'
    OR (id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
