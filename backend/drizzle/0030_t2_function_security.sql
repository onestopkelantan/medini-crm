-- ============================================================================
-- 0030_t2_function_security.sql
-- Tier 2 (T2-C search_path hardening + T2-D PUBLIC EXECUTE hardening).
--
-- T2-C (P5-F2): SECURITY DEFINER functions that resolve unqualified object
-- names via the CALLER's search_path are vulnerable to search_path
-- manipulation (a malicious temp/foreign schema object shadowing `staff`).
-- register_staff_with_token is the only SECURITY DEFINER function and touches
-- the security-sensitive registration path — pin its search_path so name
-- resolution is fixed to the real schema regardless of the caller's path.
--
-- T2-D (P5-F6): functions default to EXECUTE granted to PUBLIC. For the
-- SECURITY DEFINER registration function this lets ANY role that can reach
-- the DB invoke it directly. Revoke PUBLIC EXECUTE and grant only the
-- intended application runtime role (medini_app), which the registration
-- service uses (staff-registration.service.ts).
--
-- SCOPE + RATIONALE (per-function):
--   register_staff_with_token  SECURITY DEFINER, writes staff — HARDEN both
--                              (search_path pin + revoke PUBLIC). Behaviour
--                              preserved (same body; only resolution pinned).
--   app_role/app_org_id/app_staff_id/app_branch_ids/app_doctor_id
--                              SECURITY INVOKER, read-only current_setting
--                              helpers called by EVERY RLS policy. They make
--                              no object references, so search_path pinning
--                              adds no security value and revoking PUBLIC
--                              would break RLS evaluation for the app role.
--                              → intentionally NOT changed (recorded).
-- ADDITIVE ONLY. No historical migration (0000–0029) is modified. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. T2-C — pin search_path on the SECURITY DEFINER registration function.
--    Recreated with the SAME body (verbatim from 0026) so behaviour is
--    identical; only the name-resolution path is fixed to pg_catalog + public
--    and temp schemas are excluded (no shadowing via pg_temp).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_staff_with_token(
  p_invite_token TEXT,
  p_name TEXT,
  p_username TEXT,
  p_password_hash TEXT,
  p_org_id UUID
) RETURNS TABLE(id UUID, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
$$;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. T2-D — revoke PUBLIC EXECUTE on the SECURITY DEFINER function; grant only
--    the application runtime role. Direct invocation by any other role now
--    fails; the legitimate registration path (medini_app) is unaffected.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION register_staff_with_token(TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION register_staff_with_token(TEXT, TEXT, TEXT, TEXT, UUID) TO medini_app;
--> statement-breakpoint
