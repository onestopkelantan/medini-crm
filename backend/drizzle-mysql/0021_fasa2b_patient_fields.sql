-- Fasa 2B — empat medan pesakit yang hilang.
--
-- KENAPA SETIAP SATU
-- ------------------
-- 1. `pregnant`  — Klinik gigi mesti tahu sebelum X-ray dan sebelum memberi ubat.
--    Ini BUKAN medan demografi; ia mengubah keputusan klinikal. NULL = tidak
--    ditanya/tidak berkenaan, dan itu mesti berbeza daripada 0 (tidak hamil).
--
-- 2. `patient_source` — Dari mana pesakit ini datang: walk-in, WhatsApp, rujukan,
--    panel. Tanpa ini, perbelanjaan pemasaran tidak boleh dikaitkan dengan pesakit
--    yang benar-benar muncul, jadi tiada cara mengetahui saluran mana berbaloi.
--
-- 3. `next_of_kin_name` + `next_of_kin_phone` — Bukan penjaga (itu `guardian_id`,
--    orang yang boleh memberi kebenaran). Ini orang yang dihubungi KECEMASAN.
--    Tujuan berbeza, jadi medan berbeza: seorang pesakit dewasa yang tinggal sendiri
--    mempunyai waris kecemasan tetapi tiada penjaga.
--
-- 4. `panel_company_id` + `panel_member_no` — Pesakit panel/NGO/majikan. Jadual
--    `panel_companies` sudah ada (3 baris) tetapi tiada cara mengaitkan pesakit
--    dengannya, jadi panel itu tidak boleh digunakan.
--
-- SEMUA NULLABLE adalah SENGAJA. Data pesakit sedia ada tidak boleh diisi dengan nilai
-- karangan, dan jawapan "tidak diketahui" ialah keadaan yang sah.

ALTER TABLE `patients`
  ADD COLUMN `pregnant` TINYINT(1) NULL      COMMENT 'Kehamilan: NULL=tidak ditanya, 1=ya, 0=tidak',
  ADD COLUMN `patient_source` VARCHAR(32) NULL COMMENT 'Saluran: walk_in|whatsapp|referral|walk_by|panel|other',
  ADD COLUMN `next_of_kin_name` VARCHAR(256) NULL COMMENT 'Waris kecemasan — nama (bukan penjaga)',
  ADD COLUMN `next_of_kin_phone` VARCHAR(64) NULL COMMENT 'Waris kecemasan — telefon',
  ADD COLUMN `panel_company_id` VARCHAR(36) NULL COMMENT 'Panel/NGO/majikan yang menanggung kos',
  ADD COLUMN `panel_member_no` VARCHAR(64) NULL COMMENT 'Nombor ahli panel pesakit';

-- Panel menunjuk kepada panel_companies tetapi TIDAK dengan ON DELETE CASCADE:
-- memadam sebuah panel tidak boleh memadam pesakit. RESTRICT memaksa keputusan
-- sedar tentang pesakit mana yang masih di bawah panel itu.
ALTER TABLE `patients`
  ADD CONSTRAINT `patients_panel_company_id_fk`
  FOREIGN KEY (`panel_company_id`) REFERENCES `panel_companies`(`id`) ON DELETE SET NULL;

CREATE INDEX `patients_panel_idx` ON `patients` (`panel_company_id`);

SELECT CONCAT('medan ditambah: ', COUNT(*)) AS hasil
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patients'
  AND COLUMN_NAME IN ('pregnant','patient_source','next_of_kin_name','next_of_kin_phone','panel_company_id','panel_member_no');
