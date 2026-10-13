-- ============================================================================
-- FASA 1 — WhatsApp AI Receptionist (backend foundation)
--
-- 1. whatsapp_bot_prompts → 3 named slots per branch, one active.
-- 2. wa_channels → AI auto-reply toggle owned by the operator.
-- 3. wa_conversations → needs_human escalation flag + reason.
-- 4. ai_whatsapp_settings → anti-ban + escalation config (org/branch scope).
--
-- Idempotent where practical (IF NOT EXISTS / information_schema guards).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prompt slots — extend the existing one-row-per-branch table.
--    Existing installs keep their prompt as slot 1; it becomes active.
-- ---------------------------------------------------------------------------
ALTER TABLE `whatsapp_bot_prompts`
  ADD COLUMN `slot` tinyint NOT NULL DEFAULT 1,
  ADD COLUMN `name` varchar(64) NOT NULL DEFAULT '',
  ADD COLUMN `is_active` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `deleted_at` datetime(6) NULL;

-- Existing rows are the operator's live prompt: name it and mark it active.
UPDATE `whatsapp_bot_prompts`
SET `name` = CASE WHEN `name` = '' THEN CONCAT('Prompt ', `slot`) ELSE `name` END,
    `is_active` = 1
WHERE `deleted_at` IS NULL;

-- At most one ACTIVE prompt per branch (enforced by the service on write; the
-- composite PK stays org_id+branch_id, so slots are distinguished by `slot`).
ALTER TABLE `whatsapp_bot_prompts`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`org_id`, `branch_id`, `slot`);

-- ---------------------------------------------------------------------------
-- 2. AI auto-reply toggle on the number (channel) record.
--    Default OFF: an operator turns AI on deliberately per number.
-- ---------------------------------------------------------------------------
ALTER TABLE `wa_channels`
  ADD COLUMN `ai_reply_enabled` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `ai_reply_enabled_at` datetime(6) NULL,
  ADD COLUMN `ai_reply_enabled_by` varchar(36) NULL;

-- ---------------------------------------------------------------------------
-- 3. Escalation flag on conversations — "perlu reply manual" queue.
-- ---------------------------------------------------------------------------
ALTER TABLE `wa_conversations`
  ADD COLUMN `needs_human` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `needs_human_reason` varchar(64) NULL,
  ADD COLUMN `needs_human_at` datetime(6) NULL;

CREATE INDEX `wa_conversations_needs_human_idx`
  ON `wa_conversations` (`org_id`, `branch_id`, `needs_human`, `last_message_at`);

-- ---------------------------------------------------------------------------
-- 4. Anti-ban + escalation settings — one row per org+branch.
--    Values mirror the D18 warm-up rules already enforced by the worker:
--    randomized send delay, daily cap, hourly cap, warm-up window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ai_whatsapp_settings` (
  `org_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  -- Anti-ban (send pacing)
  `antiban_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `min_delay_seconds` int NOT NULL DEFAULT 30,
  `max_delay_seconds` int NOT NULL DEFAULT 60,
  `daily_message_cap` int NOT NULL DEFAULT 50,
  `hourly_message_cap` int NOT NULL DEFAULT 10,
  `warmup_days` int NOT NULL DEFAULT 7,
  `warmup_daily_cap` int NOT NULL DEFAULT 20,
  -- Escalation (hand off to a human)
  `escalation_keywords` text NOT NULL,
  `max_ai_turns` int NOT NULL DEFAULT 3,
  `escalate_on_ai_uncertainty` tinyint(1) NOT NULL DEFAULT 1,
  `escalation_reply` text NOT NULL,
  -- Audit
  `updated_by` varchar(36) NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`org_id`, `branch_id`),
  CONSTRAINT `ai_wa_settings_delay_order` CHECK (`max_delay_seconds` >= `min_delay_seconds`),
  CONSTRAINT `ai_wa_settings_caps` CHECK (`daily_message_cap` > 0 AND `hourly_message_cap` > 0),
  CONSTRAINT `ai_wa_settings_turns` CHECK (`max_ai_turns` >= 1)
);

-- ---------------------------------------------------------------------------
-- 5. Message origin marker — so the conversation view can label AI vs staff
--    and the Playground can exclude simulated traffic.
-- ---------------------------------------------------------------------------
ALTER TABLE `wa_messages`
  ADD COLUMN `is_simulated` tinyint(1) NOT NULL DEFAULT 0;
