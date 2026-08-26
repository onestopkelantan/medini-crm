-- ============================================================================
-- 0032_documents_foundation.sql
-- SPRINT 8 — DOCUMENTS DOMAIN FOUNDATION + RLS
--
-- Adds the Documents domain catalog table (Sprint 8). Document bytes live in
-- S3-compatible object storage; this table is the branch-scoped catalog.
--
-- Adds:
--   1. document_status enum (active | archived | deleted)
--   2. documents table (branch-scoped, optional patient link, soft-delete)
--   3. Runtime role grants (medini_app: SELECT/INSERT/UPDATE — NO DELETE;
--      contract = no hard delete, 'deleted' is a soft status via deleted_at)
--   4. RLS (ENABLE + FORCE + WITH CHECK) mirroring ROLE_DOMAIN_MATRIX.documents:
--        hq            → all branches
--        branch_manager→ own branch
--        doctor        → own branch (fine-grained patient scoping in service)
--        branch_admin  → NONE (excluded here as DB-level defense in depth)
--      No context → fail-closed (COALESCE empty array → no rows).
--
-- Idempotent: safe to run multiple times (IF NOT EXISTS / DROP IF EXISTS /
-- EXCEPTION WHEN duplicate_object).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE document_status AS ENUM ('active', 'archived', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  patient_id   uuid REFERENCES patients(id) ON DELETE SET NULL,
  title        varchar(256) NOT NULL,
  category     varchar(64),
  file_name    varchar(512) NOT NULL,
  mime_type    varchar(128) NOT NULL,
  size_bytes   integer      NOT NULL,
  storage_key  text         NOT NULL,
  status       document_status NOT NULL DEFAULT 'active',
  uploaded_by  uuid,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS documents_org_branch_idx ON documents (org_id, branch_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS documents_patient_idx ON documents (patient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS documents_status_idx ON documents (status);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. RUNTIME ROLE GRANTS (medini_app — non-owner, RLS-subject; no DELETE)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON documents TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. RLS — documents (branch scope; branch_admin excluded)
-- ----------------------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS documents_scope ON documents;
--> statement-breakpoint
CREATE POLICY documents_scope ON documents
  USING (
    app_role() = 'hq'
    OR (
      app_role() IN ('branch_manager', 'doctor')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))
    )
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (
      app_role() IN ('branch_manager', 'doctor')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))
    )
  );
--> statement-breakpoint
