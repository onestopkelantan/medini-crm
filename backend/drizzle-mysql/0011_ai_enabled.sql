-- FASA 5D-A — AI on/off switch, per branch.
--
-- WHY A NEW COLUMN
--
-- The settings table already has `antiban_enabled`, and it does NOT mean what it
-- sounds like: it controls whether the anti-ban BRAKES are applied. Turning it
-- OFF makes the account more aggressive, not less. An operator who read
-- "enabled = false" as "the AI is off" would get the exact opposite.
--
-- So the AI switch is its own column with its own name, and the two are never
-- conflated — different words, different jobs.
--
-- DEFAULT IS ON. Every branch that has already been running keeps answering;
-- adding a column must not silently silence a clinic. A branch that wants the AI
-- quiet switches it off deliberately.
--
-- IDEMPOTENT: guarded by information_schema, so re-running is a no-op.

SET @db := DATABASE();

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
    AND COLUMN_NAME = 'ai_enabled'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''AI replies for this branch. Separate from antiban_enabled, which controls the anti-ban brakes.''',
  'SELECT ''ai_enabled already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* Explicit backfill for rows that somehow arrived with NULL: MySQL adds the
 * column with the default, but a NOT NULL default is not retroactive if the
 * column was created by an older, different migration. */
SET @has_null := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings' AND COLUMN_NAME = 'ai_enabled'
);
SET @sql := IF(@has_null > 0,
  'UPDATE ai_whatsapp_settings SET ai_enabled = 1 WHERE ai_enabled IS NULL',
  'SELECT ''nothing to backfill'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings' AND COLUMN_NAME = 'ai_enabled') AS column_present,
  (SELECT COUNT(*) FROM ai_whatsapp_settings WHERE ai_enabled = 1) AS branches_with_ai_on,
  (SELECT COUNT(*) FROM ai_whatsapp_settings) AS total_settings_rows;
