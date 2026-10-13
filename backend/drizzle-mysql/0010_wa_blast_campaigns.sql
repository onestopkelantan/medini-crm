-- FASA 5C-D — blast campaign registry.
--
-- A blast is one campaign: 1400 numbers over 14 days. The operator needs to see
-- its progress, and needs to be able to STOP it — and a stop has to affect
-- everything not yet sent, including messages already sitting in the queue.
--
-- WHY A SEPARATE TABLE
--
-- wa_messages.blast_batch_id records which campaign a message belongs to, but a
-- message row cannot hold campaign-level state (a stop is one fact about the
-- whole campaign, not 1400 facts). Storing the stop flag here means the worker
-- answers "should I still send this?" with a single indexed lookup.
--
-- IDEMPOTENT: table and indexes are created only when absent.

SET @db := DATABASE();

SET @has_table := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns'
);

SET @sql := IF(@has_table = 0,
  'CREATE TABLE wa_blast_campaigns (
     id            CHAR(36)     NOT NULL,
     org_id        CHAR(36)     NOT NULL,
     branch_id     CHAR(36)     NOT NULL,
     channel_id    CHAR(36)     NULL,
     batch_id      CHAR(36)     NOT NULL,
     name          VARCHAR(160) NOT NULL,
     status        VARCHAR(24)  NOT NULL DEFAULT ''running'',
     total_count   INT          NOT NULL DEFAULT 0,
     sent_count    INT          NOT NULL DEFAULT 0,
     failed_count  INT          NOT NULL DEFAULT 0,
     cancelled_count INT        NOT NULL DEFAULT 0,
     body          TEXT         NULL,
     audience_note VARCHAR(255) NULL,
     window_start_hour TINYINT  NOT NULL DEFAULT 8,
     window_end_hour   TINYINT  NOT NULL DEFAULT 22,
     per_day       INT          NOT NULL DEFAULT 100,
     first_send_at DATETIME     NULL,
     last_send_at  DATETIME     NULL,
     cancelled_at  DATETIME     NULL,
     created_by    CHAR(36)     NULL,
     updated_by    CHAR(36)     NULL,
     created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted_at    DATETIME     NULL,
     PRIMARY KEY (id),
     UNIQUE KEY wa_blast_campaigns_batch_uq (batch_id),
     KEY wa_blast_campaigns_scope_idx (org_id, branch_id, status, created_at),
     KEY wa_blast_campaigns_branch_id_foreign (branch_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT ''wa_blast_campaigns already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* --------------------------------------------------- cancelled is terminal */

/* One nullable timestamp is enough for a stop; a boolean would need a matching
 * "by whom" column to be auditable, and the audit table already records that. */
SET @has_cancel_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns' AND COLUMN_NAME = 'cancelled_at'
);
SET @sql := IF(@has_cancel_col = 0,
  'ALTER TABLE wa_blast_campaigns ADD COLUMN cancelled_at DATETIME NULL',
  'SELECT ''cancelled_at already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ------------------------------------------------------------------ repair */

/* This CREATE pins the collation now, but a database that already ran the earlier
 * version has the table in the server default (utf8mb4_0900_ai_ci) while every
 * other table is utf8mb4_unicode_ci. No JOIN uses this table yet, so it has not
 * failed — but `isCampaignStopped` compares batch_id against a value read from
 * wa_messages, and that comparison raises "Illegal mix of collations" the moment
 * an operator tries to stop a campaign. Fixed here rather than waiting for it. */
SET @wrong_collation := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns'
    AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'
);
SET @sql := IF(@wrong_collation > 0,
  'ALTER TABLE wa_blast_campaigns CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''collation already correct'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns') AS table_present,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_blast_campaigns' AND INDEX_NAME = 'wa_blast_campaigns_batch_uq') AS batch_index_present;
