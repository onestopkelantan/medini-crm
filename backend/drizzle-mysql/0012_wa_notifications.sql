-- FASA 5D-B — notifications.
--
-- The queue named 'notifications' was declared in QueueRegistry and never used.
-- There was no table either, so an event had nowhere to land: when the AI handed
-- a patient to a human, the conversation was flagged and nothing told anybody.
--
-- WHY A TABLE AND NOT JUST A QUEUE
--
-- A notification is durable state the operator reads later, not a message that
-- is consumed and gone. The bell has to show what is unread after a page reload,
-- and an operator who was away for an hour must still see what happened. The
-- queue carries the WORK of producing a notification; this table IS the
-- notification.
--
-- COALESCING lives in the count column: one row per (kind, scope) inside a
-- window, with occurrence_count rising, rather than one row per event.
--
-- IDEMPOTENT: table and indexes are created only when absent.

SET @db := DATABASE();

SET @has_table := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications'
);

SET @sql := IF(@has_table = 0,
  'CREATE TABLE wa_notifications (
     id              CHAR(36)     NOT NULL,
     org_id          CHAR(36)     NOT NULL,
     branch_id       CHAR(36)     NULL,
     kind            VARCHAR(32)  NOT NULL,
     severity        VARCHAR(16)  NOT NULL DEFAULT ''info'',
     title           VARCHAR(255) NOT NULL,
     body            VARCHAR(512) NOT NULL,
     entity_id       VARCHAR(64)  NULL,
     entity_type     VARCHAR(48)  NULL,
     occurrence_count INT         NOT NULL DEFAULT 1,
     first_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     last_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     read_at         DATETIME(6)  NULL,
     read_by         CHAR(36)     NULL,
     deleted_at      DATETIME(6)  NULL,
     created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
     PRIMARY KEY (id),
     /* The bell''s query: unread for this scope, newest first. */
     KEY wa_notifications_bell_idx (org_id, branch_id, read_at, last_at),
     /* Coalescing lookup: the open notification of this kind for this scope. */
     KEY wa_notifications_coalesce_idx (org_id, branch_id, kind, entity_id, read_at),
     KEY wa_notifications_kind_idx (kind, last_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT ''wa_notifications already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* Unread counting is the hot path: the badge polls it. A partial index is not
 * available in MySQL, so the composite index above carries read_at as the third
 * column and the count is served from it. */
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications' AND INDEX_NAME = 'wa_notifications_bell_idx'
);
SET @sql := IF(@has_idx = 0,
  'CREATE INDEX wa_notifications_bell_idx ON wa_notifications (org_id, branch_id, read_at, last_at)',
  'SELECT ''wa_notifications_bell_idx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ------------------------------------------------------------------ repair */

/* The CREATE above pins the collation, but a database that already ran the
 * earlier version of this file has the table in the server default
 * (utf8mb4_0900_ai_ci). Joining that to `branches` (utf8mb4_unicode_ci) raises
 * "Illegal mix of collations" — the list query fails with a 500, not a bad
 * result. Guarded so a correct database is left alone. */
SET @wrong_collation := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications'
    AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'
);
SET @sql := IF(@wrong_collation > 0,
  'ALTER TABLE wa_notifications CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''collation already correct'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications') AS table_present,
  (SELECT TABLE_COLLATION FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications') AS collation_used,
  (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications') AS index_count;
