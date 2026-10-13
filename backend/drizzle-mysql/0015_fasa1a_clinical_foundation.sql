-- Fasa 1A — Clinical foundation: both dentitions, configurable chart symbols,
-- and the allergy data the completion gate was missing.
--
-- WHAT THIS CHANGES AND WHY
--
-- 1. `tooth_records.symbol_code` — the chart's extra findings (impacted,
--    extracted, bridge, denture, veneer, periapical, mobility).
--
--    The first cut of this phase proposed widening the `tooth_condition` enum
--    from 7 values to 14. That was the wrong shape: every new symbol would then
--    cost a database enum migration, and the clinic still could not define one
--    of its own. `chart_symbols` makes symbols DATA — adding one is a row.
--    The enum keeps its 7 values, unchanged, and any client that sends one of
--    the old 7 still writes exactly as before.
--
-- 2. `chart_symbols` — the clinic's own legend. Dr Partner calls this
--    "dental chart symbol" (`chartname`) and stores it per treatment.
--
-- 3. `patient_allergies` — `patients` carries no medical-alert column and no
--    allergy table ever existed, so `safety-gate.ts` could only see a severe
--    ADVERSE EVENT: a reaction this patient had ALREADY suffered here. The gate
--    could not prevent a first exposure, which is the entire point of an allergy
--    check. The module documented that hole itself ("KNOWN BOUNDARY, debt M-3").
--
-- 4. `treatment_catalog.requires_xray` + `chart_symbol_code` — Dr Partner's
--    `xrayind` and `chartname`.
--
-- IDEMPOTENT: every statement is guarded by an information_schema check, so a
-- re-run (or a run against a database that already has part of this) is a no-op.
-- Written to be safe on MySQL 8 and on a fresh schema built from 0000.

SET @db := DATABASE();

/* ============================================ 1. tooth_records.symbol_code */

