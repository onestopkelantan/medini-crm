-- ============================================================================
-- SPRINT 4 (S4-T1) — FINANCE DATA & SECURITY FOUNDATION
--
-- Scope: operational financial records (NOT POS, NOT accounting, NOT invoice
-- issuer). Medini CRM = operational CRM + management intelligence + financial
-- recording/monitoring layer. POS transacts. Bukku accounts. CRM operates.
--
-- Business model LOCKED:
--   - NO invoice issuing engine (POS/Bukku own)
--   - NO invoice numbering engine (POS/Bukku own)
--   - NO receipt engine (POS own)
--   - NO payment gateway (external)
--   - NO full accounting ledger (Bukku own)
--   - NO Bukku real API adapter (Sprint 8)
--
-- This migration establishes the MINIMUM production-grade data foundation:
--   - sale_records: revenue analytics (POS reference)
--   - expenses: operational expense records
--   - recurring_commitments: recurring items + alerts
--   - treatment_costs: treatment cost (link Clinical via read-port)
--   - lab_payables: lab cost lifecycle (DRAFT→OUTSTANDING→PARTIALLY_PAID→PAID|VOID)
--   - commission_ledger: doctor commission calculation (LOCKED formula)
--   - commission_payouts: payout status tracking
--   - finance_alerts: radar alerts (derived)
--   - external_invoice_refs: POS/Bukku invoice reference
--   - bukku_sync_records: sync queue + metadata (architecture only)
--   - reconciliation_records: conflict detection + audit
--   - payment_status: EXTEND existing (add confirmed_by, confirmed_at, external_ref)
--
-- Money convention: numeric(19,4) — 19 digits total, 4 decimal places.
-- Application-level rounding to 2 decimals for display. NO float.
--
-- Allocators: sal/exp/rec/cst/lab/com/ext (NOT inv/pay — POS/Bukku own).
--
-- RLS: ENABLE+FORCE+WITH CHECK. hq=all, branch_manager=branch, others=none.
-- Audit: created_at/created_by/updated_at/updated_by on all tables.
-- Idempotency: unique external refs, no duplicate submission.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
CREATE TYPE "public"."sale_record_status" AS ENUM('recorded', 'confirmed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('draft', 'pending_approval', 'approved', 'paid', 'rejected', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."lab_payable_status" AS ENUM('DRAFT', 'OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'VOID');
--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('calculated', 'pending_review', 'approved', 'scheduled', 'paid', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."finance_alert_severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');
--> statement-breakpoint
CREATE TYPE "public"."finance_alert_status" AS ENUM('open', 'acknowledged', 'resolved', 'dismissed');
--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'queued', 'syncing', 'synced', 'error', 'conflict');
--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('pending', 'matched', 'conflict', 'resolved');
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. SALE_RECORDS — revenue analytics (POS reference, CRM=record).
--    NOT a POS transaction engine. External ref to POS sale.
-- ----------------------------------------------------------------------------
CREATE TABLE "sale_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid REFERENCES "patients"("id") ON DELETE restrict,
	"sale_code" varchar(32) NOT NULL,               /* SAL-#### (allocator) */
	"external_ref" varchar(128),                    /* POS sale reference */
	"source_system" varchar(32) NOT NULL DEFAULT 'pos', /* pos|manual|import */
	"amount" numeric(19,4) NOT NULL,
	"sale_date" date NOT NULL,
	"status" "sale_record_status" NOT NULL DEFAULT 'recorded',
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_records_org_code_uq" ON "sale_records" ("org_id", "sale_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_records_org_external_ref_uq" ON "sale_records" ("org_id", "external_ref") WHERE "external_ref" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "sale_records_branch_idx" ON "sale_records" ("branch_id");
--> statement-breakpoint
CREATE INDEX "sale_records_patient_idx" ON "sale_records" ("patient_id");
--> statement-breakpoint
CREATE INDEX "sale_records_date_idx" ON "sale_records" ("sale_date");
--> statement-breakpoint
CREATE INDEX "sale_records_status_idx" ON "sale_records" ("status");
--> statement-breakpoint
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_amount_positive" CHECK ("amount" >= 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. EXPENSES — operational expense records (CRM-owned).
--    NOT a full accounting payable ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"expense_code" varchar(32) NOT NULL,            /* EXP-#### (allocator) */
	"category" varchar(64) NOT NULL,                /* Utilities|Payroll|Doctor Commission|Insurance|Taxes & Government|Premises|Maintenance|Supplies|Professional Services|Lab Fees|Operations */
	"subcategory" varchar(128),
	"payee" varchar(256) NOT NULL,
	"amount" numeric(19,4) NOT NULL,
	"expense_date" date NOT NULL,
	"due_date" date,
	"status" "expense_status" NOT NULL DEFAULT 'draft',
	"recurring_id" uuid,                            /* link to recurring_commitments (optional) */
	"external_ref" varchar(128),                    /* external payment reference */
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_code_uq" ON "expenses" ("org_id", "expense_code");
--> statement-breakpoint
CREATE INDEX "expenses_branch_idx" ON "expenses" ("branch_id");
--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" ("category");
--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" ("status");
--> statement-breakpoint
CREATE INDEX "expenses_due_date_idx" ON "expenses" ("due_date");
--> statement-breakpoint
CREATE INDEX "expenses_recurring_idx" ON "expenses" ("recurring_id");
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" >= 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. RECURRING_COMMITMENTS — recurring items (CRM-owned operational records).
--    NOT a payment execution engine.
-- ----------------------------------------------------------------------------
CREATE TABLE "recurring_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"recurring_code" varchar(32) NOT NULL,          /* RC-#### (allocator) */
	"name" varchar(256) NOT NULL,
	"category" varchar(64) NOT NULL,                /* Utilities|Rent|Insurance|Software|Maintenance|Subscription|Tax|Lab Fees|Other */
	"amount" numeric(19,4) NOT NULL,
	"frequency" varchar(32) NOT NULL,               /* Monthly|Yearly|Weekly|Custom */
	"next_due_date" date NOT NULL,
	"status" "recurring_status" NOT NULL DEFAULT 'active',
	"auto_create" boolean DEFAULT false NOT NULL,   /* auto-create expense on due date */
	"external_ref" varchar(128),
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_commitments_org_code_uq" ON "recurring_commitments" ("org_id", "recurring_code");
--> statement-breakpoint
CREATE INDEX "recurring_commitments_branch_idx" ON "recurring_commitments" ("branch_id");
--> statement-breakpoint
CREATE INDEX "recurring_commitments_category_idx" ON "recurring_commitments" ("category");
--> statement-breakpoint
CREATE INDEX "recurring_commitments_next_due_idx" ON "recurring_commitments" ("next_due_date");
--> statement-breakpoint
CREATE INDEX "recurring_commitments_status_idx" ON "recurring_commitments" ("status");
--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_amount_positive" CHECK ("amount" >= 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 5. TREATMENT_COSTS — treatment cost (Finance owns, link Clinical via read-port).
--    Clinical owns Treatment Case. Finance owns financial cost record.
-- ----------------------------------------------------------------------------
CREATE TABLE "treatment_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE restrict,
	"plan_id" uuid NOT NULL REFERENCES "treatment_plans"("id") ON DELETE restrict,
	"encounter_id" uuid REFERENCES "encounters"("id") ON DELETE restrict,
	"cost_code" varchar(32) NOT NULL,               /* CST-#### (allocator) */
	"treatment_id" uuid REFERENCES "treatment_catalog"("id") ON DELETE restrict,
	"description" varchar(256) NOT NULL,
	"quantity" integer NOT NULL DEFAULT 1,
	"unit_cost" numeric(19,4) NOT NULL,
	"total_cost" numeric(19,4) NOT NULL,
	"cost_date" date NOT NULL,
	"external_ref" varchar(128),
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_costs_org_code_uq" ON "treatment_costs" ("org_id", "cost_code");
--> statement-breakpoint
CREATE INDEX "treatment_costs_branch_idx" ON "treatment_costs" ("branch_id");
--> statement-breakpoint
CREATE INDEX "treatment_costs_patient_idx" ON "treatment_costs" ("patient_id");
--> statement-breakpoint
CREATE INDEX "treatment_costs_plan_idx" ON "treatment_costs" ("plan_id");
--> statement-breakpoint
CREATE INDEX "treatment_costs_encounter_idx" ON "treatment_costs" ("encounter_id");
--> statement-breakpoint
CREATE INDEX "treatment_costs_treatment_idx" ON "treatment_costs" ("treatment_id");
--> statement-breakpoint
CREATE INDEX "treatment_costs_date_idx" ON "treatment_costs" ("cost_date");
--> statement-breakpoint
ALTER TABLE "treatment_costs" ADD CONSTRAINT "treatment_costs_quantity_positive" CHECK ("quantity" > 0);
--> statement-breakpoint
ALTER TABLE "treatment_costs" ADD CONSTRAINT "treatment_costs_unit_cost_positive" CHECK ("unit_cost" >= 0);
--> statement-breakpoint
ALTER TABLE "treatment_costs" ADD CONSTRAINT "treatment_costs_total_cost_positive" CHECK ("total_cost" >= 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 6. LAB_PAYABLES — lab cost lifecycle (operational tracking, NOT accounting ledger).
--    Lifecycle: DRAFT→OUTSTANDING→PARTIALLY_PAID→PAID|VOID. Overpayment blocked.
-- ----------------------------------------------------------------------------
CREATE TABLE "lab_payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"treatment_cost_id" uuid REFERENCES "treatment_costs"("id") ON DELETE restrict,
	"lab_code" varchar(32) NOT NULL,                /* LAB-#### (allocator) */
	"lab_name" varchar(256) NOT NULL,               /* lab/provider name */
	"case_ref" varchar(128),                        /* case reference */
	"external_invoice_ref" varchar(128),            /* external lab invoice reference */
	"amount" numeric(19,4) NOT NULL,
	"paid_amount" numeric(19,4) NOT NULL DEFAULT 0,
	"outstanding_amount" numeric(19,4) NOT NULL,
	"due_date" date NOT NULL,
	"status" "lab_payable_status" NOT NULL DEFAULT 'DRAFT',
	"external_ref" varchar(128),
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lab_payables_org_code_uq" ON "lab_payables" ("org_id", "lab_code");
--> statement-breakpoint
CREATE INDEX "lab_payables_branch_idx" ON "lab_payables" ("branch_id");
--> statement-breakpoint
CREATE INDEX "lab_payables_treatment_cost_idx" ON "lab_payables" ("treatment_cost_id");
--> statement-breakpoint
CREATE INDEX "lab_payables_status_idx" ON "lab_payables" ("status");
--> statement-breakpoint
CREATE INDEX "lab_payables_due_date_idx" ON "lab_payables" ("due_date");
--> statement-breakpoint
ALTER TABLE "lab_payables" ADD CONSTRAINT "lab_payables_amount_positive" CHECK ("amount" >= 0);
--> statement-breakpoint
ALTER TABLE "lab_payables" ADD CONSTRAINT "lab_payables_paid_amount_positive" CHECK ("paid_amount" >= 0);
--> statement-breakpoint
ALTER TABLE "lab_payables" ADD CONSTRAINT "lab_payables_outstanding_amount_positive" CHECK ("outstanding_amount" >= 0);
--> statement-breakpoint
ALTER TABLE "lab_payables" ADD CONSTRAINT "lab_payables_no_overpayment" CHECK ("paid_amount" <= "amount");
--> statement-breakpoint
ALTER TABLE "lab_payables" ADD CONSTRAINT "lab_payables_outstanding_calc" CHECK ("outstanding_amount" = "amount" - "paid_amount");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 7. COMMISSION_LEDGER — doctor commission calculation (CRM source of truth).
--    LOCKED formula: Base = Gross Revenue − Eligible Direct Costs;
--    Commission = Base × Rate. Default: rate 40%, basis Treatment Revenue,
--    payout Twice Monthly (15th & 30th). Doctor beneficiary ONLY (no branch).
--    Eligible direct costs: Lab Cost, X-Ray, Add-on (NOT general expenses).
-- ----------------------------------------------------------------------------
CREATE TABLE "commission_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"doctor_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE restrict,
	"commission_code" varchar(32) NOT NULL,         /* COM-#### (allocator) */
	"period" varchar(32) NOT NULL,                  /* e.g. 'Aug 2026', '2026-08-15' */
	"gross_revenue" numeric(19,4) NOT NULL,
	"eligible_direct_costs" numeric(19,4) NOT NULL DEFAULT 0, /* Lab Cost + X-Ray + Add-on */
	"commission_base" numeric(19,4) NOT NULL,       /* gross_revenue - eligible_direct_costs */
	"rate" numeric(5,4) NOT NULL,                   /* e.g. 0.4000 = 40% */
	"commission_amount" numeric(19,4) NOT NULL,     /* commission_base × rate */
	"adjustment" numeric(19,4) NOT NULL DEFAULT 0,
	"net_payable" numeric(19,4) NOT NULL,           /* commission_amount - adjustment */
	"paid_amount" numeric(19,4) NOT NULL DEFAULT 0,
	"outstanding_amount" numeric(19,4) NOT NULL,
	"status" "commission_status" NOT NULL DEFAULT 'calculated',
	"external_ref" varchar(128),
	"notes" varchar(512),
	"version" integer NOT NULL DEFAULT 1,           /* optimistic locking */
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_ledger_org_code_uq" ON "commission_ledger" ("org_id", "commission_code");
--> statement-breakpoint
CREATE INDEX "commission_ledger_branch_idx" ON "commission_ledger" ("branch_id");
--> statement-breakpoint
CREATE INDEX "commission_ledger_doctor_idx" ON "commission_ledger" ("doctor_id");
--> statement-breakpoint
CREATE INDEX "commission_ledger_period_idx" ON "commission_ledger" ("period");
--> statement-breakpoint
CREATE INDEX "commission_ledger_status_idx" ON "commission_ledger" ("status");
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_gross_revenue_positive" CHECK ("gross_revenue" >= 0);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_eligible_costs_positive" CHECK ("eligible_direct_costs" >= 0);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_base_calc" CHECK ("commission_base" = "gross_revenue" - "eligible_direct_costs");
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_rate_range" CHECK ("rate" >= 0 AND "rate" <= 1);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_amount_calc" CHECK ("commission_amount" = "commission_base" * "rate");
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_net_payable_calc" CHECK ("net_payable" = "commission_amount" - "adjustment");
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_outstanding_calc" CHECK ("outstanding_amount" = "net_payable" - "paid_amount");
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_no_overpayment" CHECK ("paid_amount" <= "net_payable");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 8. COMMISSION_PAYOUTS — payout status tracking.
-- ----------------------------------------------------------------------------
CREATE TABLE "commission_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"commission_ledger_id" uuid NOT NULL REFERENCES "commission_ledger"("id") ON DELETE restrict,
	"payout_date" date NOT NULL,
	"amount" numeric(19,4) NOT NULL,
	"method" varchar(32),                           /* Cash|Card|FPX|Bank Transfer|E-Wallet */
	"external_ref" varchar(128),                    /* external payment reference */
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "commission_payouts_branch_idx" ON "commission_payouts" ("branch_id");
--> statement-breakpoint
CREATE INDEX "commission_payouts_ledger_idx" ON "commission_payouts" ("commission_ledger_id");
--> statement-breakpoint
CREATE INDEX "commission_payouts_date_idx" ON "commission_payouts" ("payout_date");
--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_amount_positive" CHECK ("amount" > 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 9. FINANCE_ALERTS — radar alerts (derived, management alert layer).
--    NOT another accounting engine. Rules → alert → notification.
-- ----------------------------------------------------------------------------
CREATE TABLE "finance_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"alert_type" varchar(64) NOT NULL,              /* payment_attention|overdue_record|expense_due|lab_payable_overdue|commission_attention|sync_failure|reconciliation_conflict */
	"severity" "finance_alert_severity" NOT NULL,
	"status" "finance_alert_status" NOT NULL DEFAULT 'open',
	"entity_type" varchar(64),                      /* sale_record|expense|recurring|treatment_cost|lab_payable|commission_ledger|bukku_sync|reconciliation */
	"entity_id" uuid,                               /* reference to entity */
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"amount" numeric(19,4),
	"due_date" date,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "finance_alerts_branch_idx" ON "finance_alerts" ("branch_id");
--> statement-breakpoint
CREATE INDEX "finance_alerts_type_idx" ON "finance_alerts" ("alert_type");
--> statement-breakpoint
CREATE INDEX "finance_alerts_severity_idx" ON "finance_alerts" ("severity");
--> statement-breakpoint
CREATE INDEX "finance_alerts_status_idx" ON "finance_alerts" ("status");
--> statement-breakpoint
CREATE INDEX "finance_alerts_entity_idx" ON "finance_alerts" ("entity_type", "entity_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 10. EXTERNAL_INVOICE_REFS — POS/Bukku invoice reference (NOT invoice engine).
--     CRM stores reference only. Invoice itself belongs to POS/Bukku/external.
-- ----------------------------------------------------------------------------
CREATE TABLE "external_invoice_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE restrict,
	"patient_id" uuid REFERENCES "patients"("id") ON DELETE restrict,
	"treatment_cost_id" uuid REFERENCES "treatment_costs"("id") ON DELETE restrict,
	"ref_code" varchar(32) NOT NULL,                /* EXT-#### (allocator) */
	"external_invoice_number" varchar(128) NOT NULL, /* POS/Bukku invoice number */
	"source_system" varchar(32) NOT NULL,           /* pos|bukku|external */
	"amount" numeric(19,4) NOT NULL,
	"invoice_date" date NOT NULL,
	"status" varchar(32),                           /* external status (read-only) */
	"external_ref" varchar(128),                    /* external system reference */
	"sync_metadata" jsonb,                          /* sync state, version, last_synced */
	"notes" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "external_invoice_refs_org_code_uq" ON "external_invoice_refs" ("org_id", "ref_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "external_invoice_refs_org_external_uq" ON "external_invoice_refs" ("org_id", "source_system", "external_invoice_number");
--> statement-breakpoint
CREATE INDEX "external_invoice_refs_branch_idx" ON "external_invoice_refs" ("branch_id");
--> statement-breakpoint
CREATE INDEX "external_invoice_refs_patient_idx" ON "external_invoice_refs" ("patient_id");
--> statement-breakpoint
CREATE INDEX "external_invoice_refs_treatment_cost_idx" ON "external_invoice_refs" ("treatment_cost_id");
--> statement-breakpoint
CREATE INDEX "external_invoice_refs_external_number_idx" ON "external_invoice_refs" ("external_invoice_number");
--> statement-breakpoint
ALTER TABLE "external_invoice_refs" ADD CONSTRAINT "external_invoice_refs_amount_positive" CHECK ("amount" >= 0);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 11. BUKKU_SYNC_RECORDS — sync queue + metadata (architecture ONLY, NO real API).
--     Sprint 4 = contract/boundary. Real adapter = Sprint 8.
-- ----------------------------------------------------------------------------
CREATE TABLE "bukku_sync_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" varchar(64) NOT NULL,             /* sale_record|expense|lab_payable|commission_payout|external_invoice_ref */
	"entity_id" uuid NOT NULL,                      /* reference to entity */
	"sync_status" "sync_status" NOT NULL DEFAULT 'pending',
	"bukku_id" varchar(128),                        /* Bukku external ID */
	"idempotency_key" varchar(256) NOT NULL,        /* source:entity:op:version */
	"version" integer NOT NULL DEFAULT 1,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,                              /* error message if sync failed */
	"retry_count" integer NOT NULL DEFAULT 0,
	"sync_metadata" jsonb,                          /* additional sync state */
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bukku_sync_records_org_entity_uq" ON "bukku_sync_records" ("org_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bukku_sync_records_idempotency_uq" ON "bukku_sync_records" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "bukku_sync_records_status_idx" ON "bukku_sync_records" ("sync_status");
--> statement-breakpoint
CREATE INDEX "bukku_sync_records_entity_idx" ON "bukku_sync_records" ("entity_type", "entity_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 12. RECONCILIATION_RECORDS — conflict detection + audit (explicit, auditable).
--     NO silent overwrite. Conflict must be explicit.
-- ----------------------------------------------------------------------------
CREATE TABLE "reconciliation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid NOT NULL,
	"bukku_sync_record_id" uuid REFERENCES "bukku_sync_records"("id") ON DELETE restrict,
	"reconciliation_status" "reconciliation_status" NOT NULL DEFAULT 'pending',
	"crm_value" jsonb,                              /* CRM record value */
	"bukku_value" jsonb,                            /* Bukku record value */
	"conflict_fields" text[],                       /* fields with conflict */
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX "reconciliation_records_entity_idx" ON "reconciliation_records" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX "reconciliation_records_status_idx" ON "reconciliation_records" ("reconciliation_status");
--> statement-breakpoint
CREATE INDEX "reconciliation_records_sync_idx" ON "reconciliation_records" ("bukku_sync_record_id");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 13. PAYMENT_STATUS — EXTEND existing table (add confirmed_by, confirmed_at, external_ref).
--     DO NOT create duplicate. CRM = status layer only (PENDING/PAID/OVERDUE).
-- ----------------------------------------------------------------------------
ALTER TABLE "payment_status" ADD COLUMN IF NOT EXISTS "confirmed_by" uuid;
--> statement-breakpoint
ALTER TABLE "payment_status" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment_status" ADD COLUMN IF NOT EXISTS "external_ref" varchar(128);
--> statement-breakpoint
ALTER TABLE "payment_status" ADD COLUMN IF NOT EXISTS "source_system" varchar(32) DEFAULT 'external';
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 14. ALLOCATOR SEQUENCES — pre-create for canonical org (00000001).
--     Pattern: medini_<prefix>_<org-key>. NOT inv/pay (POS/Bukku own).
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS medini_sal_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_exp_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_rec_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_cst_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_lab_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_com_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS medini_ext_00000001 INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 15. RUNTIME ROLE GRANTS (medini_app — non-owner, RLS-subject).
--     SELECT/INSERT/UPDATE — NO DELETE (soft-delete via deleted_at).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON sale_records TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON expenses TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON recurring_commitments TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON treatment_costs TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON lab_payables TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON commission_ledger TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON commission_payouts TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON finance_alerts TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON external_invoice_refs TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON bukku_sync_records TO medini_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON reconciliation_records TO medini_app;
--> statement-breakpoint

-- Grant sequence usage to runtime role.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medini_app;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 16. RLS POLICIES — ENABLE+FORCE+WITH CHECK.
--     hq = all (org-wide), branch_manager = branch, others = none.
--     Finance domain: hq view/create/edit/submit/approve (all), bm view/submit (branch).
-- ----------------------------------------------------------------------------
ALTER TABLE sale_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sale_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sale_records_scope ON sale_records
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY expenses_scope ON expenses
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE recurring_commitments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recurring_commitments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_commitments_scope ON recurring_commitments
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE treatment_costs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE treatment_costs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treatment_costs_scope ON treatment_costs
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE lab_payables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lab_payables FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lab_payables_scope ON lab_payables
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_ledger_scope ON commission_ledger
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_payouts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_payouts_scope ON commission_payouts
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE finance_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_alerts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY finance_alerts_scope ON finance_alerts
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE external_invoice_refs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE external_invoice_refs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY external_invoice_refs_scope ON external_invoice_refs
  USING (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  )
  WITH CHECK (
    app_role() = 'hq'
    OR (app_role() = 'branch_manager' AND branch_id::text = ANY (COALESCE(app_branch_ids(), ARRAY[]::text[])))
  );
--> statement-breakpoint

ALTER TABLE bukku_sync_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bukku_sync_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bukku_sync_records_scope ON bukku_sync_records
  USING (
    app_role() = 'hq'
  )
  WITH CHECK (
    app_role() = 'hq'
  );
--> statement-breakpoint

ALTER TABLE reconciliation_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reconciliation_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reconciliation_records_scope ON reconciliation_records
  USING (
    app_role() = 'hq'
  )
  WITH CHECK (
    app_role() = 'hq'
  );
--> statement-breakpoint
