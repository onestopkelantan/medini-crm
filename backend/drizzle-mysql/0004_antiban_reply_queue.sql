-- FASA 5A — anti-ban reply engine + blast scheduling settings
--
-- Adds the operator-facing knobs that drive the reply queue and the promotion
-- blast window. Every column is nullable with a default so the migration is
-- safe to re-run and existing rows keep working (the service falls back to its
-- built-in envelope for any NULL).
--
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, so each addition is guarded by an
-- information_schema check. That matters here: migration 0003 in this repo was
-- applied outside drizzle-kit and is NOT idempotent, which made the deploy
-- order fragile. This one is safe to apply twice.

SET @db := DATABASE();

-- Collect window: how long the AI waits for a patient to finish typing before
-- answering the whole burst once.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'reply_window_seconds') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN reply_window_seconds INT NOT NULL DEFAULT 10',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- "Sedang menaip…" presence before a reply lands.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'typing_indicator_enabled') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN typing_indicator_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Blast scheduling envelope.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'blast_schedule_enabled') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN blast_schedule_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'blast_window_start_hour') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN blast_window_start_hour INT NOT NULL DEFAULT 8',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'blast_window_end_hour') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN blast_window_end_hour INT NOT NULL DEFAULT 22',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'max_blast_per_day') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN max_blast_per_day INT NOT NULL DEFAULT 100',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'blast_min_gap_seconds') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN blast_min_gap_seconds INT NOT NULL DEFAULT 300',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_whatsapp_settings'
       AND COLUMN_NAME = 'blast_max_gap_seconds') = 0,
  'ALTER TABLE ai_whatsapp_settings ADD COLUMN blast_max_gap_seconds INT NOT NULL DEFAULT 900',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Tighten the reply pacing already in the table: the clinic agreed 10–20s.
-- Only widens rows still sitting on the old 30–60s envelope, never overrides a
-- deliberate operator choice recorded after this migration.
UPDATE ai_whatsapp_settings
   SET min_delay_seconds = 10, max_delay_seconds = 20
 WHERE min_delay_seconds = 30 AND max_delay_seconds = 60;

-- Raise the daily ceiling from the old default of 50 to the agreed 100.
UPDATE ai_whatsapp_settings
   SET daily_message_cap = 100
 WHERE daily_message_cap = 50;
