-- ============================================================================
-- 0016_fasa1g_forms.sql — Fasa 1G: satu enjin borang (MC · PDPA · time-off)
--
-- WHAT THIS DOES
--
--  1. `consent_templates` is GENERALISED with a `kind` column instead of being
--     duplicated into three near-identical tables. Existing rows become kind='consent'.
--  2. The uniqueness rule WIDENS from (org, title, version) to (org, kind, title,
--     version). Without this, an MC titled "Consent" and a consent form titled
--     "Consent" could not both exist — the second INSERT would fail with a duplicate
--     key that names the WRONG cause.
--  3. Two new tables: `issued_forms` (a form that WAS issued, with its frozen wording
--     and its serial number) and `form_serial_counters` (the atomic counter behind
--     those serial numbers).
--
-- WHY `issued_forms` FREEZES THE TEXT
--
--   A printed MC is evidence. The template may be edited next month; the certificate in
--   the employer's file must still be reproducible word for word. `title_snapshot` and
--   `body_snapshot` copy the wording at issue time so an edit cannot silently rewrite a
--   document that already left the building.
--
-- SAFETY
--
--   Idempotent: every step is guarded, so replaying on a database that already has the
--   column/table is a no-op rather than an error. Applied AFTER a backup.
-- ============================================================================

-- ---------------------------------------------------------------- 1. kind column
SET @has_kind := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consent_templates' AND COLUMN_NAME = 'kind'
);

