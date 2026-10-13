-- ============================================================================
-- 0027 — waitlist_entries + appointment_reminders (FASA E, item 13–14 KAJIAN)
--
-- WAITLIST — WHY
--
-- KAJIAN-DENTAL-ERP-RUJUKAN §4.2: "pesakit tak dapat slot → masuk senarai
-- menunggu → Booking AI tawarkan bila slot terbuka. Kita tiada tabel ini —
-- tambah." Medini boleh menulis rekod sekarang; tawaran automatik bila slot
-- terbuka menyusul (needs a live WhatsApp number — A4 blocked — and a
-- spam-guard design), tapi SKEMA tidak boleh menunggu nombor: baris hari ini
-- mesti terbaca oleh cron esok tanpa migrasi kedua.
--
-- BENTUK MENGIKUT RUJUKAN (dental-erp model Waitlist), dengan nama Medini:
--   patient_id        WAJIB — rujukan hanya menerima pesakit berdaftar; FK
--                     SET NULL mengikut preseden treatment_costs.doctor_id
--                     (sejarah tidak menghalang penamatan).
--   doctor_id         pilihan — "prefer doctor yang sama".
--   preferred_days    JSON array nama hari English atas — ["MONDAY","WEDNESDAY"]
--                     — bentuk yang sama rujukan hantar; cron match mudah:
--                     WHERE JSON_CONTAINS(preferred_days, '"MONDAY"').
--   preferred_time    slot umum — 'morning' | 'afternoon' | 'evening'.
--                     BUKAN jam: senarai tunggu ialah KEINGINAN, bukan tempahan;
--                     jam sebenar datang daripada slot yang terbuka.
--   notes             teks bebas ( Konteks: "nak petang selepas kerja 5pm" ).
--   status            active → notified → booked | cancelled | expired.
--                     notified_at / booked_at menangkap BILA setiap peringkat.
--                     Lifecycle domain (pure) menyusul dalam E2; DB cuma simpan.
--
-- REMINDERS — WHY (model AppointmentReminder rujukan, melekat ke appointment)
--
-- Medini TIADA sistem reminder appointment langsung. Queue BullMQ
-- ('notifications') sedia, tiada apa-apa mengisi jadualnya. Tabel ini ialah
-- DESTINASI jadual itu: satu baris = satu peringatan TERJADUAL untuk satu
-- temujanji ( reminder pagi-sama / 24-jam / berikutnya risiko-tinggi ),
-- sent_at + status mengesahkan penghantaran. Skema dibina SEKARANG supaya
-- penghantar (E6, selepas nombor WA aktif) menulis tanpa migrasi.
--
-- SCOPING — sama seperti 0026: tiada RLS dalam projek ini (org scoping
-- dikuatkuasakan app-side); kedua-dua tabel ikut pola org_id wajib.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS; FK/index tidak di-guard kerana
-- runner hanya melaksanakan sekali (medini_schema_migrations), konsisten
-- dengan 0024/0025/0026.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `waitlist_entries` (
  `id` varchar(36) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `patient_id` varchar(36),
  `doctor_id` varchar(36),
  `preferred_days` json,
  `preferred_time` enum('morning','afternoon','evening'),
  `notes` varchar(512),
  `status` enum('active','notified','booked','cancelled','expired') NOT NULL DEFAULT 'active',
  `notified_at` datetime(6),
  `booked_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by` varchar(36),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by` varchar(36),
  `deleted_at` datetime(6),
  CONSTRAINT `waitlist_entries_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

-- FK SET NULL (preseden treatment_costs.doctor_id): entri sejarah kekal
-- boleh dibaca walaupun pesakit/doktor dihapus; snapshot nama dijamin oleh
-- JOIN pada waktu baca, bukan salinan yang lapuk.
ALTER TABLE `waitlist_entries`
  ADD CONSTRAINT `waitlist_entries_patient_id_patients_id_fk`
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE `waitlist_entries`
  ADD CONSTRAINT `waitlist_entries_doctor_id_staff_id_fk`
  FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE `waitlist_entries`
  ADD CONSTRAINT `waitlist_entries_branch_id_branches_id_fk`
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- Carian utama cron: "entri aktif, cawangan ini, hari ini hari apa".
CREATE INDEX `waitlist_entries_org_status_idx` ON `waitlist_entries` (`org_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `waitlist_entries_branch_status_idx` ON `waitlist_entries` (`branch_id`,`status`);
--> statement-breakpoint

-- ============================================================================
-- appointment_reminders — satu baris per peringatan TERJADUAL.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `appointment_reminders` (
  `id` varchar(36) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `appointment_id` varchar(36) NOT NULL,
  -- reminder_type: 'same_morning' = pagi hari sama; 'day_before' = 24 jam
  -- awal; 'high_risk_extra' = lapisan tambahan untuk pesakit risiko tinggi
  -- (skor no-show E4) — TIGA nilai dulu, enum boleh dilanjutkan kemudian.
  `reminder_type` enum('same_morning','day_before','high_risk_extra') NOT NULL,
  `scheduled_for` datetime(6) NOT NULL,
  `sent_at` datetime(6),
  `status` enum('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by` varchar(36),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by` varchar(36),
  `deleted_at` datetime(6),
  CONSTRAINT `appointment_reminders_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

-- CASCADE: peringatan tanpa temujanjinya tiada makna; padam temujanji =
-- padam jadual peringatannya. Berbeza dengan waitlist (SET NULL) kerana
-- reminder BUKAN rekod sejarah — ia kerja masa depan milik appointment itu.
ALTER TABLE `appointment_reminders`
  ADD CONSTRAINT `appointment_reminders_appointment_id_appointments_id_fk`
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- Cron scan: "apa yang perlu dihantar sekarang" — status pending, ikut masa.
CREATE INDEX `appointment_reminders_due_idx` ON `appointment_reminders` (`status`,`scheduled_for`);
--> statement-breakpoint
CREATE INDEX `appointment_reminders_appointment_idx` ON `appointment_reminders` (`appointment_id`);
--> statement-breakpoint
