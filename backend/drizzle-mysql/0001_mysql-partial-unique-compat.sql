/*
 * MySQL compatibility for PostgreSQL partial / functional UNIQUE indexes.
 * MySQL has no PostgreSQL-style partial indexes (WHERE ...).
 *
 * Strategy:
 * - generated nullable guard columns
 * - UNIQUE indexes include the guard
 * - guard = 1 only when the row participates in uniqueness
 * - guard = NULL otherwise; MySQL permits multiple NULL values in UNIQUE indexes
 *
 * utf8mb4_0900_ai_ci already provides case-insensitive comparison for
 * name/title/key columns that previously used lower(...).
 */

-- ---------------------------------------------------------------------------
-- 1. role_assignments
-- PostgreSQL:
-- UNIQUE(staff_id) WHERE status = 'ACTIVE'
-- ---------------------------------------------------------------------------

ALTER TABLE `role_assignments`
  ADD COLUMN `uq_active_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `status` = 'ACTIVE' THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `role_assignments_one_active_uq`
  ON `role_assignments` (`staff_id`, `uq_active_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. panel_companies
-- PostgreSQL:
-- UNIQUE(org_id, lower(name)) WHERE deleted_at IS NULL
-- MySQL collation is already case-insensitive.
-- ---------------------------------------------------------------------------

ALTER TABLE `panel_companies`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `panel_companies_org_name_uq`
  ON `panel_companies` (`org_id`, `name`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. insurance_companies
-- ---------------------------------------------------------------------------

ALTER TABLE `insurance_companies`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `insurance_companies_org_name_uq`
  ON `insurance_companies` (`org_id`, `name`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. treatment_catalog
-- ---------------------------------------------------------------------------

ALTER TABLE `treatment_catalog`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `treatment_catalog_org_name_uq`
  ON `treatment_catalog` (`org_id`, `name`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. consent_templates
-- PostgreSQL used lower(title).
-- Existing MySQL unique index:
-- (org_id, title, version)
-- is already equivalent because title uses utf8mb4_0900_ai_ci.
-- No extra index required.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 6. sale_records
-- PostgreSQL:
-- UNIQUE(org_id, external_ref) WHERE external_ref IS NOT NULL
--
-- MySQL UNIQUE naturally permits multiple NULL values.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX `sale_records_org_external_ref_uq`
  ON `sale_records` (`org_id`, `external_ref`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 7. commission_ledger
-- PostgreSQL:
-- UNIQUE(org_id, doctor_id, period) WHERE deleted_at IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `commission_ledger`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `commission_ledger_org_doctor_period_uq`
  ON `commission_ledger`
  (`org_id`, `doctor_id`, `period`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 8. recall_cases with recall_rule_id
-- PostgreSQL:
-- UNIQUE(org_id, patient_id, recall_rule_id, due_date)
-- WHERE deleted_at IS NULL AND recall_rule_id IS NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `recall_cases`
  ADD COLUMN `uq_live_rule_guard` tinyint
  GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NULL AND `recall_rule_id` IS NOT NULL
      THEN 1
      ELSE NULL
    END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `recall_cases_rule_identity_uq`
  ON `recall_cases`
  (`org_id`, `patient_id`, `recall_rule_id`, `due_date`, `uq_live_rule_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 9. recall_cases without recall_rule_id
-- PostgreSQL:
-- UNIQUE(org_id, patient_id, due_date)
-- WHERE deleted_at IS NULL AND recall_rule_id IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `recall_cases`
  ADD COLUMN `uq_live_no_rule_guard` tinyint
  GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NULL AND `recall_rule_id` IS NULL
      THEN 1
      ELSE NULL
    END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `recall_cases_no_rule_identity_uq`
  ON `recall_cases`
  (`org_id`, `patient_id`, `due_date`, `uq_live_no_rule_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 10. lab_cases
--
-- PostgreSQL index was UNIQUE(org_id,id) with a partial WHERE.
-- id is already the PRIMARY KEY, so this index adds no additional
-- uniqueness protection in MySQL and does not require a replacement.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 11. wa_channels
-- PostgreSQL:
-- UNIQUE(org_id, branch_id) WHERE deleted_at IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `wa_channels`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `wa_channels_branch_active_uq`
  ON `wa_channels` (`org_id`, `branch_id`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 12. wa_conversations
-- PostgreSQL:
-- UNIQUE(org_id, channel_id, contact_phone)
-- WHERE status <> 'archived' AND deleted_at IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `wa_conversations`
  ADD COLUMN `uq_active_contact_guard` tinyint
  GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NULL AND `status` <> 'archived'
      THEN 1
      ELSE NULL
    END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `wa_conversations_active_contact_uq`
  ON `wa_conversations`
  (`org_id`, `channel_id`, `contact_phone`, `uq_active_contact_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 13. wa_messages idempotency_key
-- PostgreSQL:
-- UNIQUE(org_id, conversation_id, idempotency_key)
-- WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `wa_messages`
  ADD COLUMN `uq_live_idem_guard` tinyint
  GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NULL AND `idempotency_key` IS NOT NULL
      THEN 1
      ELSE NULL
    END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `wa_messages_conv_idem_uq`
  ON `wa_messages`
  (`org_id`, `conversation_id`, `idempotency_key`, `uq_live_idem_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 14. wa_messages external_message_id
-- ---------------------------------------------------------------------------

ALTER TABLE `wa_messages`
  ADD COLUMN `uq_live_external_guard` tinyint
  GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NULL AND `external_message_id` IS NOT NULL
      THEN 1
      ELSE NULL
    END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `wa_messages_channel_ext_uq`
  ON `wa_messages`
  (`org_id`, `channel_id`, `external_message_id`, `uq_live_external_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 15. wa_templates
-- PostgreSQL:
-- UNIQUE(org_id, branch_id, name) WHERE deleted_at IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `wa_templates`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `wa_templates_org_branch_name_uq`
  ON `wa_templates`
  (`org_id`, `branch_id`, `name`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 16. settings_values
-- PostgreSQL:
-- UNIQUE(org_id, key, scope, COALESCE(scope_ref, ''))
-- ---------------------------------------------------------------------------

ALTER TABLE `settings_values`
  ADD COLUMN `scope_ref_normalized` varchar(128)
  GENERATED ALWAYS AS (
    COALESCE(`scope_ref`, '')
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `settings_values_scope_uq`
  ON `settings_values`
  (`org_id`, `key`, `scope`, `scope_ref_normalized`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 17. ai_agents
-- PostgreSQL:
-- UNIQUE(org_id, key) WHERE deleted_at IS NULL
-- ---------------------------------------------------------------------------

ALTER TABLE `ai_agents`
  ADD COLUMN `uq_live_guard` tinyint
  GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `ai_agents_org_key_uq`
  ON `ai_agents` (`org_id`, `key`, `uq_live_guard`);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 18. appointments active branch slot
-- PostgreSQL:
-- UNIQUE(org_id, branch_id, scheduled_date, scheduled_time)
-- WHERE deleted_at IS NULL
--   AND status NOT IN ('cancelled', 'no-show')
-- ---------------------------------------------------------------------------

ALTER TABLE `appointments`
  ADD COLUMN `uq_active_slot_guard` tinyint
  GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NULL
       AND `status` NOT IN ('cancelled', 'no-show')
      THEN 1
      ELSE NULL
    END
  ) VIRTUAL;
--> statement-breakpoint

CREATE UNIQUE INDEX `appointments_active_branch_slot_unique`
  ON `appointments`
  (`org_id`, `branch_id`, `scheduled_date`, `scheduled_time`, `uq_active_slot_guard`);