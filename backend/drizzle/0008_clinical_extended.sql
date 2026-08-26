-- ============================================================================
-- SPRINT 3 (S3-A) — CLINICAL EXTENDED: DATABASE & SECURITY FOUNDATION (PART 2)
--
-- Scope: consent templates (versioned) + consent records (immutable),
-- imaging records (metadata ONLY — no storage engine; Documents domain is a
-- future sprint), prescriptions, adverse events (immutable), referrals,
-- clinical timeline events (append-only derived feed).
--
-- Same boundaries as 0007: ADR-004 (no finance fields), ADR-009 (immutable
-- records get SELECT/INSERT grants only), strict doctor own-scope,
-- branch-scoped RLS + parent-patient subquery pattern (0004).
--
-- Scope classification:
--   consent_templates        : ORG-WIDE (read clinical-capable roles; write HQ)
--   consent_records          : DOCTOR-SCOPED (via patient branch; immutable)
--   imaging_records          : BRANCH-SCOPED + doctor-owned
--   prescriptions            : BRANCH-SCOPED + doctor-owned
--   adverse_events           : DOCTOR-SCOPED (via patient branch; immutable)
--   referrals                : BRANCH-SCOPED + doctor-owned
--   clinical_timeline_events : via parent patient branch (append-only feed)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
CREATE TYPE "public"."consent_method" AS ENUM('verbal', 'written', 'electronic');
--> statement-breakpoint
CREATE TYPE "public"."imaging_kind" AS ENUM('xray', 'cbct', 'opg', 'photo', 'before_after', 'consent', 'document');
--> statement-breakpoint
CREATE TYPE "public"."adverse_severity" AS ENUM('mild', 'moderate', 'severe');
--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'sent', 'acknowledged', 'completed');
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. CONSENT_TEMPLATES — org-wide, versioned (never edited in place).
-- ----------------------------------------------------------------------------
CREATE TABLE "consent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
	/* NO updated_at — a new version is a new row (append-only discipline) */
);
--> statement-breakpoint
CREATE UNIQUE INDEX "consent_templates_title_version_uq"
	ON "consent_templates" USING btree ("org_id", lower("title"), "version");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. CONSENT_RECORDS — immutable proof of consent (ADR-009).
