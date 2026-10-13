-- FASA 5E — WhatsApp opt-out (STOP list)
--
-- WHY
--
-- A patient who replies "STOP" must never be blasted again. For a clinic this is
-- not a courtesy: continuing to message someone who asked to stop is a PDPA
-- exposure, and operationally it is the fastest way to be reported and have the
-- number restricted by Meta — which costs every OTHER patient their reminders.
--
-- KEYED ON PHONE, ORG-WIDE.
--
--   * Phone, not patient_id: the blast path works from a raw number list, and a
--     number may belong to no patient record at all (a lead, a guardian, an
--     archived patient). Their STOP must still count.
--   * Org-wide, not per branch: "stop" means stop messaging me, not stop
--     messaging me from this one clinic. A patient who opts out at Setia Tropika
--     must not be re-contacted by Bukit Indah.
--
-- Idempotent: guarded so re-applying is safe.

CREATE TABLE IF NOT EXISTS wa_opt_outs (
  id              VARCHAR(36)  NOT NULL,
  org_id          VARCHAR(36)  NOT NULL,
  phone           VARCHAR(64)  NOT NULL,
  source          ENUM('reply_stop','staff_manual','patient_request') NOT NULL DEFAULT 'reply_stop',
  matched_keyword VARCHAR(64)  NULL,
  reason          VARCHAR(512) NULL,
  origin_branch_id VARCHAR(36) NULL,
  patient_id      VARCHAR(36) NULL,
  revoked_at      DATETIME(6)  NULL,
  revoked_by      VARCHAR(36)  NULL,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by      VARCHAR(36)  NULL,
  updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_by      VARCHAR(36)  NULL,
  deleted_at      DATETIME(6)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY wa_opt_outs_phone_uq (org_id, phone),
  KEY wa_opt_outs_active_idx (org_id, deleted_at)
  /* The FK to branches is declared in a follow-up statement so the collation is
   * explicit — branches.id is utf8mb4_unicode_ci and a mismatch fails with
   * ER_FK_INCOMPATIBLE_COLUMNS (3780). */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE wa_opt_outs
  MODIFY origin_branch_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- Added separately and idempotently: a second run must not fail on a duplicate
-- constraint name.
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'wa_opt_outs'
     AND CONSTRAINT_NAME = 'wa_opt_outs_branch_fk'
);
SET @sql := IF(@has_fk = 0,
  'ALTER TABLE wa_opt_outs ADD CONSTRAINT wa_opt_outs_branch_fk FOREIGN KEY (origin_branch_id) REFERENCES branches (id) ON DELETE SET NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill from patients who already carry an explicit "do not contact"
-- signal, so existing intent is honoured from day one rather than only for
-- opt-outs that arrive after this migration.
--
-- NORMALISATION MUST MATCH normalizePhone() EXACTLY. That function strips
-- everything but digits AND rewrites a leading local `0` to `60` (01x → 601x).
-- A backfill that stored `0123456789` while the service looks up `60123456789`
-- would never match — the entry would sit in the table looking correct while the
-- patient kept receiving messages.
--
-- Idempotent via INSERT IGNORE on the (org_id, phone) unique key.
INSERT IGNORE INTO wa_opt_outs (id, org_id, phone, source, reason, patient_id, origin_branch_id)
SELECT
  UUID(),
  p.org_id,
  CASE
    WHEN REGEXP_REPLACE(COALESCE(NULLIF(TRIM(p.whatsapp), ''), NULLIF(TRIM(p.phone), '')), '[^0-9]', '') LIKE '0%'
     AND REGEXP_REPLACE(COALESCE(NULLIF(TRIM(p.whatsapp), ''), NULLIF(TRIM(p.phone), '')), '[^0-9]', '') NOT LIKE '00%'
    THEN CONCAT('6', REGEXP_REPLACE(COALESCE(NULLIF(TRIM(p.whatsapp), ''), NULLIF(TRIM(p.phone), '')), '[^0-9]', ''))
    ELSE REGEXP_REPLACE(COALESCE(NULLIF(TRIM(p.whatsapp), ''), NULLIF(TRIM(p.phone), '')), '[^0-9]', '')
  END,
  'patient_request',
  'Diimport daripada rekod pesakit (preferred_contact = none)',
  p.id,
  p.branch_id
FROM patients p
WHERE p.deleted_at IS NULL
  AND LOWER(COALESCE(p.preferred_contact, '')) = 'none'
  AND COALESCE(NULLIF(TRIM(p.whatsapp), ''), NULLIF(TRIM(p.phone), '')) IS NOT NULL;
