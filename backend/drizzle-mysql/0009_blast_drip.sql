-- FASA 5C-D — blast drip scheduling.
--
-- A blast is spread across a 14-hour working day, so every message needs to know
-- WHEN it should go out. That instant is `send_at`.
--
-- WHY A COLUMN AND NOT A SEPARATE QUEUE TABLE
--
-- wa_messages is already the durable outbox: it holds status, retry state,
-- channel scope and the idempotency key, and the transport worker already reads
-- it. A second table would need its own lifecycle, its own foreign key into
-- wa_messages, and its own reconciliation sweep — and the two could disagree
-- about whether a message was sent. One column keeps one source of truth.
--
-- IDEMPOTENT by construction: every statement is guarded, so re-running this
-- file is a no-op. The earlier 0003 migration was applied outside drizzle-kit
-- and was NOT idempotent, which is a trap this file avoids.

SET @db := DATABASE();

/* ------------------------------------------------------------------ column */

SET @has_send_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND COLUMN_NAME = 'send_at'
);
SET @sql := IF(@has_send_at = 0,
  'ALTER TABLE wa_messages ADD COLUMN send_at DATETIME NULL COMMENT ''Earliest instant this message may be sent (blast drip). NULL = send as soon as the worker picks it up.''',
  'SELECT ''send_at already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ------------------------------------------------------------------- index */

/* The worker's claim query is "oldest due queued message for this channel".
 * Without this index that becomes a full scan of wa_messages, which is the
 * largest table in the schema once real clinic volume arrives. */
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND INDEX_NAME = 'wa_messages_due_idx'
);
SET @sql := IF(@has_idx = 0,
  'CREATE INDEX wa_messages_due_idx ON wa_messages (channel_id, status, send_at)',
  'SELECT ''wa_messages_due_idx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* --------------------------------------------------------- batch identity */

/* Groups the messages of one blast so an operator can see, and stop, a whole
 * campaign. Nullable: a single staff reply belongs to no batch. */
SET @has_batch := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND COLUMN_NAME = 'blast_batch_id'
);
SET @sql := IF(@has_batch = 0,
  'ALTER TABLE wa_messages ADD COLUMN blast_batch_id CHAR(36) NULL COMMENT ''Blast campaign this message belongs to; NULL for one-off replies.''',
  'SELECT ''blast_batch_id already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_bidx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND INDEX_NAME = 'wa_messages_batch_idx'
);
SET @sql := IF(@has_bidx = 0,
  'CREATE INDEX wa_messages_batch_idx ON wa_messages (blast_batch_id, status)',
  'SELECT ''wa_messages_batch_idx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* --------------------------------------------------------- cancelled state */

/* A message the worker refused to send — opted out, campaign stopped, or the
 * channel went away. Distinct from 'failed': failed means we TRIED and WhatsApp
 * rejected it, cancelled means we deliberately did not try. Conflating them
 * would make a compliance decision look like a delivery problem. */
SET @status_col := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND COLUMN_NAME = 'status'
);
SET @sql := IF(@status_col IS NOT NULL AND LOCATE('cancelled', @status_col) = 0,
  'ALTER TABLE wa_messages MODIFY COLUMN status ENUM(''queued'',''processing'',''sent'',''delivered'',''read'',''failed'',''cancelled'') NOT NULL DEFAULT ''queued''',
  'SELECT ''status enum already has cancelled'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cancel := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND COLUMN_NAME = 'cancelled_at'
);
SET @sql := IF(@has_cancel = 0,
  'ALTER TABLE wa_messages ADD COLUMN cancelled_at DATETIME NULL COMMENT ''Set when the worker deliberately did not send (opted out, campaign stopped).''',
  'SELECT ''cancelled_at already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ---------------------------------------------------------------- backfill */

/* Messages already queued keep NULL send_at, which the worker reads as "send
 * now". That is the correct interpretation for anything queued before this
 * migration existed, so no backfill is needed — and none is attempted, because
 * guessing a schedule for an in-flight blast would silently change its pace. */
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND COLUMN_NAME IN ('send_at','blast_batch_id','cancelled_at')) AS columns_added,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_messages' AND INDEX_NAME IN ('wa_messages_due_idx','wa_messages_batch_idx')) AS indexes_added;
