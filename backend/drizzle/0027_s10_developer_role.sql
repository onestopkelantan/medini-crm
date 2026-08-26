-- 0027_s10_developer_role.sql
-- S10 GLM 5.3 Remediation — Developer / System Admin account.
--
-- Architecture (approved): the Developer is a TECHNICAL-ONLY identity, fully
-- separate from Medini HQ Owner. It uses the normal auth pipeline (Argon2id +
-- JWT + refresh rotation — no magic login, no backdoor). Three independent
-- layers deny it business data:
--   1. ROLE_DOMAIN_MATRIX: `developer` has zero domain cells (fail-closed can()).
--   2. PermissionGuard: every business route carries @RequirePermission → 403.
--   3. RLS (this migration): RESTRICTIVE policies deny ALL DML on every
--      business table for app.role = 'developer'. RESTRICTIVE cannot be
--      overridden by any PERMISSIVE policy (S8 N9-1 lesson).
--
-- Exceptions (intentional):
--   staff / role_assignments — the auth pipeline (PrincipalResolver) must read
--     the developer's own row to build the Principal. Read access here exposes
--     no business data (patients/clinical/finance stay denied), and the
--     Administration domain is denied at the matrix layer.
--   Infrastructure tables without RLS (migrations bookkeeping) are unaffected.

ALTER TYPE role ADD VALUE IF NOT EXISTS 'developer';

-- The legacy CHECK forced every non-hq role to have a branch. The developer
-- is branch-less (like hq) but is NOT hq — relax the constraint accordingly.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_non_hq_requires_branch;
ALTER TABLE staff ADD CONSTRAINT staff_non_hq_requires_branch
  CHECK ("role" IN ('hq', 'developer') OR branch_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- RESTRICTIVE deny-all on every RLS-enabled business table.
-- (exclusions below — see header rationale.)
-- ---------------------------------------------------------------------------
-- Idempotency: drop from ALL tables first (covers re-apply after exclusions
-- were widened), then create only on business tables.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE policyname = 's10_developer_deny'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS s10_developer_deny ON %I', t);
  END LOOP;
END $$;
DO $$
DECLARE
  t text;
  /* Exclusions (intentional):
   *   staff / role_assignments — auth pipeline must read the developer's own
   *     row to build the Principal (no business data exposed; admin domain is
   *     denied at the matrix layer).
   *   refresh_tokens — auth lifecycle: the developer must be able to hold a
   *     session. Existing PERMISSIVE policies scope tokens to the owner row;
   *     business data is not reachable through this table.
   *   audit_log — append-only forensic trail (service writes under its own
   *     context); denial here would break the audit pipeline, not protect
   *     business reads (matrix layer already blocks audit domain access).
   *   domain_events / processed_events / idempotency_keys — infrastructure
   *     plumbing written by internal services; no patient/business content is
   *     queryable by the developer via any permitted code path. */
  excluded text[] := ARRAY['staff', 'role_assignments', 'refresh_tokens', 'audit_log', 'domain_events', 'processed_events', 'idempotency_keys'];
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = true
      AND tablename <> ALL (excluded)
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'CREATE POLICY s10_developer_deny ON %I AS RESTRICTIVE FOR ALL TO medini_app USING (app_role() <> ''developer'') WITH CHECK (app_role() <> ''developer'')',
      t
    );
  END LOOP;
END $$;