-- ----------------------------------------------------------------------------
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"template_id" uuid NOT NULL REFERENCES "consent_templates"("id") ON DELETE restrict,
	"template_version" integer NOT NULL,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"plan_id" uuid REFERENCES "treatment_plans"("id") ON DELETE restrict,
	"method" "consent_method" NOT NULL,
	"consented_by" varchar(256) NOT NULL,          /* patient or guardian name */
	"witnessed_by" uuid REFERENCES "staff"("id") ON DELETE restrict,
	"recorded_by" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE INDEX "consent_records_patient_idx"
	ON "consent_records" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "consent_records_plan_idx"
	ON "consent_records" USING btree ("plan_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. IMAGING_RECORDS — METADATA ONLY (Sprint 3 discovery decision).
--    file_ref is an opaque storage reference (future Documents/S3 domain owns
--    the bytes). NO storage engine, NO presigned URLs, NO file pipeline here.
--    Kind enum mirrors the locked frontend documents kinds.
-- ----------------------------------------------------------------------------
CREATE TABLE "imaging_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"uploaded_by" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"kind" "imaging_kind" NOT NULL,
	"title" varchar(256) NOT NULL,
	"file_ref" varchar(512),
	"taken_at" timestamp with time zone,
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "imaging_records_patient_idx"
	ON "imaging_records" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "imaging_records_branch_idx"
	ON "imaging_records" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "imaging_records_encounter_idx"
	ON "imaging_records" USING btree ("encounter_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 5. PRESCRIPTIONS — medication orders by the encounter's doctor.
-- ----------------------------------------------------------------------------
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"medication" varchar(256) NOT NULL,
	"dosage" varchar(128),
	"frequency" varchar(128),
	"duration_days" integer,
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "prescriptions_patient_idx"
	ON "prescriptions" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "prescriptions_branch_idx"
	ON "prescriptions" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "prescriptions_doctor_idx"
	ON "prescriptions" USING btree ("doctor_id");
--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_duration_positive"
	CHECK (duration_days IS NULL OR duration_days > 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 6. ADVERSE_EVENTS — immutable safety record (ADR-009 discipline).
-- ----------------------------------------------------------------------------
CREATE TABLE "adverse_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"reported_by" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"severity" "adverse_severity" NOT NULL,
	"description" text NOT NULL,
	"action_taken" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE INDEX "adverse_events_patient_idx"
	ON "adverse_events" USING btree ("patient_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 7. REFERRALS — outgoing specialist referrals.
-- ----------------------------------------------------------------------------
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"to_specialty" varchar(128) NOT NULL,
	"to_provider" varchar(256),
	"reason" text NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "referrals_patient_idx"
	ON "referrals" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "referrals_branch_idx"
	ON "referrals" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "referrals_doctor_idx"
	ON "referrals" USING btree ("doctor_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 8. CLINICAL_TIMELINE_EVENTS — append-only derived feed (patient 360).
--    NOT a source of truth — mirrors patient_timeline_events discipline.
-- ----------------------------------------------------------------------------
CREATE TABLE "clinical_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE cascade,
	"type" varchar(64) NOT NULL,                   /* encounter_created|note_signed|plan_status_changed|... */
	"summary" varchar(512) NOT NULL,
	"payload" jsonb,                               /* structured context (no PHI dumps / no secrets) */
	"actor_id" uuid,
	"actor_role" varchar(32),
	"correlation_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "clinical_timeline_patient_idx"
	ON "clinical_timeline_events" USING btree ("patient_id","created_at");
--> statement-breakpoint
CREATE INDEX "clinical_timeline_type_idx"
	ON "clinical_timeline_events" USING btree ("type");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 9. RUNTIME ROLE GRANTS
--    Immutable (consent_records, adverse_events, clinical_timeline_events):
--    SELECT/INSERT ONLY. consent_templates: SELECT/INSERT (new version = new
--    row; is_active flip is an HQ UPDATE → grant UPDATE on templates only).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON consent_templates TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON consent_records TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON imaging_records TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON prescriptions TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON adverse_events TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON referrals TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON clinical_timeline_events TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 10. RLS — same discipline as 0007.
-- ----------------------------------------------------------------------------
ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consent_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY consent_templates_scope ON consent_templates
  USING (
    app_role() IN ('hq', 'branch_manager', 'doctor')
  )
  WITH CHECK (
    app_role() = 'hq'
  );
--> statement-breakpoint

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY consent_records_scope ON consent_records
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
    OR (app_role() = 'doctor' AND recorded_by::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND recorded_by::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE imaging_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE imaging_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY imaging_records_scope ON imaging_records
  USING (
    (app_role() IN ('hq', 'branch_manager')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
    OR (app_role() = 'doctor' AND uploaded_by::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND uploaded_by::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY prescriptions_scope ON prescriptions
  USING (
    (app_role() IN ('hq', 'branch_manager')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE adverse_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE adverse_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY adverse_events_scope ON adverse_events
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[]))))
    OR (app_role() = 'doctor' AND reported_by::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND reported_by::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY referrals_scope ON referrals
  USING (
    (app_role() IN ('hq', 'branch_manager')
      AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
    OR (app_role() = 'doctor' AND doctor_id::text = app_doctor_id())
  )
  WITH CHECK (
    app_role() = 'doctor' AND doctor_id::text = app_doctor_id()
  );
--> statement-breakpoint

ALTER TABLE clinical_timeline_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinical_timeline_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clinical_timeline_events_scope ON clinical_timeline_events
  USING (
    app_role() = 'hq'
    OR patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR patient_id IN (
      SELECT p.id FROM patients p
      WHERE p.branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
