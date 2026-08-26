-- ============================================================================
-- SPRINT 7 T2: SETTINGS production foundation.
-- Configuration registry + hierarchical scopes + versioned values + SecretRef.
-- Governance D9 (approved G9): SecretRef metadata ONLY — no secret values.
-- Effective precedence (approved): FEATURE > ROLE > BRANCH > ORGANIZATION > SYSTEM
-- (more specific scope overrides broader scope).
-- ============================================================================

CREATE TYPE settings_scope_level AS ENUM ('system', 'organization', 'branch', 'role', 'feature');
CREATE TYPE settings_value_type AS ENUM ('string', 'number', 'boolean', 'json');
CREATE TYPE secret_status AS ENUM ('ABSENT', 'REGISTERED', 'ROTATED', 'REVOKED');

-- 1. settings_definitions — the canonical config registry (what keys exist,
--    their type, which scopes are allowed, whether branch may override).
CREATE TABLE settings_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 key varchar(128) NOT NULL,
 value_type settings_value_type NOT NULL,
 description text,
 category varchar(64),
 default_value jsonb,
 /* which scopes this key may be set at (e.g. {system,organization,branch}) */
 allowed_scopes settings_scope_level[] NOT NULL DEFAULT '{system,organization,branch}',
 /* when false, branch-level override is rejected (non-overridable setting) */
 branch_overridable boolean NOT NULL DEFAULT true,
 /* locked config (e.g. canonical branch count, currency) — hq-only change + reason */
 locked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX settings_definitions_org_key_uq ON settings_definitions(org_id, key);
CREATE INDEX settings_definitions_category_idx ON settings_definitions(org_id, category);

-- 2. settings_values — the current value for a (key, scope, scope_ref).
--    scope_ref is NULL for system/organization; branch_id for branch; role for role; feature key for feature.
CREATE TABLE settings_values (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 key varchar(128) NOT NULL,
 scope settings_scope_level NOT NULL,
 scope_ref varchar(128),
 value jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,
 updated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX settings_values_scope_uq ON settings_values(org_id, key, scope, COALESCE(scope_ref, ''));
CREATE INDEX settings_values_key_idx ON settings_values(org_id, key);
CREATE INDEX settings_values_scope_idx ON settings_values(org_id, scope, scope_ref);

-- 3. settings_versions — immutable history of every change (append-only).
CREATE TABLE settings_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 key varchar(128) NOT NULL,
 scope settings_scope_level NOT NULL,
 scope_ref varchar(128),
 old_value jsonb,
 new_value jsonb,
 version integer NOT NULL,
 changed_by uuid,
 reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settings_versions_key_idx ON settings_versions(org_id, key, created_at);
CREATE INDEX settings_versions_scope_idx ON settings_versions(org_id, scope, scope_ref);

-- 4. secret_refs — metadata about secrets (approved G9). The actual secret value
--    lives in a server-side vault; this table stores ONLY the reference/metadata.
CREATE TABLE secret_refs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 key varchar(128) NOT NULL,
 vault_path varchar(256) NOT NULL,
 last_four varchar(8),
 status secret_status NOT NULL DEFAULT 'ABSENT',
 rotated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX secret_refs_org_key_uq ON secret_refs(org_id, key);

GRANT SELECT, INSERT, UPDATE ON settings_definitions, settings_values, secret_refs TO medini_app;
GRANT SELECT, INSERT ON settings_versions TO medini_app;

ALTER TABLE settings_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE settings_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE settings_values ENABLE ROW LEVEL SECURITY; ALTER TABLE settings_values FORCE ROW LEVEL SECURITY;
ALTER TABLE settings_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE settings_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE secret_refs ENABLE ROW LEVEL SECURITY; ALTER TABLE secret_refs FORCE ROW LEVEL SECURITY;

-- Settings RLS (approved matrix):
--   hq        → full (all scopes)
--   branch_manager → view + own-branch override (branch scope rows only for write)
--   branch_admin / receptionist / doctor → view effective (read) only
-- Write (WITH CHECK) is hq for system/org/role/feature; branch_manager may write
-- only branch-scope rows for their own branch (branch_overridable enforced in service).
CREATE POLICY settings_definitions_policy ON settings_definitions
  USING (app_role() IN ('hq','branch_manager','branch_admin','receptionist','doctor'))
  WITH CHECK (app_role() = 'hq');

CREATE POLICY settings_values_policy ON settings_values
  USING (
    app_role() = 'hq'
    OR app_role() IN ('branch_admin','receptionist','doctor')
    OR (app_role() = 'branch_manager' AND (scope <> 'branch' OR scope_ref::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND scope = 'branch' AND scope_ref::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );

CREATE POLICY settings_versions_policy ON settings_versions
  USING (app_role() IN ('hq','branch_manager','branch_admin','receptionist','doctor'))
  WITH CHECK (app_role() = 'hq' OR app_role() = 'branch_manager');

CREATE POLICY secret_refs_policy ON secret_refs
  USING (app_role() = 'hq')
  WITH CHECK (app_role() = 'hq');
