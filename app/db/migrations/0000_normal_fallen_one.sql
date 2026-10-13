CREATE TABLE `ai_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer,
	`agent` text NOT NULL,
	`action` text(120) NOT NULL,
	`conversation_id` integer,
	`detail` text,
	`confidence` real,
	`escalated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `wa_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_branch` ON `ai_logs` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent` text NOT NULL,
	`name` text(120) NOT NULL,
	`prompt` text NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`doctor_id` integer NOT NULL,
	`chair_id` integer,
	`treatment_id` integer,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text(500),
	`created_by_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`doctor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chair_id`) REFERENCES `chairs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`treatment_id`) REFERENCES `treatments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_appt_branch_start` ON `appointments` (`branch_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_appt_doctor_start` ON `appointments` (`doctor_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_appt_patient` ON `appointments` (`patient_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`branch_id` integer,
	`module` text(60) NOT NULL,
	`action` text(60) NOT NULL,
	`entity` text(60),
	`entity_id` text(40),
	`detail` text(500),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_branch` ON `audit_logs` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text(20) NOT NULL,
	`name` text(120) NOT NULL,
	`city` text(80) NOT NULL,
	`phone` text(30),
	`address` text(255),
	`whatsapp_session` text(60),
	`whatsapp_connected` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_code_unique` ON `branches` (`code`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer,
	`name` text(160) NOT NULL,
	`type` text NOT NULL,
	`segment` text(120),
	`message` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`delivered_count` integer DEFAULT 0 NOT NULL,
	`responded_count` integer DEFAULT 0 NOT NULL,
	`scheduled_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`name` text(60) NOT NULL,
	`room` text(60),
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clinical_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`appointment_id` integer,
	`doctor_id` integer NOT NULL,
	`diagnosis` text(255),
	`notes` text,
	`procedures` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`doctor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notes_patient` ON `clinical_notes` (`patient_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text(160) NOT NULL,
	`file_url` text(500),
	`uploaded_by_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_docs_patient` ON `documents` (`patient_id`);--> statement-breakpoint
CREATE TABLE `incident_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`title` text(200) NOT NULL,
	`severity` text DEFAULT 'low' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`detail` text,
	`reported_by_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `insurance_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`invoice_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`panel_id` integer,
	`claim_no` text(40),
	`amount` real NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`panel_id`) REFERENCES `insurance_panels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `insurance_panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text(120) NOT NULL,
	`contact_email` text(160),
	`contact_phone` text(30),
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`treatment_id` integer,
	`description` text(200) NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`total` real NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`treatment_id`) REFERENCES `treatments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`number` text(30) NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`subtotal` real NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`insurance_amount` real DEFAULT 0 NOT NULL,
	`notes` text(255),
	`issued_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`due_at` integer,
	`created_by_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE INDEX `idx_inv_branch` ON `invoices` (`branch_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `idx_inv_patient` ON `invoices` (`patient_id`);--> statement-breakpoint
CREATE TABLE `knowledge_base` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text(60) NOT NULL,
	`question` text(255) NOT NULL,
	`answer` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`mrn` text(20) NOT NULL,
	`name` text(120) NOT NULL,
	`phone` text(30) NOT NULL,
	`email` text(160),
	`ic_number` text(20),
	`dob` text(10),
	`gender` text,
	`address` text(255),
	`allergies` text(255),
	`medical_notes` text,
	`insurance_panel_id` integer,
	`insurance_policy_no` text(60),
	`source` text DEFAULT 'walkin' NOT NULL,
	`loyalty_points` integer DEFAULT 0 NOT NULL,
	`last_visit_at` integer,
	`next_recall_at` integer,
	`created_by_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insurance_panel_id`) REFERENCES `insurance_panels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_mrn_unique` ON `patients` (`mrn`);--> statement-breakpoint
CREATE INDEX `idx_patients_branch` ON `patients` (`branch_id`);--> statement-breakpoint
CREATE INDEX `idx_patients_phone` ON `patients` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_patients_recall` ON `patients` (`next_recall_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`invoice_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`amount` real NOT NULL,
	`method` text NOT NULL,
	`kind` text DEFAULT 'full' NOT NULL,
	`reference` text(80),
	`received_by_id` integer,
	`paid_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pay_branch` ON `payments` (`branch_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_pay_invoice` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`doctor_id` integer NOT NULL,
	`appointment_id` integer,
	`medication` text(160) NOT NULL,
	`dosage` text(80),
	`frequency` text(80),
	`duration_days` integer,
	`notes` text(255),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`doctor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text(80) NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_key_unique` ON `settings` (`key`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`title` text(200) NOT NULL,
	`assignee_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`due_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `treatment_plan_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` integer NOT NULL,
	`treatment_id` integer,
	`description` text(200) NOT NULL,
	`tooth_no` text(10),
	`qty` integer DEFAULT 1 NOT NULL,
	`price` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `treatment_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`treatment_id`) REFERENCES `treatments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `treatment_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`doctor_id` integer NOT NULL,
	`title` text(160) NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`doctor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `treatments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text(20) NOT NULL,
	`name` text(120) NOT NULL,
	`category` text(60) NOT NULL,
	`price` real NOT NULL,
	`duration_min` integer DEFAULT 30 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `treatments_code_unique` ON `treatments` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer,
	`role` text NOT NULL,
	`name` text(120) NOT NULL,
	`username` text(60) NOT NULL,
	`email` text(160),
	`phone` text(30),
	`password_hash` text(255) NOT NULL,
	`specialization` text(120),
	`title` text(60),
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_branch` ON `users` (`branch_id`);--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);--> statement-breakpoint
CREATE TABLE `wa_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`patient_id` integer,
	`phone` text(30) NOT NULL,
	`contact_name` text(120) NOT NULL,
	`status` text DEFAULT 'ai_handled' NOT NULL,
	`ai_agent` text(40) DEFAULT 'receptionist' NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_wa_branch` ON `wa_conversations` (`branch_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `wa_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`direction` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'delivered' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `wa_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_msg_conv` ON `wa_messages` (`conversation_id`,`created_at`);