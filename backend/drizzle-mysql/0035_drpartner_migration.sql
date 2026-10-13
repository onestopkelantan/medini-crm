-- 0035_drpartner_migration.sql
-- Migrasi Dr Partner -> Medini CRM
-- Menambah: medan pesakit, penjaga, ubat, supplier, master rujukan
-- Semua additive (tiada DROP) — selamat dijalankan pada DB sedia ada.

-- =====================================================================
-- 1. patients — 15 medan baharu (medan Dr Partner yang Medini tiada)
-- =====================================================================
ALTER TABLE patients
  ADD COLUMN race VARCHAR(64) NULL AFTER gender,
  ADD COLUMN marital_status VARCHAR(32) NULL AFTER race,
  ADD COLUMN occupation VARCHAR(128) NULL AFTER marital_status,
  ADD COLUMN blood_type VARCHAR(8) NULL AFTER occupation,
  ADD COLUMN id_type VARCHAR(16) NULL AFTER ic,
  ADD COLUMN member_no VARCHAR(64) NULL AFTER panel_member_no,
  ADD COLUMN address TEXT NULL AFTER email,
  ADD COLUMN second_address TEXT NULL AFTER address,
  ADD COLUMN temperature DECIMAL(5,2) NULL,
  ADD COLUMN vaccine_dose VARCHAR(64) NULL,
  ADD COLUMN remark TEXT NULL,
  ADD COLUMN refer_by VARCHAR(128) NULL,
  ADD COLUMN tin_no VARCHAR(64) NULL,
  ADD COLUMN e_invoice_name VARCHAR(255) NULL,
  ADD COLUMN e_invoice_ic_no VARCHAR(64) NULL,
  ADD COLUMN preferred_language VARCHAR(8) NULL;

-- =====================================================================
-- 2. patient_guardians — penjaga/ibubapa (Dr Partner ada 9 medan)
-- =====================================================================
CREATE TABLE IF NOT EXISTS patient_guardians (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  patient_id CHAR(36) NOT NULL,
  relationship VARCHAR(16) NOT NULL,      -- FATHER | MOTHER | GUARDIAN
  name VARCHAR(255) NULL,
  ic_no VARCHAR(64) NULL,
  phone VARCHAR(32) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  KEY idx_pg_patient (patient_id),
  KEY idx_pg_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 3. suppliers — 27 pembekal Dr Partner
-- =====================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  code VARCHAR(32) NULL,
  name VARCHAR(255) NOT NULL,
  person_in_charge VARCHAR(255) NULL,
  contact VARCHAR(64) NULL,
  address TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'Active',
  external_ref VARCHAR(64) NULL,          -- id Dr Partner
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  KEY idx_sup_org (org_id),
  KEY idx_sup_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 4. medicines — 14 ubat + atribut klinikal
-- =====================================================================
CREATE TABLE IF NOT EXISTS medicines (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64) NULL,              -- ANTIBIOTIC | BENGKAK | PAINKILLER
  uom VARCHAR(32) NULL,
  selling_price DECIMAL(12,2) NULL,
  grade VARCHAR(16) NULL,
  attribute VARCHAR(64) NULL,
  alert VARCHAR(128) NULL,
  is_controlled TINYINT(1) NOT NULL DEFAULT 0,
  meal VARCHAR(32) NULL,
  usage_note VARCHAR(128) NULL,
  dosage VARCHAR(128) NULL,
  max_dose VARCHAR(64) NULL,
  min_order INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  external_ref VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  KEY idx_med_org (org_id),
  KEY idx_med_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 5. uoms — unit ukuran (5)
-- =====================================================================
CREATE TABLE IF NOT EXISTS uoms (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  code VARCHAR(16) NOT NULL,
  name VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  UNIQUE KEY uq_uom_org_code (org_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 6. treatment_categories — 17 kategori Dr Partner
-- =====================================================================
CREATE TABLE IF NOT EXISTS treatment_categories (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  UNIQUE KEY uq_tcat_org_code (org_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 7. appointment_purposes — 8 tujuan + tempoh lalai
-- =====================================================================
CREATE TABLE IF NOT EXISTS appointment_purposes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  name VARCHAR(128) NOT NULL,
  default_hours INT NOT NULL DEFAULT 0,
  default_minutes INT NOT NULL DEFAULT 30,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  UNIQUE KEY uq_apurpose_org_name (org_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 8. vouchers — 1 voucher (GOOGLE REVIEW 10%)
-- =====================================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  discount_method VARCHAR(8) NOT NULL DEFAULT '%',   -- '%' | 'RM'
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  KEY idx_voucher_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 9. medicine reference lists (kategori, grade, alert, meal, usage, dosage)
-- =====================================================================
CREATE TABLE IF NOT EXISTS medicine_ref_lists (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  list_type VARCHAR(32) NOT NULL,   -- CATEGORY|GRADE|ALERT|MEAL|USAGE|DOSAGE|ATTRIBUTE|GROUP
  value VARCHAR(128) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  KEY idx_mref_org_type (org_id, list_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 10. inventory categories (bahan 13 + produk 1)
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventory_categories (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  item_kind VARCHAR(16) NOT NULL,   -- MATERIAL | PRODUCT
  name VARCHAR(128) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  KEY idx_invcat_org_kind (org_id, item_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 11. inv_items — tambah medan Dr Partner
-- =====================================================================
ALTER TABLE inv_items
  ADD COLUMN supplier_id CHAR(36) NULL,
  ADD COLUMN external_ref VARCHAR(64) NULL,
  ADD COLUMN barcode VARCHAR(64) NULL,
  ADD COLUMN expiry_date DATE NULL,
  ADD COLUMN reorder_level DECIMAL(12,4) NULL;
