-- ============================================================================
-- SPRINT 7 T1: ADMINISTRATION production foundation.
-- Governance D1 (approved G1): canonical organizations record (single org).
-- Governance D2 (approved G2): staff lifecycle gains INVITED (additive enum
-- value — existing rows unaffected, lifecycle now INVITED→ACTIVE→SUSPENDED→
-- DEACTIVATED; no destructive delete).
-- This migration is ADDITIVE ONLY: it does not alter any existing table,
-- policy, grant, or data beyond appending one enum value.
-- ============================================================================

-- 1. ORGANIZATIONS — canonical single-tenant record (org_id reserved multi-tenant).
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(256) NOT NULL,
 registration_no varchar(64),
 hq_address text,
 status varchar(16) NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid
);

-- Seed the canonical organization (approved G1). Idempotent by fixed id.
INSERT INTO organizations (id, name, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Medini Dental Group', 'active')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON organizations TO medini_app;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- Org governance record: read = hq + branch roles (branch admins need org
-- identity context); WRITE rows are inserted by hq actors only (hq satisfies
-- the check); non-hq roles cannot insert/update (fail-closed).
CREATE POLICY organizations_scope ON organizations
  USING (app_role() IN ('hq','branch_manager','branch_admin','receptionist','doctor'))
  WITH CHECK (app_role() = 'hq');

-- 2. STAFF LIFECYCLE — add INVITED (approved G2). Additive; no data touched.
ALTER TYPE staff_status ADD VALUE 'Invited';
