-- ============================================================================
-- SPRINT 2 REMEDIATION — ORG-SAFE ATOMIC ALLOCATORS (MRN + APT)
-- Addresses GLM findings #1 (MRN branch-scoped), #2 (APT code branch-scoped),
-- #8 (SELECT latest + 1 + INSERT race).
--
-- Approach: PostgreSQL named sequences per org, created idempotently by the
-- allocator at runtime (single-tenant design → one canonical org). Sequences
-- are NOT subject to RLS and are atomic under concurrency (nextval).
--
-- Sequence naming: medini_mrn_<org-key> / medini_apt_<org-key>, where org-key
-- is the last 8 hex chars of the org uuid (readable + safe). For the canonical
-- org this is '00000001'.
-- ============================================================================

-- Grant sequence usage to the runtime role.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medini_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Pre-create the allocator sequences for the CANONICAL org
-- (00000000-0000-0000-0000-000000000001 → key 00000001). Sequences for other
-- orgs are created by the admin/migration path before the runtime role uses
-- them; the runtime role has NO CREATE on schema public (defense-in-depth).
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS medini_mrn_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_apt_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;

