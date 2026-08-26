-- Sprint 9 T1 — Reports/Analytics foundation.
--
-- Canonical KPI registry (RPT_KPIS) + report usage audit trail.
-- Reports = READ / INTELLIGENCE LAYER (REPORTS-ANALYTICS-LOCKED.md):
-- these two tables are the ONLY persisted artifacts of the reports domain;
-- all facts remain owned by domain tables (sale_records, appointments, ...).
--
-- ADDITIVE ONLY. No existing table/policy is modified.
-- RLS follows the S8 N9 checklist: org-isolation RESTRICTIVE + per-command
-- permissives, COALESCE-null-safe quals, no worker policies (no worker
-- touches these tables), append-only audit (no UPDATE/DELETE).

--> statement-breakpoint

-- ============================================================================
-- 1. kpi_definitions — canonical KPI registry (Reports OWNS KpiDefinition)
-- ============================================================================
CREATE TABLE IF NOT EXISTS kpi_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  kpi_key       varchar(64) NOT NULL,
  name          varchar(128) NOT NULL,
  formula       text NOT NULL,
  source_domain varchar(32) NOT NULL,
  unit          varchar(16) NOT NULL,
  scope_rules   jsonb NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  status        varchar(16) NOT NULL DEFAULT 'published',
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kpi_definitions_org_key_version_uq
  ON kpi_definitions (org_id, kpi_key, version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kpi_definitions_org_idx ON kpi_definitions (org_id);
--> statement-breakpoint

-- ============================================================================
-- 2. report_audit — immutable usage trail (Reports OWNS ReportAudit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  actor_id       uuid NOT NULL,
  actor_role     varchar(32) NOT NULL,
  action         varchar(48) NOT NULL,
  view           varchar(64) NOT NULL,
  filter         jsonb,
  correlation_id varchar(64) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS report_audit_org_created_idx ON report_audit (org_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS report_audit_org_actor_idx  ON report_audit (org_id, actor_id);
--> statement-breakpoint

-- ============================================================================
-- 3. RLS — kpi_definitions
--    Org isolation (RESTRICTIVE) + human read permissive + HQ-governed write.
--    No system_worker policy: workers never read/write the registry.
-- ============================================================================
ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kpi_definitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS s9_kpi_org_isolation ON kpi_definitions;
--> statement-breakpoint
CREATE POLICY s9_kpi_org_isolation ON kpi_definitions AS RESTRICTIVE FOR ALL
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
DROP POLICY IF EXISTS s9_kpi_human_select ON kpi_definitions;
--> statement-breakpoint
CREATE POLICY s9_kpi_human_select ON kpi_definitions FOR SELECT
  USING (COALESCE(app_role(), '') IN ('hq', 'branch_manager'));
--> statement-breakpoint
DROP POLICY IF EXISTS s9_kpi_hq_insert ON kpi_definitions;
--> statement-breakpoint
CREATE POLICY s9_kpi_hq_insert ON kpi_definitions FOR INSERT
  WITH CHECK (app_role() = 'hq');
--> statement-breakpoint
DROP POLICY IF EXISTS s9_kpi_hq_update ON kpi_definitions;
--> statement-breakpoint
CREATE POLICY s9_kpi_hq_update ON kpi_definitions FOR UPDATE
  USING (app_role() = 'hq') WITH CHECK (app_role() = 'hq');
--> statement-breakpoint
-- No DELETE policy: KPI definitions are versioned, never deleted.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON kpi_definitions TO medini_app;
--> statement-breakpoint

-- ============================================================================
-- 4. RLS — report_audit (append-only: SELECT + INSERT only, never UPDATE/DELETE)
-- ============================================================================
ALTER TABLE report_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE report_audit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS s9_report_audit_org_isolation ON report_audit;
--> statement-breakpoint
CREATE POLICY s9_report_audit_org_isolation ON report_audit AS RESTRICTIVE FOR ALL
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
DROP POLICY IF EXISTS s9_report_audit_human_select ON report_audit;
--> statement-breakpoint
CREATE POLICY s9_report_audit_human_select ON report_audit FOR SELECT
  USING (app_role() = 'hq');
--> statement-breakpoint
DROP POLICY IF EXISTS s9_report_audit_human_insert ON report_audit;
--> statement-breakpoint
CREATE POLICY s9_report_audit_human_insert ON report_audit FOR INSERT
  WITH CHECK (COALESCE(app_role(), '') IN ('hq', 'branch_manager'));
--> statement-breakpoint
-- No UPDATE/DELETE permissive → append-only (RESTRICTIVE org policy also blocks).
--> statement-breakpoint
GRANT SELECT, INSERT ON report_audit TO medini_app;
--> statement-breakpoint

-- ============================================================================
-- 5. Seed — canonical KPI registry (RPT_KPIS), Medini org, version 1.
--    Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================================
INSERT INTO kpi_definitions (org_id, kpi_key, name, formula, source_domain, unit, scope_rules, version, status)
SELECT '00000000-0000-0000-0000-000000000001', v.kpi_key, v.name, v.formula, v.source_domain, v.unit, v.scope_rules::jsonb, 1, 'published'
FROM (VALUES
  ('revenue',
   'Revenue (confirmed)',
   'SUM(sale_records.amount) WHERE status = ''confirmed'' AND sale_date IN period AND branch IN scope',
   'finance', 'MYR',
   '{"hq":"all","branch_manager":"branch"}'),
  ('revenue_per_appointment',
   'Revenue per Appointment',
   'revenue / COUNT(appointments WHERE status = ''completed'' AND scheduled_date IN period AND branch IN scope); unavailable when completed = 0',
   'finance', 'MYR',
   '{"hq":"all","branch_manager":"branch"}'),
  ('recall_rate',
   'Recall Rate',
   'COUNT(recall_cases WHERE status = ''completed'' AND due_date IN period AND branch IN scope) / COUNT(recall_cases WHERE status IN (''completed'',''cancelled'',''open'') AND due_date IN period AND branch IN scope); unavailable when denominator = 0',
   'marketing', 'percent',
   '{"hq":"all","branch_manager":"branch"}'),
  ('no_show_rate',
   'No-Show Rate',
   'COUNT(appointments WHERE status = ''no-show'' AND scheduled_date IN period AND branch IN scope) / COUNT(appointments WHERE status IN (''completed'',''no-show'') AND scheduled_date IN period AND branch IN scope); unavailable when denominator = 0',
   'appointments', 'percent',
   '{"hq":"all","branch_manager":"branch"}')
) AS v(kpi_key, name, formula, source_domain, unit, scope_rules)
ON CONFLICT (org_id, kpi_key, version) DO NOTHING;
