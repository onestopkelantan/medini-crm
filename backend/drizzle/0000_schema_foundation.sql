CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'checked-in', 'waiting', 'called', 'in-progress', 'completed', 'cancelled', 'no-show');--> statement-breakpoint
CREATE TYPE "public"."audit_source" AS ENUM('api', 'worker', 'integration', 'system');--> statement-breakpoint
CREATE TYPE "public"."branch_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."branch_type" AS ENUM('main', 'affiliate');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('Active', 'VIP', 'Recall Due', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."payment_status_type" AS ENUM('PENDING', 'PAID', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."role_assignment_status" AS ENUM('ACTIVE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('hq', 'branch_manager', 'branch_admin', 'doctor');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('Active', 'Suspended', 'Deactivated');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"patient_id" uuid,
	"patient_name" varchar(256) NOT NULL,
	"doctor_id" uuid,
	"treatment_ref" varchar(256),
	"scheduled_date" date NOT NULL,
	"scheduled_time" time NOT NULL,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "appt_duration_positive" CHECK (duration_min > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"actor_id" uuid,
	"actor_role" varchar(32) NOT NULL,
	"action" varchar(128) NOT NULL,
	"entity" varchar(128) NOT NULL,
	"entity_id" varchar(128),
	"before" jsonb,
	"after" jsonb,
	"source" "audit_source" DEFAULT 'api' NOT NULL,
	"correlation_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"short_name" varchar(128) NOT NULL,
	"full_name" varchar(256) NOT NULL,
	"location" varchar(256),
	"type" "branch_type" DEFAULT 'main' NOT NULL,
	"status" "branch_status" DEFAULT 'active' NOT NULL,
	"whatsapp_session" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"event_type" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" varchar(128),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(256) NOT NULL,
	"scope" varchar(256) NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"related_patient_id" uuid,
	"related_name" varchar(256),
	"type" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"mrn" varchar(32) NOT NULL,
	"name" varchar(256) NOT NULL,
	"ic" varchar(64),
	"dob" date,
	"gender" varchar(8),
	"nationality" varchar(128),
	"phone" varchar(64),
	"whatsapp" varchar(64),
	"email" varchar(256),
	"patient_type" varchar(32) DEFAULT 'adult',
	"contact_type" varchar(32) DEFAULT 'own',
	"guardian_id" uuid,
	"registration_reason" varchar(128),
	"preferred_contact" varchar(32),
	"last_visit_at" timestamp with time zone,
	"status" "patient_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "payment_status_type" DEFAULT 'PENDING' NOT NULL,
	"paid_date" date,
	"updated_by_role" varchar(32),
	"payment_reference" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer" varchar(128) NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"branch_id" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "role_assignment_status" DEFAULT 'ACTIVE' NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" varchar(256) NOT NULL,
	"username" varchar(128) NOT NULL,
	"email" varchar(256),
	"phone" varchar(64),
	"role" "role" NOT NULL,
	"status" "staff_status" DEFAULT 'Active' NOT NULL,
	"specialization" varchar(256),
	"password_hash" text,
	"doctor_ref" varchar(64),
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_non_hq_requires_branch" CHECK ("role" = 'hq' OR branch_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_staff_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_relationships" ADD CONSTRAINT "patient_relationships_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_relationships" ADD CONSTRAINT "patient_relationships_related_patient_id_patients_id_fk" FOREIGN KEY ("related_patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_status" ADD CONSTRAINT "payment_status_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_status" ADD CONSTRAINT "payment_status_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appt_org_code_uq" ON "appointments" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "appt_branch_date_idx" ON "appointments" USING btree ("branch_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "appt_doctor_date_idx" ON "appointments" USING btree ("doctor_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "appt_patient_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_branch_idx" ON "audit_log" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_before_gin" ON "audit_log" USING gin ("before");--> statement-breakpoint
CREATE INDEX "audit_after_gin" ON "audit_log" USING gin ("after");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_org_code_uq" ON "branches" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "branches_org_idx" ON "branches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "domain_events_unpublished_idx" ON "domain_events" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uq" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "patient_rel_patient_idx" ON "patient_relationships" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_mrn_uq" ON "patients" USING btree ("org_id","mrn");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_ic_uq" ON "patients" USING btree ("org_id","ic");--> statement-breakpoint
CREATE INDEX "patients_branch_idx" ON "patients" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "patients" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_status_patient_uq" ON "payment_status" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "payment_status_branch_idx" ON "payment_status" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "payment_status_status_idx" ON "payment_status" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_events_consumer_event_uq" ON "processed_events" USING btree ("consumer","event_id");--> statement-breakpoint
CREATE INDEX "role_assign_staff_idx" ON "role_assignments" USING btree ("staff_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_org_username_uq" ON "staff" USING btree ("org_id","username");--> statement-breakpoint
CREATE INDEX "staff_branch_idx" ON "staff" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "staff_role_idx" ON "staff" USING btree ("role");