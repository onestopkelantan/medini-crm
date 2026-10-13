-- ============================================================================
-- 0029 — wa_channels.is_primary + unique guard per primary (channel switching)
--
-- WHY
--
-- A branch could only ever have ONE channel row: `uq_live_guard` (unique on
-- org,branch when not deleted) made a second number for the same branch
-- impossible. That killed the real clinic workflow — when the primary number
-- is banned or dies, the operator registers a SPARE number, and the two must
-- be able to sit side by side with exactly one of them LIVE. The old guard
-- forced delete-and-recreate, losing the dead number's history, and offered
-- no switch at all ("gantian yang on jadi ada switchnya").
--
-- MODEL
--
--   is_primary = 1  → this channel is the branch's LIVE number: inbound
--                     routes to the branch, replies go out through it.
--   is_primary = 0  → spare/retired. Row (and transcript history) kept.
--
-- The uniqueness moves with the meaning: at most ONE PRIMARY per
-- (org, branch) among live rows, via a new virtual guard column.
-- ============================================================================
--> statement-breakpoint

ALTER TABLE `wa_channels`
  ADD COLUMN `is_primary` tinyint(1) NOT NULL DEFAULT 0 AFTER `ai_reply_enabled_by`;
--> statement-breakpoint

/* Drop the one-channel-per-branch guard — replaced by one-PRIMARY-per-branch. */
ALTER TABLE `wa_channels` DROP INDEX `wa_channels_branch_active_uq`;
--> statement-breakpoint

/* Virtual guard: 1 only for a live PRIMARY channel, NULL otherwise — so the
 * unique key below bites exactly the rows that must be exclusive. */
ALTER TABLE `wa_channels`
  ADD COLUMN `uq_primary_guard` tinyint GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL AND `is_primary` = 1 THEN 1 ELSE NULL END
  ) VIRTUAL AFTER `uq_live_guard`;
--> statement-breakpoint

ALTER TABLE `wa_channels`
  ADD UNIQUE KEY `wa_channels_branch_primary_uq` (`org_id`, `branch_id`, `uq_primary_guard`);
--> statement-breakpoint

/* Every branch's existing single channel is its primary — that is what it is
 * today, so the invariant starts satisfied rather than every branch starting
 * with no live number. */
UPDATE `wa_channels` SET `is_primary` = 1 WHERE `deleted_at` IS NULL;
--> statement-breakpoint

CREATE INDEX `wa_channels_branch_primary_idx` ON `wa_channels` (`branch_id`, `is_primary`, `deleted_at`);
