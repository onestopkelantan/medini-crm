-- FASA 5D-C + 5F — response-time limit, and campaign scheduling.
--
-- 5D-C: how long a patient may wait before the clinic sees a red mark.
-- 5F:   when a campaign runs, so "1400 numbers over 14 days" can be computed
--       and enforced rather than typed into a message and hoped for.
--
-- WRITTEN AGAINST WHAT EXISTS, NOT WHAT WAS ASSUMED
--
-- An earlier draft of this file added a wa_blast_queue table. There is no such
-- table, and there should not be: 5C-D put the schedule on wa_messages.send_at,
-- where the durable outbox already lives. Adding a second table would create a
-- second source of truth for whether a message was sent. Campaign scheduling
-- belongs on wa_blast_campaigns alongside the per_day that is already there.
--
-- IDEMPOTENT: every statement is guarded by an information_schema check.

SET @db := DATABASE();

/* ============================================================== 5D-C — SLA */

/* The limit is a SETTING, not a constant. A clinic with two receptionists and
 * one with eight have different reachable response times; a single number fixed
 * in code would either nag the small clinic or let the large one quietly become
 * slow. 15 minutes is the starting point, not the truth. */
SET @has_sla := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
    AND COLUMN_NAME = 'sla_minutes'
);
SET @sql := IF(@has_sla = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN sla_minutes INT NOT NULL DEFAULT 15',
  'SELECT ''sla_minutes already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ============================================================= 5F — campaign */

/* The window in which a campaign may send. A campaign is not allowed to run
 * outside these dates: 1400 numbers spread over 14 days means 100 a day, and
 * without an end date there is no way to tell "on track" from "behind". */
SET @has_start := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns'
    AND COLUMN_NAME = 'start_date'
);
SET @sql := IF(@has_start = 0,
  'ALTER TABLE wa_blast_campaigns
     ADD COLUMN start_date DATE NULL,
     ADD COLUMN end_date   DATE NULL',
  'SELECT ''campaign dates already exist'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* Paused, distinct from the batch status.
 *
 * A campaign that ran out of its daily allowance overnight is not "failed" and
 * not "complete" — it is waiting, and must resume by itself. Conflating the two
 * would need a human to restart it every morning, and on the morning nobody
 * does, the campaign silently stops. */
SET @has_paused := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns'
    AND COLUMN_NAME = 'paused_reason'
);
SET @sql := IF(@has_paused = 0,
  'ALTER TABLE wa_blast_campaigns
     ADD COLUMN paused_reason VARCHAR(64) NULL,
     ADD COLUMN paused_until  DATETIME NULL',
  'SELECT ''pause columns already exist'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* The operator's INTENDED pace, which may be slower than the branch ceiling.
 *
 * `per_day` stores the rate the plan works out to; this stores what was ASKED
 * for. Without it the intent was accepted by the endpoint and then dropped, so
 * changing only the dates silently reverted a deliberate slower pace — and a plan
 * that cannot be read back cannot be reviewed. */
SET @has_target := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns'
    AND COLUMN_NAME = 'daily_target'
);
SET @sql := IF(@has_target = 0,
  'ALTER TABLE wa_blast_campaigns ADD COLUMN daily_target INT NULL',
  'SELECT ''daily_target already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
     AND COLUMN_NAME = 'sla_minutes') AS sla_minutes_present,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns'
     AND COLUMN_NAME IN ('start_date', 'end_date', 'paused_reason', 'paused_until')) AS campaign_columns,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages'
     AND COLUMN_NAME = 'send_at') AS drip_column_present;
