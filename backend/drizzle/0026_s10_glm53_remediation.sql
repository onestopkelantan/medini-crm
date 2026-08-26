-- Sprint 10 — GLM 5.3 Remediation (S10-01, S10-02, dev drift).
--
-- S10-01: staff registration RLS — the pre-auth registration path uses
--   runAsWorker (system_worker). Migration 0023's staff policies block
--   system_worker. This adds LEAST-PRIVILEGE worker policies scoped to
--   invitation registration ONLY (invite_token IS NOT NULL), so a clean
--   0000→0026 database supports the full invite→register→approve→login flow
--   WITHOUT manual policies.
--
-- S10-02: refresh_tokens RLS was over-permissive (any authenticated role
--   could SELECT/UPDATE other users' tokens). Restrict to least-privilege:
--   - SELECT/UPDATE own tokens only (staff_id = app_staff_id())
--   - system_worker may perform token operations (rotation/revoke-all)
--   - org isolation RESTRICTIVE retained
--
-- ADDITIVE/STRICT only. No historical migration is modified. No plaintext
-- tokens are exposed. Org isolation is preserved.
--> statement-breakpoint

-- ============================================================================
-- 1. Helper: app_staff_id() — fail-closed staff identity GUC (mirrors app_org_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION app_staff_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.staff_id', true), '')::uuid
$$;
--> statement-breakpoint

-- ============================================================================
-- 2. S10-01 — staff: least-privilege worker policies for registration
--    CRITICAL (S8 N9-1 lesson): a failing RESTRICTIVE policy can NEVER be
--    overridden by a PERMISSIVE policy. 0023's n9_staff_worker_exclusion_update
--    is RESTRICTIVE FOR UPDATE (app_role() <> 'system_worker') → it rejects ALL
--    system_worker UPDATEs, blocking registration. Scope it to allow the
--    registration update (invite_token IS NOT NULL rows only).
-- ============================================================================

-- Re-scope the UPDATE exclusion: block worker UPDATE EXCEPT invitation registration.
-- USING: the row being targeted must currently hold an invite_token (a pending invite).
-- No WITH CHECK: registration CLEARS invite_token (single-use), so a WITH_CHECK
-- requiring invite_token IS NOT NULL on the NEW row would always fail. The USING
-- clause is the security boundary; the new row's invite_token is NULL by design.
DROP POLICY IF EXISTS n9_staff_worker_exclusion_update ON staff;
--> statement-breakpoint
CREATE POLICY n9_staff_worker_exclusion_update ON staff AS RESTRICTIVE FOR UPDATE
  USING (COALESCE(app_role(), '') <> 'system_worker' OR invite_token IS NOT NULL);
--> statement-breakpoint

DROP POLICY IF EXISTS s10_staff_registration_read ON staff;
--> statement-breakpoint
CREATE POLICY s10_staff_registration_read ON staff FOR SELECT
  USING (app_role() = 'system_worker' AND invite_token IS NOT NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS s10_staff_registration_update ON staff;
--> statement-breakpoint
CREATE POLICY s10_staff_registration_update ON staff FOR UPDATE
  USING (app_role() = 'system_worker' AND invite_token IS NOT NULL)
  WITH CHECK (app_role() = 'system_worker');
--> statement-breakpoint

-- ============================================================================
-- 4. S10-01 — SECURITY DEFINER registration function
--    RLS policies cannot reliably evaluate transaction-local GUCs during
--    WITH CHECK (current_setting sees NULL in policy context). The
--    registration path therefore uses a SECURITY DEFINER function that
--    validates the invite token and performs the update atomically.
-- ============================================================================
CREATE OR REPLACE FUNCTION register_staff_with_token(
  p_invite_token TEXT,
  p_name TEXT,
  p_username TEXT,
  p_password_hash TEXT,
  p_org_id UUID
) RETURNS TABLE(id UUID, status TEXT) AS $$
DECLARE
  v_staff_id UUID;
  v_current_status TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT s.id, s.status, s.invite_expires_at INTO v_staff_id, v_current_status, v_expires_at
  FROM staff s
  WHERE s.invite_token = p_invite_token
    AND s.org_id = p_org_id
    AND s.deleted_at IS NULL
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation' USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status != 'Invited' THEN
    RAISE EXCEPTION 'Invitation already used or invalid (status: %)', v_current_status USING ERRCODE = 'P0001';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = 'P0002';
  END IF;

  UPDATE staff SET
    name = p_name,
    username = LOWER(p_username),
    password_hash = p_password_hash,
    status = 'Pending',
    invite_token = NULL,
    invite_expires_at = NULL,
    updated_at = NOW()
  WHERE staff.id = v_staff_id
  RETURNING staff.id INTO v_staff_id;

  RETURN QUERY SELECT v_staff_id, 'Pending'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION register_staff_with_token(TEXT, TEXT, TEXT, TEXT, UUID) TO medini_app;
--> statement-breakpoint

-- ============================================================================
-- 5. S10-02 — refresh_tokens: least-privilege RLS
-- ============================================================================
DROP POLICY IF EXISTS s10_refresh_select ON refresh_tokens;
--> statement-breakpoint
DROP POLICY IF EXISTS s10_refresh_update ON refresh_tokens;
--> statement-breakpoint
DROP POLICY IF EXISTS s10_refresh_insert ON refresh_tokens;
--> statement-breakpoint

-- Own-token SELECT: a staff member can only read their OWN tokens.
CREATE POLICY s10_refresh_select_own ON refresh_tokens FOR SELECT
  USING (staff_id = app_staff_id());
--> statement-breakpoint

-- Own-token UPDATE: a staff member can only revoke/rotate their OWN tokens.
CREATE POLICY s10_refresh_update_own ON refresh_tokens FOR UPDATE
  USING (staff_id = app_staff_id())
  WITH CHECK (staff_id = app_staff_id());
--> statement-breakpoint

-- INSERT: the issuing context. system_worker may insert (login/refresh/logout
-- flows run as system_worker or as the authenticated principal with app.staff_id
-- set by DbContextService.runAs). For human principals, staff_id must match
-- the session's app_staff_id().
CREATE POLICY s10_refresh_insert ON refresh_tokens FOR INSERT
  WITH CHECK (app_role() = 'system_worker' OR staff_id = app_staff_id());
--> statement-breakpoint

-- system_worker full access (rotation/revoke-all on deactivation, refresh lookup).
CREATE POLICY s10_refresh_worker ON refresh_tokens FOR ALL
  USING (app_role() = 'system_worker')
  WITH CHECK (app_role() = 'system_worker');
--> statement-breakpoint

-- No DELETE policy: tokens are revoked/rotated, never deleted.
--> statement-breakpoint
