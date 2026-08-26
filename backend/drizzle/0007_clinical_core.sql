-- ============================================================================
-- SPRINT 3 (S3-A) — CLINICAL CORE: DATABASE & SECURITY FOUNDATION (PART 1)
--
-- Scope: treatment catalog (reference data ONLY), encounters, clinical notes
-- (SOAP, immutable after sign — ADR-009), tooth records (FDI),
-- treatment plans (lifecycle draft→proposed→accepted→active→completed|cancelled
-- — Blueprint §5/§28), treatment plan items, treatment sessions.
--
-- Boundaries preserved:
--   ADR-004 — treatment catalog has NO price/cost/invoice/payment/revenue/
--   outstanding/bukku columns. Clinical is NOT Finance. Finance sprint will
--   consume treatment_id/plan_id references; ownership is never reversed.
--   ADR-009 — clinical_notes rows are immutable after signing: medini_app
--   receives SELECT/INSERT only (NO UPDATE/DELETE — hard-immutable at the
--   privilege level); amendments are new version rows (amends_note_id).
--   M-2 debt — same as payors (0006): org isolation is enforced by
--   server-derived org_id predicates in every repository query; no app.org_id
--   GUC exists and none is invented here (documented governance debt).
--
-- Doctor own-scope (Sprint 3 decision: STRICT own): DB-level on
-- branch-carrying tables — doctor_id = app_doctor_id() in both USING and
-- WITH CHECK; for parent-scoped tables (notes/items/sessions/tooth_records)
-- DB RLS is branch-level via parent and STRICT doctor ownership is enforced
-- at the service layer (mirrors PERMISSION_MATRIX can() 'own' contract and
-- the locked frontend parity rule — the Clinical surface renders ONLY the
-- doctor's own records).
--
-- Scope classification:
--   treatment_catalog : ORG-WIDE (read all roles; write HQ)
--   encounters          : BRANCH-SCOPED + doctor-owned
--   treatment_plans     : BRANCH-SCOPED + doctor-owned
--   clinical_notes      : DOCTOR-SCOPED (via encounter parent; branch RLS)
--   plan items/sessions : via parent plan/encounter
--   tooth_records       : BRANCH-SCOPED + doctor-owned (per-encounter chart)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. GUC HELPER — app_doctor_id() (mirrors app_role()/app_branch_ids() from
--    0002; the GUC is already set transaction-locally by DbContextService).
--    NULL/'' when the principal is not a doctor → strict doctor predicates
--    fail closed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_doctor_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.doctor_id', true), '')
$$;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 1. ENUMS (lowercase codes — appointments/audit convention)
-- ----------------------------------------------------------------------------
CREATE TYPE "public"."encounter_status" AS ENUM('open', 'completed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'proposed', 'accepted', 'active', 'completed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."plan_item_status" AS ENUM('pending', 'done');
--> statement-breakpoint
CREATE TYPE "public"."tooth_condition" AS ENUM('healthy', 'decayed', 'filled', 'missing', 'crowned', 'root_canal', 'implant');
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. TREATMENT_CATALOG — org-wide clinical reference data (NO pricing).
--    Code is a stable human key (TRT-#### via OrgAllocator); Finance may
--    reference treatment_id later without Clinical owning any money fields.
-- ----------------------------------------------------------------------------
CREATE TABLE "treatment_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,                  /* TRT-#### (allocator) */
	"name" varchar(256) NOT NULL,
	"category" varchar(64) NOT NULL,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_catalog_org_code_uq"
	ON "treatment_catalog" USING btree ("org_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_catalog_org_name_uq"
	ON "treatment_catalog" USING btree ("org_id", lower("name")) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX "treatment_catalog_org_cat_idx"
	ON "treatment_catalog" USING btree ("org_id","category");
--> statement-breakpoint
ALTER TABLE "treatment_catalog" ADD CONSTRAINT "treatment_catalog_duration_positive" CHECK (duration_min > 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. ENCOUNTERS — canonical clinical case (patient × appointment × doctor).
-- ----------------------------------------------------------------------------
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"appointment_id" uuid REFERENCES "appointments"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"encounter_code" varchar(32) NOT NULL,        /* ENC-#### (allocator) */
	"status" "encounter_status" DEFAULT 'open' NOT NULL,
	"chief_complaint" varchar(512),
	"allergy_acknowledged_at" timestamp with time zone, /* safety gate S3-B */
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_org_code_uq"
	ON "encounters" USING btree ("org_id","encounter_code");
--> statement-breakpoint
CREATE INDEX "encounters_patient_idx"
	ON "encounters" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "encounters_branch_idx"
	ON "encounters" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "encounters_doctor_idx"
	ON "encounters" USING btree ("doctor_id");
--> statement-breakpoint
CREATE INDEX "encounters_appt_idx"
	ON "encounters" USING btree ("appointment_id");
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_completed_requires_ts"
	CHECK (status <> 'completed' OR completed_at IS NOT NULL);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. CLINICAL_NOTES — SOAP, append-only versions; immutable after sign (ADR-009).
--    Grants: SELECT/INSERT ONLY. Amendment = new row with amends_note_id.
-- ----------------------------------------------------------------------------
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid NOT NULL REFERENCES "encounters"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"soap_subjective" text,
	"soap_objective" text,
	"soap_assessment" text,
	"soap_plan" text,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"amends_note_id" uuid REFERENCES "clinical_notes"("id") ON DELETE restrict,
	"superseded_by_note_id" uuid REFERENCES "clinical_notes"("id") ON DELETE restrict,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
	/* NO updated_at / deleted_at — append-only discipline (audit_log pattern) */
);
--> statement-breakpoint
CREATE INDEX "clinical_notes_encounter_idx"
	ON "clinical_notes" USING btree ("encounter_id");
--> statement-breakpoint
CREATE INDEX "clinical_notes_patient_idx"
	ON "clinical_notes" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "clinical_notes_doctor_idx"
	ON "clinical_notes" USING btree ("doctor_id");
--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_signed_complete"
	CHECK (signed_at IS NULL OR signed_by IS NOT NULL);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 5. TOOTH_RECORDS — FDI permanent dentition chart snapshot per encounter.
--    One row per (encounter, tooth) — upsert-by-conflict replaces the row
--    before sign-off (mutable pre-completion, encounter discipline governs).
-- ----------------------------------------------------------------------------
CREATE TABLE "tooth_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid NOT NULL REFERENCES "encounters"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"fdi_no" integer NOT NULL,
	"condition" "tooth_condition" NOT NULL,
	"surfaces" jsonb,
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tooth_records_enc_tooth_uq"
	ON "tooth_records" USING btree ("encounter_id","fdi_no");
--> statement-breakpoint
CREATE INDEX "tooth_records_patient_idx"
	ON "tooth_records" USING btree ("patient_id","fdi_no");
--> statement-breakpoint
ALTER TABLE "tooth_records" ADD CONSTRAINT "tooth_records_fdi_valid" CHECK (
	fdi_no IN (11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,
	           31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48)
);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 6. TREATMENT_PLANS — lifecycle per Blueprint §28.
-- ----------------------------------------------------------------------------
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"plan_code" varchar(32) NOT NULL,             /* TPL-#### (allocator) */
	"title" varchar(256) NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"consent_required" boolean DEFAULT false NOT NULL,
	"proposed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plans_org_code_uq"
	ON "treatment_plans" USING btree ("org_id","plan_code");
--> statement-breakpoint
CREATE INDEX "treatment_plans_patient_idx"
	ON "treatment_plans" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "treatment_plans_branch_idx"
	ON "treatment_plans" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "treatment_plans_doctor_idx"
	ON "treatment_plans" USING btree ("doctor_id");
--> statement-breakpoint
CREATE INDEX "treatment_plans_encounter_idx"
	ON "treatment_plans" USING btree ("encounter_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 7. TREATMENT_PLAN_ITEMS — catalog-referenced lines. NO price (ADR-004).
-- ----------------------------------------------------------------------------
CREATE TABLE "treatment_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "treatment_plans"("id") ON DELETE cascade,
	"treatment_id" uuid REFERENCES "treatment_catalog"("id") ON DELETE restrict,
	"description" varchar(256) NOT NULL,
	"tooth_fdi" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" "plan_item_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "treatment_plan_items_plan_idx"
	ON "treatment_plan_items" USING btree ("plan_id");
--> statement-breakpoint
CREATE INDEX "treatment_plan_items_treatment_idx"
	ON "treatment_plan_items" USING btree ("treatment_id");
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_qty_positive" CHECK (quantity > 0);
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_fdi_valid" CHECK (
	tooth_fdi IS NULL OR tooth_fdi IN (11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,
	                                 31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48)
);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 8. TREATMENT_SESSIONS — one row per performed session of a plan.
-- ----------------------------------------------------------------------------
CREATE TABLE "treatment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "treatment_plans"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"session_no" integer NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
	/* sessions are clinical facts — append-only, corrected by a new session */
);
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_sessions_plan_no_uq"
	ON "treatment_sessions" USING btree ("plan_id","session_no");
--> statement-breakpoint
CREATE INDEX "treatment_sessions_plan_idx"
	ON "treatment_sessions" USING btree ("plan_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 9. RUNTIME ROLE GRANTS (medini_app — non-owner, RLS-subject)
--    Mutable tables: SELECT/INSERT/UPDATE — NO DELETE (0003 contract).
--    Append-only / immutable (clinical_notes, treatment_sessions):
--    SELECT/INSERT ONLY — ADR-009 hard-immutability at privilege level.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON treatment_catalog TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON encounters TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON clinical_notes TO medini_app;
--> statement-breakpoint
/* ADR-009 signing path: content columns are INSERT-only forever, but the
 * one-way sign/supersede transition runs through the runtime connection, so
 * UPDATE is granted STRICTLY on the signing columns. The signing statements
 * additionally carry `signed_at IS NULL` / `superseded_by_note_id IS NULL`
 * predicates — a signed note can never be re-signed or superseded. */
GRANT UPDATE (signed_at, signed_by, superseded_by_note_id) ON clinical_notes TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tooth_records TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON treatment_plans TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON treatment_plan_items TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON treatment_sessions TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 10. RLS — ENABLE + FORCE + WITH CHECK (0003 discipline).
--     hq/branch_manager : org/branch read (write blocked by app matrix —
--     clinical create/edit = doctor own only).
--     doctor            : STRICT own — doctor_id = app_doctor_id().
--     branch_admin      : clinical = NONE in ROLE_DOMAIN_MATRIX → no policy
--     grants visibility (fail-closed: app_branch_ids contains their branch,
--     but doctor predicate / role list excludes them).
-- ----------------------------------------------------------------------------
ALTER TABLE treatment_catalog ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE treatment_catalog FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treatment_catalog_scope ON treatment_catalog
  USING (
    app_role() IN ('hq', 'branch_manager', 'branch_admin', 'doctor')
  )
  WITH CHECK (
    app_role() = 'hq'
  );
--> statement-breakpoint

ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE encounters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY encounters_scope ON encounters
  USING (
    (app_role() IN ('hq', 'branch_manager')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinical_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clinical_notes_scope ON clinical_notes
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE tooth_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tooth_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tooth_records_scope ON tooth_records
  USING (
    (app_role() IN ('hq', 'branch_manager')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE treatment_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treatment_plans_scope ON treatment_plans
  USING (
    (app_role() IN ('hq', 'branch_manager')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE treatment_plan_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE treatment_plan_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treatment_plan_items_scope ON treatment_plan_items
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND plan_id IN (
      SELECT tp.id FROM treatment_plans tp
      WHERE tp.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
    OR (app_role() = 'doctor' AND plan_id IN (
      SELECT tp.id FROM treatment_plans tp
      WHERE tp.doctor_id::text = app_doctor_id()))
  )
  WITH CHECK (
    app_role() = 'doctor' AND plan_id IN (
      SELECT tp.id FROM treatment_plans tp
      WHERE tp.doctor_id::text = app_doctor_id())
  );
--> statement-breakpoint

ALTER TABLE treatment_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE treatment_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treatment_sessions_scope ON treatment_sessions
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND plan_id IN (
      SELECT tp.id FROM treatment_plans tp
      WHERE tp.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 11. ALLOCATOR SEQUENCES — canonical org only (0005/0006 pattern).
--     medini_enc_00000001 → ENC-#### ; medini_tpl_00000001 → TPL-####
--     MRN/APT/PNL/INS sequences untouched (regression-tested).
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS medini_enc_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_tpl_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_trt_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
