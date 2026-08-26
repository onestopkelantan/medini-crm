-- Sprint 10 T1 — Production auth lifecycle foundation.
--
-- 1. refresh_tokens — secure refresh-token persistence with rotation/revocation.
--    Governance decision D2 (S10 T1): secure refresh strategy (storage +
--    rotation + revocation), NOT stateless long-lived tokens.
-- 2. staff_status enum — add 'Pending' (application submitted, awaiting HQ
--    approval) and 'Rejected' (application rejected) lifecycle values.
--    Governance decision D6. ALTER TYPE ADD VALUE is irreversible — approved
--    by governance as additive lifecycle states.
-- 3. staff.invite_token / staff.invite_expires_at — single-use invitation
--    token for HQ-controlled registration (governance D7).
--
-- ADDITIVE ONLY. No existing table/policy/migration is modified.
-- RLS follows the S8 N9 checklist: org-isolation RESTRICTIVE + per-command
-- permissives, COALESCE-null-safe quals, no worker policies (no worker
-- touches refresh_tokens — only the auth service does).

--> statement-breakpoint

-- ============================================================================
-- 1. staff_status enum — add 'Pending' + 'Rejected'
-- ============================================================================
ALTER TYPE staff_status ADD VALUE IF NOT EXISTS 'Pending';
--> statement-breakpoint
ALTER TYPE staff_status ADD VALUE IF NOT EXISTS 'Rejected';
--> statement-breakpoint

-- ============================================================================
-- 1b. staff — single-use invitation token columns (governance D7)
-- ============================================================================
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;
--> statement-breakpoint

-- ============================================================================
-- 2. refresh_tokens — secure refresh-token persistence
--    Supports: rotation (rotated_to), revocation (revoked_at), expiry.
--    token_hash = SHA-256 of the refresh token (never store plaintext).
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  staff_id      uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  rotated_to    uuid REFERENCES refresh_tokens(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_ip    varchar(45),
  user_agent    text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_uq
  ON refresh_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS refresh_tokens_staff_idx
  ON refresh_tokens (staff_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS refresh_tokens_org_idx
  ON refresh_tokens (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx
  ON refresh_tokens (expires_at);
--> statement-breakpoint

-- ============================================================================
-- 3. RLS — refresh_tokens
--    Org isolation (RESTRICTIVE) + per-command permissives.
--    Human roles never read/write tokens directly — only the auth service
--    (which runs under a principal or a scoped worker context) does.
--    We allow INSERT/SELECT/UPDATE for authenticated principals so the auth
--    service can operate; no DELETE (tokens are revoked, never removed).
-- ============================================================================
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS s10_refresh_org_isolation ON refresh_tokens;
--> statement-breakpoint
CREATE POLICY s10_refresh_org_isolation ON refresh_tokens AS RESTRICTIVE FOR ALL
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
-- Auth service writes (INSERT) on behalf of the authenticated principal.
DROP POLICY IF EXISTS s10_refresh_insert ON refresh_tokens;
--> statement-breakpoint
CREATE POLICY s10_refresh_insert ON refresh_tokens FOR INSERT
  WITH CHECK (COALESCE(app_role(), '') <> '');
--> statement-breakpoint
-- Auth service reads (SELECT) to verify/revoke.
DROP POLICY IF EXISTS s10_refresh_select ON refresh_tokens;
--> statement-breakpoint
CREATE POLICY s10_refresh_select ON refresh_tokens FOR SELECT
  USING (COALESCE(app_role(), '') <> '');
--> statement-breakpoint
-- Auth service updates (revoke / rotate) via UPDATE.
DROP POLICY IF EXISTS s10_refresh_update ON refresh_tokens;
--> statement-breakpoint
CREATE POLICY s10_refresh_update ON refresh_tokens FOR UPDATE
  USING (COALESCE(app_role(), '') <> '') WITH CHECK (COALESCE(app_role(), '') <> '');
--> statement-breakpoint
-- No DELETE policy: tokens are revoked/rotated, never deleted.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO medini_app;
--> statement-breakpoint