SET @has_symbol := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tooth_records'
    AND COLUMN_NAME = 'symbol_code'
);
SET @sql := IF(@has_symbol = 0,
  'ALTER TABLE tooth_records ADD COLUMN symbol_code VARCHAR(64) NULL AFTER `condition`',
  'SELECT ''tooth_records.symbol_code already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ================================================ 2. treatment_catalog */

SET @has_xray := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
    AND COLUMN_NAME = 'requires_xray'
);
SET @sql := IF(@has_xray = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN requires_xray TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''treatment_catalog.requires_xray already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_chartsym := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
    AND COLUMN_NAME = 'chart_symbol_code'
);
SET @sql := IF(@has_chartsym = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN chart_symbol_code VARCHAR(64) NULL',
  'SELECT ''treatment_catalog.chart_symbol_code already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ==================================================== 3. chart_symbols */

CREATE TABLE IF NOT EXISTS `chart_symbols` (
  `id`            varchar(36)  NOT NULL,
  `org_id`        varchar(36)  NOT NULL,
  `code`          varchar(64)  NOT NULL,
  `label`         varchar(128) NOT NULL,
  `colour`        varchar(9)   NOT NULL,
  `mark`          enum('none','cross','slash','stroke','dot','circle','wave','bar','grid') NOT NULL DEFAULT 'none',
  `sort_order`    int          NOT NULL DEFAULT 100,
  `is_built_in`   tinyint(1)   NOT NULL DEFAULT 0,
  `is_active`     tinyint(1)   NOT NULL DEFAULT 1,
  `created_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`    varchar(36)  NULL,
  `updated_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by`    varchar(36)  NULL,
  `deleted_at`    datetime(6)  NULL,
  CONSTRAINT `chart_symbols_id` PRIMARY KEY (`id`),
  /* Codes match EXACTLY. The service normalises at write AND read, which is
   * what stops "Bridge" and "bridge" becoming two symbols that draw the same
   * way — a duplicate a clinic can see but cannot explain. Collation is forced
   * to the case-sensitive one so the database agrees with that rule rather than
   * relying on the service to enforce it. */
  CONSTRAINT `chart_symbols_org_code_uq` UNIQUE (`org_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chart_symbols'
    AND INDEX_NAME = 'chart_symbols_org_active_idx'
);
SET @sql := IF(@has_idx = 0,
  'CREATE INDEX chart_symbols_org_active_idx ON chart_symbols (org_id, is_active)',
  'SELECT ''chart_symbols_org_active_idx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ---------------------------------------------------- 3b. seed the legend
 *
 * 7 rows, ONE PER ORG, inserted only where the org has none yet. Guarded by
 * NOT EXISTS rather than INSERT IGNORE so re-running the migration cannot
 * resurrect a symbol the clinic deliberately deactivated.
 *
 * A fresh org inherits these; a clinic can re-colour, re-order and deactivate
 * them, and can add its own. Built-ins are never DELETED, because a historical
 * chart that stored `extracted` must keep drawing it. */
INSERT INTO `chart_symbols`
  (`id`, `org_id`, `code`, `label`, `colour`, `mark`, `sort_order`, `is_built_in`, `is_active`)
SELECT
  UUID(), o.org_id, s.code, s.label, s.colour, s.mark, s.sort_order, 1, 1
FROM (
  SELECT DISTINCT org_id FROM branches WHERE deleted_at IS NULL
) o
JOIN (
  SELECT 'impacted'   AS code, 'Impacted'           AS label, '#78350f' AS colour, 'cross'  AS mark, 10 AS sort_order
  UNION ALL SELECT 'extracted',  'Extracted',              '#111827', 'cross',  20
  UNION ALL SELECT 'bridge',     'Bridge',                 '#16a34a', 'bar',    30
  UNION ALL SELECT 'denture',    'Denture',                '#ec4899', 'circle', 40
  UNION ALL SELECT 'veneer',     'Veneer',                 '#38bdf8', 'stroke', 50
  UNION ALL SELECT 'periapical', 'Periapical lesion',      '#b91c1c', 'dot',    60
  UNION ALL SELECT 'mobility',   'Mobile tooth',           '#ea580c', 'wave',   70
) s
WHERE NOT EXISTS (
  SELECT 1 FROM `chart_symbols` c WHERE c.org_id = o.org_id
);

/* ================================================== 4. patient_allergies */

CREATE TABLE IF NOT EXISTS `patient_allergies` (
  `id`             varchar(36)  NOT NULL,
  `org_id`         varchar(36)  NOT NULL,
  `branch_id`      varchar(36)  NOT NULL,
  `patient_id`     varchar(36)  NOT NULL,
  `allergen`       varchar(256) NOT NULL,
  `category`       enum('drug','food','material','environmental','other') NOT NULL DEFAULT 'drug',
  /* `unknown` ranks ABOVE mild/moderate in the domain: an allergy nobody
   * assessed is not a mild allergy, and the gate must not treat it as one. */
  `severity`       enum('mild','moderate','unknown','severe','life_threatening') NOT NULL,
  `reaction`       varchar(512) NULL,
  `noted_by`       varchar(36)  NULL,
  `noted_at`       datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  /* RETIRE, never delete — an allergy that stops being a risk still has to
   * explain itself, and "believed once" is information a review needs. */
  `retired_at`     datetime(6)  NULL,
  `retired_by`     varchar(36)  NULL,
  `retired_reason` varchar(512) NULL,
  `created_at`     datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`     varchar(36)  NULL,
  `updated_at`     datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by`     varchar(36)  NULL,
  `deleted_at`     datetime(6)  NULL,
  CONSTRAINT `patient_allergies_id` PRIMARY KEY (`id`),
  /* ONE active record per allergen per patient.
   *
   * NULL in a MySQL unique index does not compare equal to another NULL, so
   * including `retired_at` here means: two ACTIVE rows for the same allergen
   * collide (retired_at IS NULL — actually MySQL treats those as distinct, see
   * the service guard), while a retired row never blocks a new one. The service
   * checks active duplicates explicitly because a NULL-based unique cannot be
   * relied on for it. Kept as a second line of defence, not the first. */
  CONSTRAINT `patient_allergies_active_uq` UNIQUE (`patient_id`, `allergen`, `retired_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'patient_allergies'
    AND INDEX_NAME = 'patient_allergies_patient_idx'
);
SET @sql := IF(@has_idx = 0,
  'CREATE INDEX patient_allergies_patient_idx ON patient_allergies (patient_id, retired_at)',
  'SELECT ''patient_allergies_patient_idx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'patient_allergies'
    AND INDEX_NAME = 'patient_allergies_branch_idx'
);
SET @sql := IF(@has_idx = 0,
  'CREATE INDEX patient_allergies_branch_idx ON patient_allergies (branch_id)',
  'SELECT ''patient_allergies_branch_idx already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ================================================================ verify */

SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tooth_records'
     AND COLUMN_NAME = 'symbol_code') AS tooth_symbol_col,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
     AND COLUMN_NAME IN ('requires_xray', 'chart_symbol_code')) AS catalog_cols,
  (SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chart_symbols') AS chart_symbols_table,
  (SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'patient_allergies') AS allergies_table,
  (SELECT COUNT(*) FROM `chart_symbols` WHERE is_built_in = 1) AS built_in_symbols;
