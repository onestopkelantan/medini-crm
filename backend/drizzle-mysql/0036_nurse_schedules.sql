-- 0036: Jadual Perawat (Nurse Schedule) — permintaan pemilik 10 Okt.
-- Konsep sama seperti doctor_schedules, tetapi untuk staf perawat (role nurse):
-- setiap baris ialah satu slot tarikh + masa untuk seorang perawat di satu cawangan.
-- Unik per (org, cawangan, perawat, tarikh, slot) - sama seperti doctor_schedules.

-- Peranan 'nurse' diperlukan untuk pegawai jadual perawat (sebelum ini hanya
-- hq/branch_manager/branch_admin/doctor/developer).
ALTER TABLE `staff`
  MODIFY `role` ENUM('hq','branch_manager','branch_admin','doctor','nurse','developer')
  NOT NULL;

CREATE TABLE IF NOT EXISTS `nurse_schedules` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `branch_id`     CHAR(36)     NOT NULL,
  `nurse_id`      CHAR(36)     NOT NULL,
  `schedule_date` DATE         NOT NULL,
  `start_time`    TIME         NOT NULL,
  `end_time`      TIME         NOT NULL,
  `notes`         TEXT         NULL,
  `created_at`    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nurse_schedules_org_branch_nurse_slot_uq`
    (`org_id`, `branch_id`, `nurse_id`, `schedule_date`, `start_time`, `end_time`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
