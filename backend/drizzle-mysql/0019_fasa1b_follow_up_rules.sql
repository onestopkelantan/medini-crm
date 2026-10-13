-- 0019_fasa1b_follow_up_rules.sql
--
-- Fasa 1B declared the `followUpRules` table in the Drizzle schema and shipped
-- the service/repository/controller for it, but NO MIGRATION EVER CREATED IT.
-- The consequence was not a build error: `GET /marketing/follow-up-rules`
-- returned HTTP 500 "Failed query ... from `follow_up_rules`" at runtime, and
-- the Follow-up tab in Marketing had no rules to show. A schema file is not a
-- table — only a migration makes one.
--
-- Shape mirrors `recall_rules` EXACTLY, column for column, because the two rule
-- tables are consumed by the same repository helper and must agree on types.
-- The first version of this migration failed with:
--   "Referencing column 'org_id' and referenced column 'id' in foreign key
--    constraint 'follow_up_rules_org_id_organizations_id_fk' are incompatible."
-- Two separate mistakes produced that:
--   1. `char(36)` where every other table in this schema uses `varchar(36)`.
--      A CHAR(36) and a VARCHAR(36) are not compatible FK types in MySQL.
--   2. A collation (`utf8mb4_0900_ai_ci`) that differs from the schema's
--      `utf8mb4_unicode_ci`, which MySQL also refuses to join across an FK.
-- The third lesson is the important one: `recall_rules` carries a FOREIGN KEY
-- on `branch_id` but NONE on `org_id`. Inventing an org FK here would have
-- been "more correct" in isolation and yet would have diverged from every
-- sibling table — copy the working neighbour rather than the tidier idea.

CREATE TABLE IF NOT EXISTS `follow_up_rules` (
  `id`             varchar(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `org_id`         varchar(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_id`      varchar(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `name`           varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `treatment_code` varchar(64)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `days_after`     int          NOT NULL,
  `active`         tinyint(1)   NOT NULL DEFAULT 1,
  `created_at`     datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`     varchar(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at`     datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by`     varchar(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deleted_at`     datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `follow_up_rules_branch_active_idx` (`branch_id`, `active`),
  CONSTRAINT `follow_up_rules_branch_id_branches_id_fk`
    FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `follow_up_rules_days_positive` CHECK ((`days_after` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
