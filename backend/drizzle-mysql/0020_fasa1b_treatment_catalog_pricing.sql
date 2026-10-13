-- 0020_fasa1b_treatment_catalog_pricing.sql
--
-- Fasa 1b, Seksyen 1. `treatment_catalog` carries the treatment name, category
-- and duration, but NO PRICE. The consequence is the single most expensive gap
-- in the system: Clinical can record what was done, `treatment_costs` can store
-- a cost row, Finance can render a bill — but nothing can put a REAL NUMBER on a
-- treatment, so every bill totals RM0.00.
--
-- The columns are taken from Dr Partner's treatment setup (`tsetup`), read during
-- the risikan and recorded in DRPARTNER-SENARAI-IMPORT.json:
--
--   price                 base fee, a local patient, walk-in
--   price_2               the second fee tier (Dr Partner's `tsetupprice_2`)
--   panel_price           what a panel/insurance pays — a DIFFERENT number from
--                         the walk-in price, which is why it is its own column
--                         rather than a discount percentage
--   cost                  what the treatment costs the clinic (lab, materials)
--   local_sst_pct         SST for a Malaysian patient
--   foreigner_sst_pct     SST for a foreign patient — the rates genuinely differ
--   classification_code   LHDN e-Invoice classification code. MANDATORY for
--                         e-Invoice, so it is added NOW even though the e-Invoice
--                         phase is later: a column is free today and a data
--                         migration over live billing rows is not.
--   keyboard_letter       keyboard shortcut for fast treatment entry
--
-- ALL PRICES ARE IN sen (INT), NOT decimal. Money in this schema is integer
-- minor units elsewhere (see `treatment_costs.unit_cost`), and a FLOAT price
-- will drift the moment a tax percentage is applied to it.
--
-- EVERY COLUMN IS NULLABLE. A treatment whose price is unknown must be
-- representable — that is the honest state of this clinic's data today (Dr
-- Partner has almost everything at 0.00, and the user has said to start at 0).
-- Defaulting them to 0 would silently price every treatment at RM0.00 and make
-- "not yet filled in" indistinguishable from "deliberately free".
--
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, so each addition is guarded by an
-- information_schema check, which makes this safe to apply twice.

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'price') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN price INT NULL COMMENT ''base fee in sen, local walk-in''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'price_2') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN price_2 INT NULL COMMENT ''second fee tier in sen''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'panel_price') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN panel_price INT NULL COMMENT ''amount a panel/insurer pays, in sen''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'cost') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN cost INT NULL COMMENT ''clinic cost (lab, materials) in sen''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'local_sst_pct') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN local_sst_pct DECIMAL(5,2) NULL COMMENT ''SST percent for a local patient''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'foreigner_sst_pct') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN foreigner_sst_pct DECIMAL(5,2) NULL COMMENT ''SST percent for a foreign patient''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'classification_code') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN classification_code VARCHAR(16) NULL COMMENT ''LHDN e-Invoice classification code''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'treatment_catalog'
       AND COLUMN_NAME = 'keyboard_letter') = 0,
  'ALTER TABLE treatment_catalog ADD COLUMN keyboard_letter VARCHAR(4) NULL COMMENT ''keyboard shortcut for fast entry''',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
