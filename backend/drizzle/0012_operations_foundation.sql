-- SPRINT 5 T2+T3: Operations foundation + Operations-owned LabCase.
-- No scheduling side effects, no notification workers, no Finance writes.
CREATE TYPE doctor_status_state AS ENUM ('available', 'busy', 'break', 'offline');
CREATE TYPE checklist_state AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
CREATE TYPE task_state AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
CREATE TYPE incident_state AS ENUM ('open', 'acknowledged', 'resolved', 'closed');
CREATE TYPE incident_severity AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE task_priority AS ENUM ('urgent', 'high', 'normal', 'low');
CREATE TYPE lab_case_state AS ENUM ('open', 'in_progress', 'ready_for_billing', 'billing_submitted', 'completed', 'cancelled');

CREATE TABLE doctor_statuses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 doctor_id uuid NOT NULL REFERENCES staff(id) ON DELETE restrict, status doctor_status_state NOT NULL,
 effective_at timestamptz NOT NULL DEFAULT now(), note varchar(256),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE checklists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 checklist_date date NOT NULL, shift varchar(32), title varchar(256) NOT NULL, items jsonb NOT NULL,
 owner_id uuid REFERENCES staff(id) ON DELETE restrict, status checklist_state NOT NULL DEFAULT 'open', completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 title varchar(256) NOT NULL, description varchar(1024), priority task_priority NOT NULL DEFAULT 'normal',
 assignee_id uuid REFERENCES staff(id) ON DELETE restrict, due_date date, status task_state NOT NULL DEFAULT 'open', completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 title varchar(256) NOT NULL, description varchar(2048), severity incident_severity NOT NULL,
 owner_id uuid REFERENCES staff(id) ON DELETE restrict, status incident_state NOT NULL DEFAULT 'open',
 resolved_at timestamptz, closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE TABLE lab_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE restrict, encounter_id uuid REFERENCES encounters(id) ON DELETE restrict,
 lab_vendor varchar(256) NOT NULL, work_description varchar(512) NOT NULL, due_date date,
 status lab_case_state NOT NULL DEFAULT 'open', billing_submitted_at timestamptz, billing_submitted_by uuid REFERENCES staff(id) ON DELETE restrict,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE INDEX doctor_statuses_branch_idx ON doctor_statuses(branch_id);
CREATE INDEX doctor_statuses_doctor_effective_idx ON doctor_statuses(doctor_id, effective_at);
CREATE INDEX checklists_branch_date_idx ON checklists(branch_id, checklist_date);
CREATE INDEX checklists_branch_status_idx ON checklists(branch_id, status);
CREATE INDEX tasks_branch_status_idx ON tasks(branch_id, status);
CREATE INDEX tasks_assignee_idx ON tasks(assignee_id);
CREATE INDEX tasks_due_date_idx ON tasks(due_date);
CREATE INDEX incidents_branch_status_idx ON incidents(branch_id, status);
CREATE INDEX incidents_branch_severity_idx ON incidents(branch_id, severity);
CREATE INDEX lab_cases_branch_status_idx ON lab_cases(branch_id, status);
CREATE INDEX lab_cases_patient_idx ON lab_cases(patient_id);
-- one billing submission per lab case (defensive; service enforces single transition too)
CREATE UNIQUE INDEX lab_cases_billing_once_uq ON lab_cases(org_id, id) WHERE billing_submitted_at IS NOT NULL AND deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON doctor_statuses, checklists, tasks, incidents, lab_cases TO medini_app;
ALTER TABLE doctor_statuses ENABLE ROW LEVEL SECURITY; ALTER TABLE doctor_statuses FORCE ROW LEVEL SECURITY;
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY; ALTER TABLE checklists FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY; ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY; ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE lab_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE lab_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY doctor_statuses_scope ON doctor_statuses USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY checklists_scope ON checklists USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY tasks_scope ON tasks USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY incidents_scope ON incidents USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY lab_cases_scope ON lab_cases USING (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() = 'branch_manager' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
