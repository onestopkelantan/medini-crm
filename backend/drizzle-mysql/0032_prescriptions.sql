-- ============================================================================
-- 0032 — prescriptions table (skema Drizzle #24 sudah ada, kini dibuat nyata)
--
-- Drizzle schema.ts section 24 sudah menetapkan bentuk ini; migrasi ini hanya
-- mewujudkannya di MySQL (CREATE, tanpa data). Bentuk: SATU BARIS = satu ubat
-- dalam resep (medication + dosage + frequency + durationDays), melekat pada
-- encounter/pasien/dokter. Sederhana, sesuai kebutuhan klinik gigi Medini:
-- resep pasca-cabut/abstesi biasanya 1-2 ubat.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `prescriptions` (
  `id`            varchar(36)  NOT NULL,
  `org_id`        varchar(36)  NOT NULL,
  `branch_id`     varchar(36)  NOT NULL,
  `patient_id`    varchar(36)  NOT NULL,
  `encounter_id`  varchar(36)  DEFAULT NULL,
  `doctor_id`     varchar(36)  NOT NULL,
  `medication`    varchar(256) NOT NULL,
  `dosage`        varchar(128) DEFAULT NULL,
  `frequency`     varchar(128) DEFAULT NULL,
  `duration_days` int          DEFAULT NULL,
  `notes`         varchar(512) DEFAULT NULL,
  `created_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`    varchar(36)  DEFAULT NULL,
  `updated_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `updated_by`    varchar(36)  DEFAULT NULL,
  `deleted_at`    datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `prescriptions_patient_idx` (`patient_id`),
  KEY `prescriptions_branch_idx` (`branch_id`),
  KEY `prescriptions_doctor_idx` (`doctor_id`),
  CONSTRAINT `prescriptions_branch_fk` FOREIGN KEY (`branch_id`)
    REFERENCES `branches`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `prescriptions_patient_fk` FOREIGN KEY (`patient_id`)
    REFERENCES `patients`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `prescriptions_doctor_fk` FOREIGN KEY (`doctor_id`)
    REFERENCES `staff`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `prescriptions_encounter_fk` FOREIGN KEY (`encounter_id`)
    REFERENCES `encounters`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `prescriptions_duration_positive` CHECK (`duration_days` IS NULL OR `duration_days` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
