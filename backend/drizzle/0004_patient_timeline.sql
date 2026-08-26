-- ============================================================================
-- SPRINT 2 T1 — PATIENT TIMELINE FOUNDATION + RLS EXTENSION
-- Adds:
--   1. patient_timeline_events  (append-only activity feed — NOT a source of
--      truth for patient state; no updated_at / deleted_at by design)
--   2. RLS (ENABLE + FORCE + WITH CHECK) on patient_relationships
--   3. RLS (ENABLE + FORCE + WITH CHECK) on patient_timeline_events
-- Scope model: both tables derive scope from their PARENT PATIENT's branch
-- (patients.branch_id). This closes the bypass where a relationship/timeline
-- row could leak a cross-branch patient. hq retains full access; no context
-- → fail-closed (COALESCE empty array → no rows).
-- Runtime role grant: medini_app gets SELECT/INSERT (timeline is append-only
-- → no UPDATE/DELETE for the runtime role). relationships get UPDATE for
-- soft correction; DELETE stays denied (contract = no hard delete).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_timeline_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type            varchar(64)  NOT NULL,
  summary         varchar(512) NOT NULL,
  payload         jsonb,
  actor_id        uuid,
  actor_role      varchar(32),
  source          varchar(32)  NOT NULL DEFAULT 'api',
  correlation_id  varchar(128),
  created_at      timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_timeline_patient_idx
  ON patient_timeline_events (patient_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_timeline_type_idx
  ON patient_timeline_events (type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_rel_related_idx
  ON patient_relationships (related_patient_id);

-- ----------------------------------------------------------------------------
-- 2. RUNTIME ROLE GRANTS (medini_app — non-owner, RLS-subject)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON patient_timeline_events TO medini_app;
GRANT SELECT, INSERT, UPDATE ON patient_relationships TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. RLS — patient_relationships (scope via parent patient branch)
-- ----------------------------------------------------------------------------
ALTER TABLE patient_relationships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_relationships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS patient_relationships_scope ON patient_relationships;
--> statement-breakpoint
CREATE POLICY patient_relationships_scope ON patient_relationships
  USING (
    app_role() = 'hq'
    OR patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))
    )
  )
  WITH CHECK (
    app_role() = 'hq'
    OR patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))
    )
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. RLS — patient_timeline_events (scope via parent patient branch)
-- ----------------------------------------------------------------------------
ALTER TABLE patient_timeline_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_timeline_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS patient_timeline_events_scope ON patient_timeline_events;
--> statement-breakpoint
CREATE POLICY patient_timeline_events_scope ON patient_timeline_events
  USING (
    app_role() = 'hq'
    OR patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))
    )
  )
  WITH CHECK (
    app_role() = 'hq'
    OR patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))
    )
  );
--> statement-breakpoint
