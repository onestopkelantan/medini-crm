-- ============================================================================
-- SPRINT 1 — RLS FOUNDATION + INTEGRITY HARDENING
-- Row-Level Security (defense-in-depth; application ScopeService is primary).
-- RLS is ENABLED but in 'permissive + app-context' mode: the API sets
--   SET app.role / app.branch_ids  per transaction/connection.
-- If app context is absent, scoped tables return NOTHING (fail-closed).
-- ============================================================================

-- Helper: current app role (NULL if not set)
CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;

-- Helper: current app branch list as text[] (NULL if not set)
CREATE OR REPLACE FUNCTION app_branch_ids() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.branch_ids', true), '') IS NULL THEN NULL
    ELSE string_to_array(current_setting('app.branch_ids', true), ',')
  END
$$;

-- Only ONE ACTIVE role assignment per staff member
CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_one_active_uq
  ON role_assignments (staff_id) WHERE status = 'ACTIVE';

-- ============================================================================
-- RLS on branch-scoped tables.
-- Policy logic:
--   hq         → full access (app_role() = 'hq')
--   others     → row.branch_id must be within app_branch_ids()
--   no context → app_branch_ids() IS NULL → no rows (fail-closed)
-- ============================================================================

-- PATIENTS
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_scope ON patients
  USING (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

-- APPOINTMENTS
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_scope ON appointments
  USING (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

-- PAYMENT_STATUS
ALTER TABLE payment_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_status_scope ON payment_status
  USING (
    app_role() = 'hq'
    OR (branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

-- BRANCHES (read scoped; hq all, others own branch row only)
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_scope ON branches
  USING (
    app_role() = 'hq'
    OR (id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

-- NOTE: audit_log & domain_events are written via service role (bypass RLS),
-- read access is restricted to hq through a separate read policy if exposed.
