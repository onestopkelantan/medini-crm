-- ============================================================================
-- SPRINT 10 — FINANCE CONFIG: expense categories, payment methods, alert rules
-- Adds:
--   1. finance_managed_status enum (active | archived)
--   2. finance_alert_comparator enum (lt | lte | gt | gte | eq)
--   3. expense_categories, payment_methods, finance_alert_rules tables
--      (branch-scoped, soft-delete; reuse existing finance_alert_severity enum)
--   4. Grants (medini_app: SELECT/INSERT/UPDATE — no DELETE)
--   5. RLS mirroring ROLE_DOMAIN_MATRIX.finance:
--        hq             → all branches
--        branch_manager → own branch
--        branch_admin / doctor → NONE
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE finance_managed_status AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE finance_alert_comparator AS ENUM ('lt', 'lte', 'gt', 'gte', 'eq');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS expense_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name         varchar(128) NOT NULL,
  code         varchar(64),
  description  varchar(256),
  status       finance_managed_status NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_methods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name         varchar(128) NOT NULL,
  kind         varchar(32),
  details      varchar(256),
  status       finance_managed_status NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finance_alert_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name         varchar(256) NOT NULL,
  metric       varchar(64) NOT NULL,
  comparator   finance_alert_comparator NOT NULL,
  threshold    numeric(19,4) NOT NULL,
  severity     finance_alert_severity NOT NULL,
  window_days  integer,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS expense_categories_branch_status_idx ON expense_categories (branch_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_methods_branch_status_idx ON payment_methods (branch_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS finance_alert_rules_branch_active_idx ON finance_alert_rules (branch_id, active);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON expense_categories, payment_methods, finance_alert_rules TO medini_app;
--> statement-breakpoint

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_alert_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_alert_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS expense_categories_scope ON expense_categories;
--> statement-breakpoint
CREATE POLICY expense_categories_scope ON expense_categories
  USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))));
--> statement-breakpoint
DROP POLICY IF EXISTS payment_methods_scope ON payment_methods;
--> statement-breakpoint
CREATE POLICY payment_methods_scope ON payment_methods
  USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))));
--> statement-breakpoint
DROP POLICY IF EXISTS finance_alert_rules_scope ON finance_alert_rules;
--> statement-breakpoint
CREATE POLICY finance_alert_rules_scope ON finance_alert_rules
  USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))));
--> statement-breakpoint
