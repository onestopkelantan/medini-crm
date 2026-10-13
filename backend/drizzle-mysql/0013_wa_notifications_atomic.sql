-- FASA 5D-B (fix) — make coalescing atomic.
--
-- THE BUG THIS FIXES
--
-- raise() read for an open notification and then inserted one. Two events
-- arriving at the same time both found nothing and both inserted, so a burst of
-- eight waiting patients produced two rows instead of one. Worse than the
-- duplicate: eight concurrent raises produced a row counting FOUR. The other
-- four were lost — an operator would have seen "4 waiting" when eight were.
--
-- The read-then-write pair is not atomic, and no amount of retrying fixes that.
-- The merge has to happen in the database, which needs a key to collide on.
--
-- WHY A GENERATED COLUMN
--
-- The uniqueness we want is conditional: "at most one UNREAD row per
-- (org, branch, kind, entity)". A plain unique index cannot express "only while
-- unread" — it would also forbid the second row that must appear once the first
-- is read. MySQL can, via a generated column that is the identity tuple while
-- unread and NULL once read: NULLs do not collide in a unique index, so read
-- rows drop out of the constraint on their own.
--
-- The alternative — SELECT ... FOR UPDATE around the lookup — works but holds a
-- lock across the whole raise, including the copy composition, and changes the
-- concurrency profile of every caller. The generated key keeps raise() a single
-- statement.
--
-- IDEMPOTENT: column and index are added only when absent.

SET @db := DATABASE();

/* ---------------------------------------------------------- generated key */

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications'
    AND COLUMN_NAME = 'unread_key'
);

SET @sql := IF(@has_col = 0,
  'ALTER TABLE wa_notifications
     ADD COLUMN unread_key VARCHAR(191)
       GENERATED ALWAYS AS (
         CASE WHEN read_at IS NULL AND deleted_at IS NULL
              THEN CONCAT(org_id, ''|'', COALESCE(branch_id, ''''), ''|'', kind, ''|'', COALESCE(entity_id, ''''))
              ELSE NULL END
       ) STORED',
  'SELECT ''unread_key already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* 191 chars keeps the index inside the utf8mb4 key limit (191 * 4 = 764 bytes).
 * org_id and branch_id are 36 each, kind 32, entity_id 64: 36+1+36+1+32+1+64 =
 * 171, so the tuple always fits. */

/* ------------------------------------------------------- dedupe any strays */

/* RUNS BEFORE THE UNIQUE INDEX — this is the whole point of the ordering.
 *
 * A database that ran the racing version can hold several open rows for the same
 * key. Creating the unique index first, over that data, fails with
 *
 *   ERROR 1062 Duplicate entry '...' for key 'wa_notifications_unread_uidx'
 *
 * and aborts the migration half-applied — the column added, the index missing.
 * That is exactly the state a clinic would be left in. So the duplicates are
 * merged FIRST, then the constraint is added to data that can satisfy it.
 *
 * The earliest row keeps its id and first_at (the operator first saw it then);
 * counts are summed so no event is silently dropped. A no-op on a clean table. */

CREATE TEMPORARY TABLE IF NOT EXISTS wa_notif_merge AS
SELECT unread_key,
       SUBSTRING_INDEX(MIN(CONCAT(DATE_FORMAT(first_at, '%Y%m%d%H%i%s%f'), ':', id)), ':', -1) AS keep_id,
       SUM(occurrence_count) AS total,
       MAX(last_at) AS last_at
FROM wa_notifications
WHERE unread_key IS NOT NULL
GROUP BY unread_key
HAVING COUNT(*) > 1;

UPDATE wa_notifications n
  JOIN wa_notif_merge m ON m.keep_id = n.id
SET n.occurrence_count = m.total,
    n.last_at = m.last_at;

DELETE n FROM wa_notifications n
  JOIN wa_notif_merge m ON m.unread_key = n.unread_key
WHERE n.id <> m.keep_id;

DROP TEMPORARY TABLE IF EXISTS wa_notif_merge;

/* ------------------------------------------------------------ the constraint */

SET @has_uidx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications'
    AND INDEX_NAME = 'wa_notifications_unread_uidx'
);

SET @sql := IF(@has_uidx = 0,
  'CREATE UNIQUE INDEX wa_notifications_unread_uidx ON wa_notifications (unread_key)',
  'SELECT ''wa_notifications_unread_uidx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications'
     AND COLUMN_NAME = 'unread_key') AS generated_col_present,
  (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'wa_notifications') AS index_count;
