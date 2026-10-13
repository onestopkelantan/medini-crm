-- P2 — treatment_costs.doctor_id: SIAPA yang melakukan kerja itu.
--
-- KENAPA
-- -----
-- Sebelum ini, doktor bagi satu kos rawatan hanya boleh DITERBITKAN melalui
-- `treatment_costs.plan_id -> treatment_plans.doctor_id`. Itu masalah: `doctor_id`
-- pada pelan boleh BERUBAH. Jika sebuah pelan ditugaskan semula kepada doktor
-- lain, JOIN akan mengubah atribusi sejarah secara RETROAKTIF — komisen yang
-- sudah dikira dan dibayar boleh bertukar pemilik tanpa sesiapa mengubahnya.
--
-- Lajur ini mencatat FAKTA PADA MASA ITU — prinsip yang sama seperti
-- `patient_allergies` ("an allergy is a FACT ABOUT A MOMENT, never edit-in-place").
-- Baris kos lama kekal milik doktor yang benar-benar melakukannya.
--
-- NULLABLE adalah SENGAJA: kos tanpa doktor yang boleh dikenal pasti (pelan
-- dipadam, caj walk-in masa depan) mesti boleh menyatakan "tidak dapat
-- dikaitkan" — bukan mengarang doktor.
--
-- FK ON DELETE SET NULL (bukan RESTRICT): atribusi sejarah tidak boleh menghalang
-- penamatan seorang doktor. Menyahaktifkan staf menetapkan doktor kepada NULL,
-- bukan menghalang operasi. Ini mengikut preseden `patients.panel_company_id`
-- dalam migrasi 0021.
ALTER TABLE `treatment_costs`
  ADD COLUMN `doctor_id` CHAR(36) NULL COMMENT 'staff.id doktor yang melakukan kerja (P2)';

ALTER TABLE `treatment_costs`
  ADD CONSTRAINT `treatment_costs_doctor_id_fk`
  FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE SET NULL;

CREATE INDEX `treatment_costs_doctor_idx` ON `treatment_costs` (`doctor_id`);

-- BACKFILL: setiap baris sedia ada mendapat doktor daripada pelannya.
-- `plan_id` adalah NOT NULL, jadi unjuran ini sepatutnya meliputi 100% baris.
-- Baris yang tetap NULL = pelan hilang; itu dilaporkan, bukan direka.
UPDATE `treatment_costs` tc
  JOIN `treatment_plans` tp ON tp.`id` = tc.`plan_id`
  SET tc.`doctor_id` = tp.`doctor_id`
  WHERE tc.`doctor_id` IS NULL;

-- Pengesahan: berapa baris masih tanpa doktor selepas backfill.
SELECT CONCAT('null_doctor=', SUM(doctor_id IS NULL)) AS hasil, COUNT(*) AS total
FROM `treatment_costs`;
