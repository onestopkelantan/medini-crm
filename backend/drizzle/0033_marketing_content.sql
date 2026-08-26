-- ============================================================================
-- SPRINT 9 — MARKETING CONTENT: templates + saved audience segments + RLS
-- Adds:
--   1. marketing_channel enum (whatsapp | sms | email)
--   2. marketing_template_status enum (draft | active | archived)
--   3. marketing_templates + marketing_segments tables (branch-scoped, soft-delete)
--   4. Runtime grants (medini_app: SELECT/INSERT/UPDATE — no DELETE)
--   5. RLS mirroring ROLE_DOMAIN_MATRIX.marketing:
--        hq             → all branches
--        branch_manager → own branch
--        branch_admin / doctor → NONE (excluded; marketing is HQ + manager only)
--      No context → fail-closed (COALESCE empty array → no rows).
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE marketing_channel AS ENUM ('whatsapp', 'sms', 'email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE marketing_template_status AS ENUM ('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS marketing_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name         varchar(256) NOT NULL,
  channel      marketing_channel NOT NULL,
  category     varchar(64),
  subject      varchar(256),
  body         text NOT NULL,
  variables    jsonb,
  status       marketing_template_status NOT NULL DEFAULT 'draft',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketing_segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name         varchar(256) NOT NULL,
  filters      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketing_templates_branch_channel_status_idx
  ON marketing_templates (branch_id, channel, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketing_segments_branch_idx
  ON marketing_segments (branch_id);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON marketing_templates, marketing_segments TO medini_app;
--> statement-breakpoint

ALTER TABLE marketing_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE marketing_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE marketing_segments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE marketing_segments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS marketing_templates_scope ON marketing_templates;
--> statement-breakpoint
CREATE POLICY marketing_templates_scope ON marketing_templates
  USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))));
--> statement-breakpoint
DROP POLICY IF EXISTS marketing_segments_scope ON marketing_segments;
--> statement-breakpoint
CREATE POLICY marketing_segments_scope ON marketing_segments
  USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))));
--> statement-breakpoint
