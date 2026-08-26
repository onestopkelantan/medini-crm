-- Sprint 8 T1: N6-2/N5-6 approved cross-sprint RLS organisation hardening.
-- Additive only. Existing permissive role/branch policies remain in force.

ALTER TABLE wa_channels ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz;
ALTER TABLE wa_channels ADD COLUMN IF NOT EXISTS auto_pause_resumed_at timestamptz;
ALTER TABLE wa_channels ADD COLUMN IF NOT EXISTS qr_code text;
ALTER TABLE wa_channels ADD COLUMN IF NOT EXISTS qr_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS wa_channels_auto_pause_idx ON wa_channels(auto_paused_at) WHERE auto_paused_at IS NOT NULL;

-- Fail closed when a transaction has no trusted organisation context.
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- Every existing RLS table with org_id receives a restrictive predicate. This
-- composes with its pre-existing role and branch policies; it never replaces them.
-- `branches` is EXCLUDED: it is the branch registry that runAs() must read to
-- establish the RLS context (chicken-and-egg). Its visibility is already
-- enforced by branches_scope (hq=all, others=own branch); in single-tenant all
-- branches belong to the canonical org, so org-isolating the registry adds no
-- value and breaks context establishment.

-- organizations is ROOT-scoped (id is the organisation identity, no org_id).
-- It remains human-governed; system workers receive no policy for it.

-- Outbox is system-scoped but still organisation-bound. Its trusted envelope is
-- stored in first-class columns, never inferred from arbitrary payload fields.
ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s8_domain_events_org ON domain_events;
CREATE POLICY s8_domain_events_org ON domain_events AS RESTRICTIVE FOR ALL
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
DROP POLICY IF EXISTS s8_domain_events_human_scope ON domain_events;
CREATE POLICY s8_domain_events_human_scope ON domain_events FOR ALL
  USING (app_role() = 'hq' OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))
  WITH CHECK (app_role() = 'hq' OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));
DROP POLICY IF EXISTS s8_domain_events_worker ON domain_events;
CREATE POLICY s8_domain_events_worker ON domain_events FOR ALL
  USING (app_role() = 'system_worker' AND (branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'system_worker' AND (branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));

ALTER TABLE processed_events ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE processed_events ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s8_processed_events_org ON processed_events;
CREATE POLICY s8_processed_events_org ON processed_events AS RESTRICTIVE FOR ALL
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
DROP POLICY IF EXISTS s8_processed_events_worker ON processed_events;
CREATE POLICY s8_processed_events_worker ON processed_events FOR ALL
  USING (app_role() = 'system_worker' AND (branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'system_worker' AND (branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE UNIQUE INDEX IF NOT EXISTS processed_events_consumer_event_org_uq ON processed_events(consumer, event_id, org_id);

GRANT SELECT, INSERT, UPDATE ON processed_events TO medini_app;

-- F-11: Worker least privilege — legacy human policies must NOT grant system_worker access.
-- system_worker is explicitly granted ONLY on the 6 S8 worker tables above.
-- All other legacy human policies are amended to exclude system_worker.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname NOT IN ('domain_events', 'processed_events', 'wa_channels', 'wa_messages', 'recall_cases', 'bukku_sync_records', 'branches', 'organizations')
      AND EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.relname AND x.column_name = 'org_id')
  LOOP
    /* For each table, check if any non-s8 policy lacks system_worker exclusion */
    IF EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname NOT LIKE 's8_%'
        AND p.qual NOT LIKE '%system_worker%'
    ) THEN
      /* Create a restrictive policy that blocks system_worker from non-worker tables */
      EXECUTE format('DROP POLICY IF EXISTS s8_worker_exclusion ON %I', r.table_name);
      EXECUTE format('CREATE POLICY s8_worker_exclusion ON %I AS RESTRICTIVE FOR ALL USING (app_role() <> ''system_worker'') WITH CHECK (app_role() <> ''system_worker'')', r.table_name);
    END IF;
  END LOOP;
END $$;

-- F-10: Org isolation applied AFTER all tables have RLS enabled.
DROP POLICY IF EXISTS s8_org_isolation ON branches;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name,
           EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.relname AND x.column_name = 'branch_id') AS has_branch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relname <> 'branches'
      AND EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.relname AND x.column_name = 'org_id')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS s8_org_isolation ON %I', r.table_name);
    EXECUTE format('CREATE POLICY s8_org_isolation ON %I AS RESTRICTIVE FOR ALL USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id())', r.table_name);
  END LOOP;
END $$;

-- T2: WhatsApp transport worker needs to read/lock channels and update message
-- status within its explicit org+branch scope. Least-privilege: only the two
-- tables the worker touches, only under system_worker + branch GUC.
DROP POLICY IF EXISTS s8_wa_channels_worker ON wa_channels;
CREATE POLICY s8_wa_channels_worker ON wa_channels FOR ALL
  USING (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))
  WITH CHECK (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));
DROP POLICY IF EXISTS s8_wa_messages_worker ON wa_messages;
CREATE POLICY s8_wa_messages_worker ON wa_messages FOR ALL
  USING (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))
  WITH CHECK (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));

-- T3: Recall worker needs to read/update recall cases within its explicit scope.
DROP POLICY IF EXISTS s8_recall_cases_worker ON recall_cases;
CREATE POLICY s8_recall_cases_worker ON recall_cases FOR ALL
  USING (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))
  WITH CHECK (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));

-- T4: Bukku worker needs to read/update sync records within its explicit scope.
-- bukku_sync_records has NO branch_id (org-scoped only) — worker policy uses org only.
DROP POLICY IF EXISTS s8_bukku_sync_worker ON bukku_sync_records;
CREATE POLICY s8_bukku_sync_worker ON bukku_sync_records FOR ALL
  USING (app_role() = 'system_worker')
  WITH CHECK (app_role() = 'system_worker');