SET @sql := IF(@has_kind = 0,
  'ALTER TABLE consent_templates ADD COLUMN kind ENUM(''consent'',''mc'',''pdpa'',''time_off'') NOT NULL DEFAULT ''consent'' AFTER org_id',
  'SELECT ''kind sudah ada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill is unnecessary: the DEFAULT already set every existing row to 'consent'.
-- Stated explicitly anyway, because "the default handled it" is an assumption that
-- silently breaks if someone adds the column in two steps later.
UPDATE consent_templates SET kind = 'consent' WHERE kind IS NULL OR kind = '';

-- ---------------------------------------------------------------- 2. widen uniqueness
-- Drop the old key (title could collide across kinds) and add the kind-aware one.
SET @has_old := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consent_templates'
    AND INDEX_NAME = 'consent_templates_title_version_uq'
);
SET @sql := IF(@has_old > 0,
  'ALTER TABLE consent_templates DROP INDEX consent_templates_title_version_uq',
  'SELECT ''kunci lama tiada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_new := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consent_templates'
    AND INDEX_NAME = 'consent_templates_kind_title_version_uq'
);
SET @sql := IF(@has_new = 0,
  'ALTER TABLE consent_templates ADD UNIQUE KEY consent_templates_kind_title_version_uq (org_id, kind, title, version)',
  'SELECT ''kunci baharu sudah ada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consent_templates'
    AND INDEX_NAME = 'consent_templates_kind_idx'
);
SET @sql := IF(@has_idx = 0,
  'ALTER TABLE consent_templates ADD KEY consent_templates_kind_idx (org_id, kind, is_active)',
  'SELECT ''indeks kind sudah ada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- 3. issued_forms
CREATE TABLE IF NOT EXISTS issued_forms (
  id               VARCHAR(36)  NOT NULL,
  org_id           VARCHAR(36)  NOT NULL,
  branch_id        VARCHAR(36)  NULL,
  kind             ENUM('consent','mc','pdpa','time_off') NOT NULL,
  serial_no        VARCHAR(64)  NOT NULL,
  serial_year      INT          NOT NULL,
  template_id      VARCHAR(36)  NOT NULL,
  template_version INT          NOT NULL,
  title_snapshot   VARCHAR(256) NOT NULL,
  body_snapshot    TEXT         NOT NULL,
  patient_id       VARCHAR(36)  NULL,
  staff_id         VARCHAR(36)  NULL,
  encounter_id     VARCHAR(36)  NULL,
  subject          VARCHAR(256) NULL,
  details          TEXT         NULL,
  status           ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
  cancel_reason    VARCHAR(512) NULL,
  issued_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  issued_by        VARCHAR(36)  NULL,
  created_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by       VARCHAR(36)  NULL,
  PRIMARY KEY (id),
  /* The serial is unique per form family per year per organisation. A cancelled form
   * KEEPS its number — gaps are how an auditor spots a removed record. */
  UNIQUE KEY issued_forms_serial_uq (org_id, kind, serial_year, serial_no),
  KEY issued_forms_patient_idx (org_id, patient_id, issued_at),
  KEY issued_forms_staff_idx   (org_id, staff_id, issued_at),
  KEY issued_forms_template_fk (template_id),
  KEY issued_forms_branch_fk   (branch_id),
  KEY issued_forms_patient_fk  (patient_id),
  KEY issued_forms_staff_fk    (staff_id),
  KEY issued_forms_encounter_fk (encounter_id),
  CONSTRAINT issued_forms_template_fk  FOREIGN KEY (template_id)  REFERENCES consent_templates (id) ON DELETE RESTRICT,
  CONSTRAINT issued_forms_branch_fk    FOREIGN KEY (branch_id)    REFERENCES branches (id)          ON DELETE RESTRICT,
  CONSTRAINT issued_forms_patient_fk   FOREIGN KEY (patient_id)   REFERENCES patients (id)          ON DELETE RESTRICT,
  CONSTRAINT issued_forms_staff_fk     FOREIGN KEY (staff_id)     REFERENCES staff (id)             ON DELETE RESTRICT,
  CONSTRAINT issued_forms_encounter_fk FOREIGN KEY (encounter_id) REFERENCES encounters (id)        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 4. form_serial_counters
CREATE TABLE IF NOT EXISTS form_serial_counters (
  id          VARCHAR(36) NOT NULL,
  org_id      VARCHAR(36) NOT NULL,
  kind        ENUM('consent','mc','pdpa','time_off') NOT NULL,
  branch_id   VARCHAR(36) NULL,
  year        INT         NOT NULL,
  last_serial INT         NOT NULL DEFAULT 0,
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  /* One counter per family/branch/year. The uniqueness here is what makes the atomic
   * claim safe: two concurrent inserts collide on this key and one retries, instead of
   * both handing out the same serial. */
  UNIQUE KEY form_serial_counters_uq (org_id, kind, branch_id, year),
  KEY form_serial_counters_branch_fk (branch_id),
  CONSTRAINT form_serial_counters_branch_fk FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 5. verify
SELECT 'consent_templates.kind' AS objek, COUNT(*) AS ada
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consent_templates' AND COLUMN_NAME = 'kind'
UNION ALL
SELECT 'issued_forms', COUNT(*) FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issued_forms'
UNION ALL
SELECT 'form_serial_counters', COUNT(*) FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_serial_counters'
UNION ALL
SELECT 'kind consent sedia ada', COUNT(*) FROM consent_templates WHERE kind = 'consent';

-- ============================================================================
-- 0016b. `branch_key` — the uniqueness column, split from the foreign key.
--
-- WHY THIS EXISTS (found by running the counter against MySQL 8.4)
--
--   `form_serial_counters` originally keyed uniqueness on `branch_id`. Two problems:
--
--   1. `branch_id` is a FOREIGN KEY to `branches`. The recurring counter needs a sentinel
--      for "org-wide", and an empty string is not a valid branch row — the INSERT failed
--      outright with ERROR 1452 rather than falling through to the ON DUPLICATE branch.
--   2. MySQL treats NULLs as DISTINCT in a unique index. Keying on a NULLable `branch_id`
--      would insert a NEW row on every issue and the sequence would never advance past 1.
--
--   So uniqueness moves to `branch_key` ('' for org-wide) while `branch_id` keeps its
--   foreign key and stays NULL for an org-wide counter.
-- ============================================================================

SET @has_bk := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_serial_counters' AND COLUMN_NAME = 'branch_key'
);
SET @sql := IF(@has_bk = 0,
  'ALTER TABLE form_serial_counters ADD COLUMN branch_key VARCHAR(36) NOT NULL DEFAULT '''' AFTER branch_id',
  'SELECT ''branch_key sudah ada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill from the existing branch, so a counter created before this migration keeps its
-- identity instead of silently starting a second sequence.
SET @has_old_counter_key := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_serial_counters'
    AND INDEX_NAME = 'form_serial_counters_uq'
);
SET @sql := IF(@has_old_counter_key > 0,
  'ALTER TABLE form_serial_counters DROP INDEX form_serial_counters_uq',
  'SELECT ''kunci lama counter tiada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE form_serial_counters SET branch_key = COALESCE(branch_id, '') WHERE branch_key = '';

SET @has_new_counter_key := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_serial_counters'
    AND INDEX_NAME = 'form_serial_counters_key_uq'
);
SET @sql := IF(@has_new_counter_key = 0,
  'ALTER TABLE form_serial_counters ADD UNIQUE KEY form_serial_counters_key_uq (org_id, kind, branch_key, year)',
  'SELECT ''kunci counter baharu sudah ada'' AS noop');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'form_serial_counters.branch_key' AS objek, COUNT(*) AS ada
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_serial_counters' AND COLUMN_NAME = 'branch_key';
