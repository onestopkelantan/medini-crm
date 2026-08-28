-- 0035: booking_requests - raw WhatsApp booking intake (pre-verification inbox).
-- Written by system_worker (WhatsApp webhook), read/managed by hq + branch admin.
-- Free-text intake only; NOT patient data. Admin verifies then converts to a
-- real appointment via the appointments module. RLS pattern mirrors domain_events.

CREATE TYPE booking_request_status AS ENUM ('pending', 'confirmed', 'rejected');

CREATE TABLE booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE set null,
  contact_phone varchar(64) NOT NULL,
  patient_name varchar(256),
  preferred_date varchar(64),
  preferred_time varchar(64),
  treatment varchar(256),
  branch_name varchar(256),
  raw_message text,
  status booking_request_status NOT NULL DEFAULT 'pending',
  linked_appointment_id uuid REFERENCES appointments(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX booking_requests_status_idx ON booking_requests(org_id, status, created_at);
CREATE INDEX booking_requests_branch_idx ON booking_requests(branch_id, status);

ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_requests_org ON booking_requests;
CREATE POLICY booking_requests_org ON booking_requests AS RESTRICTIVE FOR ALL
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());

DROP POLICY IF EXISTS booking_requests_human_scope ON booking_requests;
CREATE POLICY booking_requests_human_scope ON booking_requests FOR ALL
  USING (app_role() = 'hq' OR branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))
  WITH CHECK (app_role() = 'hq' OR branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));

DROP POLICY IF EXISTS booking_requests_worker ON booking_requests;
CREATE POLICY booking_requests_worker ON booking_requests FOR ALL
  USING (app_role() = 'system_worker' AND (branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))))
  WITH CHECK (app_role() = 'system_worker' AND (branch_id IS NULL OR branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));

GRANT SELECT, INSERT, UPDATE ON booking_requests TO medini_app;
