-- ============================================================================
-- SPRINT 2A T1 — PAYOR MASTER DATA (DATABASE & SECURITY FOUNDATION)
--
-- Adds org-wide master data for future Finance/Payment integration:
--   1. payor_status enum (Active|Inactive) — shared by both tables
--   2. panel_companies      (org-wide; NO branch_id by design — payer
--      references are reusable across branches; no branch ownership invented)
--   3. insurance_companies  (same conventions)
--   4. medini_app grants: SELECT/INSERT/UPDATE — NO DELETE (soft-delete via
--      deleted_at, same contract as 0003: hard delete denied at privilege level)
--   5. RLS ENABLE + FORCE + WITH CHECK, role-based (org-wide tables → no
--      branch GUC in policy):
--        read : hq, branch_manager
--        write: hq only
--        reception(branch_admin)/doctor: denied at BOTH app guard (finance
--        domain = NONE in ROLE_DOMAIN_MATRIX) and DB policy layers
--   6. allocator sequences medini_pnl_<org-key> / medini_ins_<org-key> for the
--      canonical org — same pattern as 0005 (application allocator methods
--      arrive in 2A-T2; T1 creates the DB foundation only)
--
-- ADR-004 preserved: payment STATUS layer only. NO invoice/payment/revenue/
-- outstanding/bukku columns. NO speculative future fields.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM — follows existing Title-case convention (patient_status/staff_status)
-- ----------------------------------------------------------------------------
CREATE TYPE "public"."payor_status" AS ENUM('Active', 'Inactive');
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. PANEL_COMPANIES — org-wide panel master data
-- ----------------------------------------------------------------------------
CREATE TABLE "panel_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,                 /* PNL-#### (allocator in 2A-T2) */
	"name" varchar(256) NOT NULL,
	"pic" varchar(256),
	"phone" varchar(64),
	"address" text,
	"status" "payor_status" DEFAULT 'Active' NOT NULL,
	"source" varchar(16) DEFAULT 'custom' NOT NULL, /* custom|builtin|seed */
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. INSURANCE_COMPANIES — org-wide insurance master data (initially empty)
-- ----------------------------------------------------------------------------
CREATE TABLE "insurance_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,                 /* INS-#### (allocator in 2A-T2) */
	"name" varchar(256) NOT NULL,
	"pic" varchar(256),
	"phone" varchar(64),
	"address" text,
	"status" "payor_status" DEFAULT 'Active' NOT NULL,
	"source" varchar(16) DEFAULT 'custom' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. CONSTRAINTS + INDEXES (only what expected queries justify)
--    - code: unique natural key per org (mirrors patients_org_mrn_uq pattern)
--    - name: case-insensitive unique per org via lower(); PARTIAL on
--      deleted_at IS NULL mirrors the existing nullable-IC convention
--      (patients_org_ic_uq applies the unique index to live rows only) —
--      Active AND Inactive records still count as duplicates; only
--      soft-deleted rows are excluded.
--    - (org_id, status): list/filter queries
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "panel_companies_org_code_uq"
	ON "panel_companies" USING btree ("org_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "panel_companies_org_name_uq"
	ON "panel_companies" USING btree ("org_id", lower("name")) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX "panel_companies_org_status_idx"
	ON "panel_companies" USING btree ("org_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_companies_org_code_uq"
	ON "insurance_companies" USING btree ("org_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_companies_org_name_uq"
	ON "insurance_companies" USING btree ("org_id", lower("name")) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX "insurance_companies_org_status_idx"
	ON "insurance_companies" USING btree ("org_id","status");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 5. RUNTIME ROLE GRANTS (medini_app — non-owner, RLS-subject)
--    SELECT/INSERT/UPDATE only. NO DELETE (0003 contract: soft-delete only).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON panel_companies TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON insurance_companies TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 6. RLS — ENABLE + FORCE + role-based policies (org-wide tables).
--    Org isolation is enforced by server-derived org_id predicates in every
--    repository query (existing Medini convention — no app.org_id GUC exists
--    and none is invented here). RLS is the role/scope boundary, same as the
--    audited 0002/0003/0004 pattern: fail-closed when no app context is set.
-- ----------------------------------------------------------------------------
ALTER TABLE panel_companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE panel_companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY panel_companies_scope ON panel_companies
  USING (
    app_role() IN ('hq', 'branch_manager')
  )
  WITH CHECK (
    app_role() = 'hq'
  );
--> statement-breakpoint

ALTER TABLE insurance_companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE insurance_companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY insurance_companies_scope ON insurance_companies
  USING (
    app_role() IN ('hq', 'branch_manager')
  )
  WITH CHECK (
    app_role() = 'hq'
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 7. ALLOCATOR SEQUENCES — canonical org only
--    (00000000-0000-0000-0000-000000000001 → key 00000001), same pattern as
--    0005_org_sequences.sql. Sequences are NOT subject to RLS; nextval is
--    atomic under concurrency. Other orgs get sequences via the admin path.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS medini_pnl_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_ins_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
