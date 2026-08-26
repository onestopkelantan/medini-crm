-- SPRINT 5 T1: Marketing operational-record foundation. No delivery, queue, or external integration.
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'qualified', 'converted', 'lost');
CREATE TYPE campaign_status AS ENUM ('draft', 'pending_approval', 'approved', 'cancelled', 'archived');
CREATE TYPE recall_status AS ENUM ('open', 'completed', 'cancelled');
CREATE TYPE follow_up_status AS ENUM ('open', 'completed', 'cancelled');

CREATE TABLE leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 name varchar(256) NOT NULL, phone varchar(64), source varchar(64) NOT NULL, interested_treatment varchar(256), status lead_status NOT NULL DEFAULT 'new',
 assignee_id uuid REFERENCES staff(id) ON DELETE restrict, patient_id uuid REFERENCES patients(id) ON DELETE restrict,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 name varchar(256) NOT NULL, intent varchar(512) NOT NULL, audience_definition jsonb NOT NULL, template_reference varchar(256), status campaign_status NOT NULL DEFAULT 'draft',
 approved_at timestamptz, approved_by uuid REFERENCES staff(id) ON DELETE restrict,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE recall_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 name varchar(256) NOT NULL, treatment_code varchar(64), interval_months integer NOT NULL CHECK (interval_months > 0), active boolean NOT NULL DEFAULT true, effective_from date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE recall_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE restrict, recall_rule_id uuid REFERENCES recall_rules(id) ON DELETE restrict, due_date date NOT NULL,
 status recall_status NOT NULL DEFAULT 'open', assignee_id uuid REFERENCES staff(id) ON DELETE restrict, outcome varchar(512),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE follow_up_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE restrict, appointment_id uuid REFERENCES appointments(id) ON DELETE restrict, encounter_id uuid REFERENCES encounters(id) ON DELETE restrict,
 assignee_id uuid REFERENCES staff(id) ON DELETE restrict, due_date date NOT NULL, status follow_up_status NOT NULL DEFAULT 'open', outcome varchar(512),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE INDEX leads_branch_status_idx ON leads(branch_id, status); CREATE INDEX leads_org_source_idx ON leads(org_id, source);
CREATE INDEX campaigns_branch_status_idx ON campaigns(branch_id, status); CREATE INDEX recall_rules_branch_active_idx ON recall_rules(branch_id, active);
CREATE INDEX recall_cases_branch_status_due_idx ON recall_cases(branch_id, status, due_date); CREATE INDEX recall_cases_patient_idx ON recall_cases(patient_id);
CREATE INDEX follow_up_cases_branch_status_due_idx ON follow_up_cases(branch_id, status, due_date); CREATE INDEX follow_up_cases_patient_idx ON follow_up_cases(patient_id);
-- Logical recall identity: one active/historical case for patient + rule + due date. A null rule has its own deterministic key.
CREATE UNIQUE INDEX recall_cases_rule_identity_uq ON recall_cases(org_id, patient_id, recall_rule_id, due_date) WHERE deleted_at IS NULL AND recall_rule_id IS NOT NULL;
CREATE UNIQUE INDEX recall_cases_no_rule_identity_uq ON recall_cases(org_id, patient_id, due_date) WHERE deleted_at IS NULL AND recall_rule_id IS NULL;
GRANT SELECT, INSERT, UPDATE ON leads, campaigns, recall_rules, recall_cases, follow_up_cases TO medini_app;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY; ALTER TABLE leads FORCE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY; ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE recall_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE recall_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE recall_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE recall_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE follow_up_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE follow_up_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY leads_scope ON leads USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY campaigns_scope ON campaigns USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY recall_rules_scope ON recall_rules USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY recall_cases_scope ON recall_cases USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY follow_up_cases_scope ON follow_up_cases USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
