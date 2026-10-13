-- ============================================================================
-- 0031 — scrubbing_rules: interval scrubbing per rawatan (boss directive #4)
--
-- BOSS (8 Okt): "AI Scrubbing harus ada list of scrubbing. Bagian Clinical
-- tanya ke Hermes masalah mana treatment yang butuh scrubbing, nanti di
-- filter based on treatment bisa 3 bulan sekali 4 bulan sekali tergantung
-- treatment intinya. UI/UX branch manager bisa setting berapa lama patient
-- harus scrubbing."
--
-- MODEL
--
-- Satu baris per (cabang, rawatan): berapa bulan selepas rawatan terakhir
-- seorang pesakit patut dihubungi semula ("scaling setiap 6 bulan",
-- "polish 4 bulan"). Bukan jadual kenal pasti global — cabang menentukan
-- rentangnya sendiri; HQ melihat semua.
--
-- DEFAULT masuk dari seed (doktor boleh laraskan kemudian):
--   Scaling/Polish 6 bulan · Fluoride 6 · Extraction 3 · RCT 12 ·
--   Crown 12 · Filling 12 · Consultation 6
-- ============================================================================
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `scrubbing_rules` (
  `id` varchar(36) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `treatment_code` varchar(32) NOT NULL,
  /* Bulan selepas rawatan terakhir sebelum pesakit masuk senarai scrubbing. */
  `interval_months` int NOT NULL DEFAULT 6,
  /* Toggle tanpa padam — cabang yang tak buat scrubbing utk rawatan ini. */
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `notes` varchar(256),
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by` varchar(36),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `updated_by` varchar(36),
  `deleted_at` datetime(6),
  CONSTRAINT `scrubbing_rules_id` PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

/* NB: collation mesti selaras dengan branches (utf8mb4_unicode_ci);
 * charset kosong pada aplikasi pertama menyebabkan FK gagal
 * (3780 incompatible) — bentuk akhir yang terbukti jalan. */

ALTER TABLE `scrubbing_rules`
  ADD CONSTRAINT `scrubbing_rules_branch_fk`
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE;
--> statement-breakpoint

/* Satu baris sahaja per (cabang, rawatan) yang hidup — virtual guard. */
ALTER TABLE `scrubbing_rules`
  ADD COLUMN `uq_guard` tinyint GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END
  ) VIRTUAL;
--> statement-breakpoint

ALTER TABLE `scrubbing_rules`
  ADD UNIQUE KEY `scrubbing_rules_branch_treatment_uq` (`branch_id`, `treatment_code`, `uq_guard`);
--> statement-breakpoint

CREATE INDEX `scrubbing_rules_branch_idx` ON `scrubbing_rules` (`branch_id`, `enabled`, `deleted_at`);
