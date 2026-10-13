CREATE TABLE `adverse_events` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`reported_by` varchar(36) NOT NULL,
	`severity` enum('mild','moderate','severe') NOT NULL,
	`description` text NOT NULL,
	`action_taken` text,
	`reported_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	CONSTRAINT `adverse_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_agents` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`icon` varchar(32),
	`owner_domain` varchar(32) NOT NULL,
	`status` enum('registered','enabled','paused','archived') NOT NULL DEFAULT 'registered',
	`description` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `ai_agents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_approval_rules` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`agent_id` varchar(36),
	`action_key` varchar(128) NOT NULL,
	`risk` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`auto` boolean NOT NULL DEFAULT true,
	`note` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `ai_approval_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_approval_rules_agent_action_uq` UNIQUE(`org_id`,`agent_id`,`action_key`)
);
--> statement-breakpoint
CREATE TABLE `ai_audit_log` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`agent_id` varchar(36),
	`actor_id` varchar(36),
	`action` varchar(128) NOT NULL,
	`detail` json,
	`status` varchar(32) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `ai_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_automations` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`agent_id` varchar(36) NOT NULL,
	`trigger_key` varchar(128) NOT NULL,
	`action_key` varchar(128) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `ai_automations_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_automations_agent_trigger_uq` UNIQUE(`org_id`,`agent_id`,`trigger_key`,`action_key`)
);
--> statement-breakpoint
CREATE TABLE `ai_capabilities` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`agent_id` varchar(36) NOT NULL,
	`domain` varchar(32) NOT NULL,
	`capability` enum('READ','DRAFT','EXECUTE') NOT NULL,
	`draft_only` boolean NOT NULL DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `ai_capabilities_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_capabilities_agent_domain_cap_uq` UNIQUE(`org_id`,`agent_id`,`domain`,`capability`)
);
--> statement-breakpoint
CREATE TABLE `ai_guardrails` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`agent_id` varchar(36),
	`rule_key` varchar(64) NOT NULL,
	`rule` text NOT NULL,
	`level` enum('HARD_BLOCK','APPROVAL_REQUIRED') NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `ai_guardrails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_knowledge` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`agent_id` varchar(36) NOT NULL,
	`item` varchar(256) NOT NULL,
	`type` enum('static','dynamic') NOT NULL DEFAULT 'static',
	`source_domain` varchar(32),
	`source_ref` varchar(256),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `ai_knowledge_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`patient_id` varchar(36),
	`patient_name` varchar(256) NOT NULL,
	`doctor_id` varchar(36),
	`treatment_ref` varchar(256),
	`scheduled_date` date NOT NULL,
	`scheduled_time` time NOT NULL,
	`duration_min` int NOT NULL DEFAULT 30,
	`status` enum('booked','confirmed','checked-in','waiting','called','in-progress','completed','cancelled','no-show') NOT NULL DEFAULT 'booked',
	`notes` text,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `appt_org_code_uq` UNIQUE(`org_id`,`code`),
	CONSTRAINT `appt_duration_positive` CHECK(duration_min > 0)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36),
	`actor_id` varchar(36),
	`actor_role` varchar(32) NOT NULL,
	`action` varchar(128) NOT NULL,
	`entity` varchar(128) NOT NULL,
	`entity_id` varchar(128),
	`before` json,
	`after` json,
	`source` enum('api','worker','integration','system') NOT NULL DEFAULT 'api',
	`correlation_id` varchar(128),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_requests` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36),
	`contact_phone` varchar(64) NOT NULL,
	`patient_name` varchar(256),
	`preferred_date` varchar(64),
	`preferred_time` varchar(64),
	`treatment` varchar(256),
	`branch_name` varchar(256),
	`raw_message` text,
	`status` enum('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
	`linked_appointment_id` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `booking_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`code` varchar(64) NOT NULL,
	`short_name` varchar(128) NOT NULL,
	`full_name` varchar(256) NOT NULL,
	`location` varchar(256),
	`type` enum('main','affiliate') NOT NULL DEFAULT 'main',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`whatsapp_session` varchar(128),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_org_code_uq` UNIQUE(`org_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `bukku_sync_records` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(36) NOT NULL,
	`branch_id` varchar(36),
	`sync_status` enum('pending','queued','syncing','synced','error','conflict') NOT NULL DEFAULT 'pending',
	`bukku_id` varchar(128),
	`idempotency_key` varchar(256) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`last_synced_at` datetime(6),
	`sync_error` text,
	`retry_count` int NOT NULL DEFAULT 0,
	`sync_metadata` json,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `bukku_sync_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `bukku_sync_records_org_entity_uq` UNIQUE(`org_id`,`entity_type`,`entity_id`),
	CONSTRAINT `bukku_sync_records_idempotency_uq` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`intent` varchar(512) NOT NULL,
	`audience_definition` json NOT NULL,
	`template_reference` varchar(256),
	`status` enum('draft','pending_approval','approved','cancelled','archived') NOT NULL DEFAULT 'draft',
	`approved_at` datetime(6),
	`approved_by` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `checklists` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`checklist_date` date NOT NULL,
	`shift` varchar(32),
	`title` varchar(256) NOT NULL,
	`items` json NOT NULL,
	`owner_id` varchar(36),
	`status` enum('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
	`completed_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `checklists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clinical_notes` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36) NOT NULL,
	`doctor_id` varchar(36) NOT NULL,
	`soap_subjective` text,
	`soap_objective` text,
	`soap_assessment` text,
	`soap_plan` text,
	`signed_at` datetime(6),
	`signed_by` varchar(36),
	`amends_note_id` varchar(36),
	`superseded_by_note_id` varchar(36),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	CONSTRAINT `clinical_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `clinical_notes_signed_complete` CHECK(signed_at IS NULL OR signed_by IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `clinical_timeline_events` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`type` varchar(64) NOT NULL,
	`summary` varchar(512) NOT NULL,
	`payload` json,
	`actor_id` varchar(36),
	`actor_role` varchar(32),
	`correlation_id` varchar(128),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `clinical_timeline_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `commission_ledger` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`doctor_id` varchar(36) NOT NULL,
	`commission_code` varchar(32) NOT NULL,
	`period` varchar(32) NOT NULL,
	`gross_revenue` decimal(19,4) NOT NULL,
	`eligible_direct_costs` decimal(19,4) NOT NULL DEFAULT '0',
	`commission_base` decimal(19,4) NOT NULL,
	`rate` decimal(5,4) NOT NULL,
	`commission_amount` decimal(19,4) NOT NULL,
	`adjustment` decimal(19,4) NOT NULL DEFAULT '0',
	`net_payable` decimal(19,4) NOT NULL,
	`paid_amount` decimal(19,4) NOT NULL DEFAULT '0',
	`outstanding_amount` decimal(19,4) NOT NULL,
	`status` enum('calculated','pending_review','approved','scheduled','paid','cancelled') NOT NULL DEFAULT 'calculated',
	`external_ref` varchar(128),
	`notes` varchar(512),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `commission_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `commission_ledger_org_code_uq` UNIQUE(`org_id`,`commission_code`)
);
--> statement-breakpoint
CREATE TABLE `commission_payouts` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`commission_ledger_id` varchar(36) NOT NULL,
	`payout_date` date NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`method` varchar(32),
	`external_ref` varchar(128),
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `commission_payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`template_id` varchar(36) NOT NULL,
	`template_version` int NOT NULL,
	`encounter_id` varchar(36),
	`plan_id` varchar(36),
	`method` enum('verbal','written','electronic') NOT NULL,
	`consented_by` varchar(256) NOT NULL,
	`witnessed_by` varchar(36),
	`recorded_by` varchar(36) NOT NULL,
	`consented_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`notes` varchar(1024),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	CONSTRAINT `consent_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consent_templates` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`title` varchar(256) NOT NULL,
	`body` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	CONSTRAINT `consent_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `consent_templates_title_version_uq` UNIQUE(`org_id`,`title`,`version`)
);
--> statement-breakpoint
CREATE TABLE `doctor_holidays` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`holiday_date` date NOT NULL,
	`reason` varchar(255) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `doctor_holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `doctor_holidays_org_branch_date_uq` UNIQUE(`org_id`,`branch_id`,`holiday_date`)
);
--> statement-breakpoint
CREATE TABLE `doctor_schedules` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`doctor_id` varchar(36) NOT NULL,
	`schedule_date` date NOT NULL,
	`start_time` time NOT NULL,
	`end_time` time NOT NULL,
	`notes` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `doctor_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `doctor_schedules_org_branch_doctor_slot_uq` UNIQUE(`org_id`,`branch_id`,`doctor_id`,`schedule_date`,`start_time`,`end_time`)
);
--> statement-breakpoint
CREATE TABLE `doctor_statuses` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`doctor_id` varchar(36) NOT NULL,
	`status` enum('available','busy','break','offline') NOT NULL,
	`effective_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`note` varchar(256),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `doctor_statuses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36),
	`title` varchar(256) NOT NULL,
	`category` varchar(64),
	`file_name` varchar(512) NOT NULL,
	`mime_type` varchar(128) NOT NULL,
	`size_bytes` int NOT NULL,
	`storage_key` text NOT NULL,
	`status` enum('active','archived','deleted') NOT NULL DEFAULT 'active',
	`uploaded_by` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36),
	`event_type` varchar(128) NOT NULL,
	`payload` json NOT NULL,
	`correlation_id` varchar(128),
	`occurred_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`published_at` datetime(6),
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `domain_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`appointment_id` varchar(36),
	`doctor_id` varchar(36) NOT NULL,
	`encounter_code` varchar(32) NOT NULL,
	`status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
	`chief_complaint` varchar(512),
	`allergy_acknowledged_at` datetime(6),
	`started_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`completed_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `encounters_id` PRIMARY KEY(`id`),
	CONSTRAINT `encounters_org_code_uq` UNIQUE(`org_id`,`encounter_code`),
	CONSTRAINT `encounters_completed_requires_ts` CHECK(status <> 'completed' OR completed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`code` varchar(64),
	`description` varchar(256),
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `expense_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`expense_code` varchar(32) NOT NULL,
	`category` varchar(64) NOT NULL,
	`subcategory` varchar(128),
	`payee` varchar(256) NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`expense_date` date NOT NULL,
	`due_date` date,
	`status` enum('draft','pending_approval','approved','paid','rejected','cancelled') NOT NULL DEFAULT 'draft',
	`recurring_id` varchar(36),
	`external_ref` varchar(128),
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`),
	CONSTRAINT `expenses_org_code_uq` UNIQUE(`org_id`,`expense_code`)
);
--> statement-breakpoint
CREATE TABLE `external_invoice_refs` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36),
	`treatment_cost_id` varchar(36),
	`ref_code` varchar(32) NOT NULL,
	`external_invoice_number` varchar(128) NOT NULL,
	`source_system` varchar(32) NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`invoice_date` date NOT NULL,
	`status` varchar(32),
	`external_ref` varchar(128),
	`sync_metadata` json,
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `external_invoice_refs_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_invoice_refs_org_code_uq` UNIQUE(`org_id`,`ref_code`),
	CONSTRAINT `external_invoice_refs_org_external_uq` UNIQUE(`org_id`,`source_system`,`external_invoice_number`)
);
--> statement-breakpoint
CREATE TABLE `finance_alert_rules` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`metric` varchar(64) NOT NULL,
	`comparator` enum('lt','lte','gt','gte','eq') NOT NULL,
	`threshold` decimal(19,4) NOT NULL,
	`severity` enum('critical','high','medium','low','info') NOT NULL,
	`window_days` int,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `finance_alert_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_alerts` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`alert_type` varchar(64) NOT NULL,
	`severity` enum('critical','high','medium','low','info') NOT NULL,
	`status` enum('open','acknowledged','resolved','dismissed') NOT NULL DEFAULT 'open',
	`entity_type` varchar(64),
	`entity_id` varchar(36),
	`title` varchar(256) NOT NULL,
	`message` text NOT NULL,
	`amount` decimal(19,4),
	`due_date` date,
	`acknowledged_at` datetime(6),
	`acknowledged_by` varchar(36),
	`resolved_at` datetime(6),
	`resolved_by` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `finance_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `follow_up_cases` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`appointment_id` varchar(36),
	`encounter_id` varchar(36),
	`assignee_id` varchar(36),
	`due_date` date NOT NULL,
	`status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
	`outcome` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `follow_up_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` varchar(36) NOT NULL,
	`key` varchar(256) NOT NULL,
	`scope` varchar(256) NOT NULL,
	`status` enum('in_progress','completed','failed') NOT NULL DEFAULT 'in_progress',
	`response` json,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`expires_at` datetime(6) NOT NULL,
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_scope_key_uq` UNIQUE(`scope`,`key`)
);
--> statement-breakpoint
CREATE TABLE `imaging_records` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`uploaded_by` varchar(36) NOT NULL,
	`kind` enum('xray','cbct','opg','photo','before_after','consent','document') NOT NULL,
	`title` varchar(256) NOT NULL,
	`file_ref` varchar(512),
	`taken_at` datetime(6),
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `imaging_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` varchar(2048),
	`severity` enum('critical','high','medium','low') NOT NULL,
	`owner_id` varchar(36),
	`status` enum('open','acknowledged','resolved','closed') NOT NULL DEFAULT 'open',
	`resolved_at` datetime(6),
	`closed_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `insurance_companies` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`pic` varchar(256),
	`phone` varchar(64),
	`address` text,
	`status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
	`source` varchar(16) NOT NULL DEFAULT 'custom',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `insurance_companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `insurance_companies_org_code_uq` UNIQUE(`org_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `kpi_definitions` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`kpi_key` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`formula` text NOT NULL,
	`source_domain` varchar(32) NOT NULL,
	`unit` varchar(16) NOT NULL,
	`scope_rules` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` varchar(16) NOT NULL DEFAULT 'published',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `kpi_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `kpi_definitions_org_key_version_uq` UNIQUE(`org_id`,`kpi_key`,`version`)
);
--> statement-breakpoint
CREATE TABLE `lab_cases` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`lab_vendor` varchar(256) NOT NULL,
	`work_description` varchar(512) NOT NULL,
	`due_date` date,
	`status` enum('open','in_progress','ready_for_billing','billing_submitted','completed','cancelled') NOT NULL DEFAULT 'open',
	`billing_submitted_at` datetime(6),
	`billing_submitted_by` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `lab_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lab_payables` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`treatment_cost_id` varchar(36),
	`lab_code` varchar(32) NOT NULL,
	`lab_name` varchar(256) NOT NULL,
	`case_ref` varchar(128),
	`external_invoice_ref` varchar(128),
	`amount` decimal(19,4) NOT NULL,
	`paid_amount` decimal(19,4) NOT NULL DEFAULT '0',
	`outstanding_amount` decimal(19,4) NOT NULL,
	`due_date` date NOT NULL,
	`status` enum('DRAFT','OUTSTANDING','PARTIALLY_PAID','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
	`external_ref` varchar(128),
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `lab_payables_id` PRIMARY KEY(`id`),
	CONSTRAINT `lab_payables_org_code_uq` UNIQUE(`org_id`,`lab_code`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`phone` varchar(64),
	`source` varchar(64) NOT NULL,
	`interested_treatment` varchar(256),
	`status` enum('new','contacted','qualified','converted','lost') NOT NULL DEFAULT 'new',
	`assignee_id` varchar(36),
	`patient_id` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketing_segments` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`filters` json NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `marketing_segments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketing_templates` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`channel` enum('whatsapp','sms','email') NOT NULL,
	`category` varchar(64),
	`subject` varchar(256),
	`body` text NOT NULL,
	`variables` json,
	`status` enum('draft','active','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `marketing_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `org_counters` (
	`org_id` varchar(36) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`counter_value` int NOT NULL DEFAULT 0,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `org_counters_pk` PRIMARY KEY(`org_id`,`prefix`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`registration_no` varchar(64),
	`hq_address` text,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `panel_companies` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`pic` varchar(256),
	`phone` varchar(64),
	`address` text,
	`status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
	`source` varchar(16) NOT NULL DEFAULT 'custom',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `panel_companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `panel_companies_org_code_uq` UNIQUE(`org_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `patient_relationships` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`related_patient_id` varchar(36),
	`related_name` varchar(256),
	`type` varchar(32) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `patient_relationships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patient_timeline_events` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`type` varchar(64) NOT NULL,
	`summary` varchar(512) NOT NULL,
	`payload` json,
	`actor_id` varchar(36),
	`actor_role` varchar(32),
	`source` varchar(32) NOT NULL DEFAULT 'api',
	`correlation_id` varchar(128),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `patient_timeline_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`mrn` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`ic` varchar(64),
	`dob` date,
	`gender` varchar(8),
	`nationality` varchar(128),
	`phone` varchar(64),
	`whatsapp` varchar(64),
	`email` varchar(256),
	`patient_type` varchar(32) DEFAULT 'adult',
	`contact_type` varchar(32) DEFAULT 'own',
	`guardian_id` varchar(36),
	`registration_reason` varchar(128),
	`preferred_contact` varchar(32),
	`last_visit_at` datetime(6),
	`status` enum('Active','VIP','Recall Due','Inactive') NOT NULL DEFAULT 'Active',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `patients_id` PRIMARY KEY(`id`),
	CONSTRAINT `patients_org_mrn_uq` UNIQUE(`org_id`,`mrn`),
	CONSTRAINT `patients_org_ic_uq` UNIQUE(`org_id`,`ic`)
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`kind` varchar(32),
	`details` varchar(256),
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `payment_methods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_status` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`status` enum('PENDING','PAID','OVERDUE') NOT NULL DEFAULT 'PENDING',
	`paid_date` date,
	`updated_by_role` varchar(32),
	`payment_reference` varchar(128),
	`confirmed_by` varchar(36),
	`confirmed_at` datetime(6),
	`external_ref` varchar(128),
	`source_system` varchar(32) DEFAULT 'external',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `payment_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_status_patient_uq` UNIQUE(`patient_id`)
);
--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`doctor_id` varchar(36) NOT NULL,
	`medication` varchar(256) NOT NULL,
	`dosage` varchar(128),
	`frequency` varchar(128),
	`duration_days` int,
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `prescriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `prescriptions_duration_positive` CHECK(duration_days IS NULL OR duration_days > 0)
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36),
	`branch_id` varchar(36),
	`consumer` varchar(128) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`processed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `processed_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `processed_events_consumer_event_uq` UNIQUE(`consumer`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `recall_cases` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`recall_rule_id` varchar(36),
	`due_date` date NOT NULL,
	`status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
	`assignee_id` varchar(36),
	`outcome` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `recall_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recall_rules` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`treatment_code` varchar(64),
	`interval_months` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`effective_from` date NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `recall_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `recall_rules_interval_positive` CHECK(interval_months > 0)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_records` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(36) NOT NULL,
	`bukku_sync_record_id` varchar(36),
	`reconciliation_status` enum('pending','matched','conflict','resolved') NOT NULL DEFAULT 'pending',
	`crm_value` json,
	`bukku_value` json,
	`conflict_fields` json,
	`resolved_at` datetime(6),
	`resolved_by` varchar(36),
	`resolution_notes` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `reconciliation_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recurring_commitments` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`recurring_code` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`category` varchar(64) NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`frequency` varchar(32) NOT NULL,
	`next_due_date` date NOT NULL,
	`status` enum('active','paused','cancelled') NOT NULL DEFAULT 'active',
	`auto_create` boolean NOT NULL DEFAULT false,
	`external_ref` varchar(128),
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `recurring_commitments_id` PRIMARY KEY(`id`),
	CONSTRAINT `recurring_commitments_org_code_uq` UNIQUE(`org_id`,`recurring_code`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`doctor_id` varchar(36) NOT NULL,
	`to_specialty` varchar(128) NOT NULL,
	`to_provider` varchar(256),
	`reason` text NOT NULL,
	`status` enum('pending','sent','acknowledged','completed') NOT NULL DEFAULT 'pending',
	`sent_at` datetime(6),
	`acknowledged_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`staff_id` varchar(36) NOT NULL,
	`token_hash` varchar(128) NOT NULL,
	`expires_at` datetime(6) NOT NULL,
	`revoked_at` datetime(6),
	`rotated_to` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_ip` varchar(45),
	`user_agent` text,
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `report_audit` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`actor_role` varchar(32) NOT NULL,
	`action` varchar(48) NOT NULL,
	`view` varchar(64) NOT NULL,
	`filter` json,
	`correlation_id` varchar(64) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `report_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`staff_id` varchar(36) NOT NULL,
	`role` enum('hq','branch_manager','branch_admin','doctor','developer') NOT NULL,
	`branch_id` varchar(36),
	`effective_from` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`status` enum('ACTIVE','SUPERSEDED') NOT NULL DEFAULT 'ACTIVE',
	`assigned_by` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `role_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sale_records` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36),
	`sale_code` varchar(32) NOT NULL,
	`external_ref` varchar(128),
	`source_system` varchar(32) NOT NULL DEFAULT 'pos',
	`amount` decimal(19,4) NOT NULL,
	`sale_date` date NOT NULL,
	`status` enum('recorded','confirmed','cancelled') NOT NULL DEFAULT 'recorded',
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `sale_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `sale_records_org_code_uq` UNIQUE(`org_id`,`sale_code`)
);
--> statement-breakpoint
CREATE TABLE `secret_refs` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`vault_path` varchar(256) NOT NULL,
	`last_four` varchar(8),
	`status` enum('ABSENT','REGISTERED','ROTATED','REVOKED') NOT NULL DEFAULT 'ABSENT',
	`rotated_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `secret_refs_id` PRIMARY KEY(`id`),
	CONSTRAINT `secret_refs_org_key_uq` UNIQUE(`org_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `settings_definitions` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`value_type` enum('string','number','boolean','json') NOT NULL,
	`description` text,
	`category` varchar(64),
	`default_value` json,
	`allowed_scopes` json NOT NULL,
	`branch_overridable` boolean NOT NULL DEFAULT true,
	`locked` boolean NOT NULL DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	CONSTRAINT `settings_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_definitions_org_key_uq` UNIQUE(`org_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `settings_values` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`scope` enum('system','organization','branch','role','feature') NOT NULL,
	`scope_ref` varchar(128),
	`value` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`updated_by` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `settings_values_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings_versions` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`scope` enum('system','organization','branch','role','feature') NOT NULL,
	`scope_ref` varchar(128),
	`old_value` json,
	`new_value` json,
	`version` int NOT NULL,
	`changed_by` varchar(36),
	`reason` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `settings_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36),
	`name` varchar(256) NOT NULL,
	`username` varchar(128) NOT NULL,
	`email` varchar(256),
	`phone` varchar(64),
	`role` enum('hq','branch_manager','branch_admin','doctor','developer') NOT NULL,
	`status` enum('Active','Suspended','Deactivated','Invited','Pending','Rejected') NOT NULL DEFAULT 'Active',
	`specialization` varchar(256),
	`password_hash` text,
	`doctor_ref` varchar(64),
	`mfa_enabled` boolean NOT NULL DEFAULT false,
	`mfa_secret` text,
	`invite_token` text,
	`invite_expires_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `staff_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_org_username_uq` UNIQUE(`org_id`,`username`),
	CONSTRAINT `staff_non_hq_requires_branch` CHECK(`role` = 'hq' OR branch_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` varchar(1024),
	`priority` enum('urgent','high','normal','low') NOT NULL DEFAULT 'normal',
	`assignee_id` varchar(36),
	`due_date` date,
	`status` enum('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
	`completed_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tooth_records` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36) NOT NULL,
	`doctor_id` varchar(36) NOT NULL,
	`fdi_no` int NOT NULL,
	`condition` enum('healthy','decayed','filled','missing','crowned','root_canal','implant') NOT NULL,
	`surfaces` json,
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `tooth_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `tooth_records_enc_tooth_uq` UNIQUE(`encounter_id`,`fdi_no`)
);
--> statement-breakpoint
CREATE TABLE `treatment_catalog` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`category` varchar(64) NOT NULL,
	`duration_min` int NOT NULL DEFAULT 30,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `treatment_catalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `treatment_catalog_org_code_uq` UNIQUE(`org_id`,`code`),
	CONSTRAINT `treatment_catalog_duration_positive` CHECK(duration_min > 0)
);
--> statement-breakpoint
CREATE TABLE `treatment_costs` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`cost_code` varchar(32) NOT NULL,
	`treatment_id` varchar(36),
	`description` varchar(256) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unit_cost` decimal(19,4) NOT NULL,
	`total_cost` decimal(19,4) NOT NULL,
	`cost_date` date NOT NULL,
	`external_ref` varchar(128),
	`notes` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `treatment_costs_id` PRIMARY KEY(`id`),
	CONSTRAINT `treatment_costs_org_code_uq` UNIQUE(`org_id`,`cost_code`)
);
--> statement-breakpoint
CREATE TABLE `treatment_plan_items` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`treatment_id` varchar(36),
	`description` varchar(256) NOT NULL,
	`tooth_fdi` int,
	`quantity` int NOT NULL DEFAULT 1,
	`status` enum('pending','done') NOT NULL DEFAULT 'pending',
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `treatment_plan_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `treatment_plan_items_qty_positive` CHECK(quantity > 0)
);
--> statement-breakpoint
CREATE TABLE `treatment_plans` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`doctor_id` varchar(36) NOT NULL,
	`plan_code` varchar(32) NOT NULL,
	`title` varchar(256) NOT NULL,
	`status` enum('draft','proposed','accepted','active','completed','cancelled') NOT NULL DEFAULT 'draft',
	`consent_required` boolean NOT NULL DEFAULT false,
	`proposed_at` datetime(6),
	`accepted_at` datetime(6),
	`activated_at` datetime(6),
	`completed_at` datetime(6),
	`cancelled_at` datetime(6),
	`cancel_reason` varchar(512),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `treatment_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `treatment_plans_org_code_uq` UNIQUE(`org_id`,`plan_code`)
);
--> statement-breakpoint
CREATE TABLE `treatment_sessions` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`encounter_id` varchar(36),
	`doctor_id` varchar(36) NOT NULL,
	`session_no` int NOT NULL,
	`performed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`summary` varchar(1024),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	CONSTRAINT `treatment_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `treatment_sessions_plan_no_uq` UNIQUE(`plan_id`,`session_no`)
);
--> statement-breakpoint
CREATE TABLE `wa_assignments` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`conversation_id` varchar(36) NOT NULL,
	`action` enum('assign','unassign','handoff','return_to_ai') NOT NULL,
	`assigned_to` varchar(36),
	`actor_id` varchar(36),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `wa_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_channels` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`phone` varchar(64) NOT NULL,
	`session_name` varchar(128),
	`status` enum('stopped','starting','working','failed','need_qr') NOT NULL DEFAULT 'stopped',
	`health_score` int NOT NULL DEFAULT 0,
	`sent_today_count` int NOT NULL DEFAULT 0,
	`sent_today_date` date,
	`last_sent_at` datetime(6),
	`last_seen_at` datetime(6),
	`auto_paused_at` datetime(6),
	`auto_pause_resumed_at` datetime(6),
	`qr_code` text,
	`qr_expires_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `wa_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_channels_health_range` CHECK(health_score BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE `wa_conversations` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`channel_id` varchar(36) NOT NULL,
	`contact_phone` varchar(64) NOT NULL,
	`patient_id` varchar(36),
	`status` enum('new','open','pending','escalated','resolved','archived') NOT NULL DEFAULT 'new',
	`assigned_to` varchar(36),
	`ai_queue_state` enum('received','buffering','ready','processing','responded','waiting','handoff','closed'),
	`unread_count` int NOT NULL DEFAULT 0,
	`last_message_at` datetime(6),
	`first_response_at` datetime(6),
	`resolved_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `wa_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_conversations_unread_nonneg` CHECK(unread_count >= 0)
);
--> statement-breakpoint
CREATE TABLE `wa_messages` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`channel_id` varchar(36) NOT NULL,
	`conversation_id` varchar(36) NOT NULL,
	`direction` enum('in','out') NOT NULL,
	`sender_type` enum('patient','human','ai','system') NOT NULL,
	`body` text NOT NULL,
	`media_type` varchar(64),
	`status` enum('queued','processing','sent','delivered','read','failed') NOT NULL DEFAULT 'queued',
	`idempotency_key` varchar(256),
	`external_message_id` varchar(256),
	`last_error` text,
	`sent_at` datetime(6),
	`delivered_at` datetime(6),
	`read_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `wa_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_safety_decisions` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`channel_id` varchar(36) NOT NULL,
	`conversation_id` varchar(36),
	`message_id` varchar(36),
	`actor_id` varchar(36),
	`decision` enum('allowed','blocked') NOT NULL,
	`blocked_reason` varchar(64),
	`gates` json NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `wa_safety_decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_templates` (
	`id` varchar(36) NOT NULL,
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`body` text NOT NULL,
	`category` varchar(64),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` varchar(36),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_by` varchar(36),
	`deleted_at` datetime(6),
	CONSTRAINT `wa_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_bot_prompts` (
	`org_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`prompt` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`updated_by` varchar(36) NOT NULL,
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `whatsapp_bot_prompts_pk` PRIMARY KEY(`org_id`,`branch_id`)
);
--> statement-breakpoint
ALTER TABLE `adverse_events` ADD CONSTRAINT `adverse_events_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `adverse_events` ADD CONSTRAINT `adverse_events_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `adverse_events` ADD CONSTRAINT `adverse_events_reported_by_staff_id_fk` FOREIGN KEY (`reported_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_approval_rules` ADD CONSTRAINT `ai_approval_rules_agent_id_ai_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_automations` ADD CONSTRAINT `ai_automations_agent_id_ai_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_capabilities` ADD CONSTRAINT `ai_capabilities_agent_id_ai_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_guardrails` ADD CONSTRAINT `ai_guardrails_agent_id_ai_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_knowledge` ADD CONSTRAINT `ai_knowledge_agent_id_ai_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_requests` ADD CONSTRAINT `booking_requests_linked_appointment_id_appointments_id_fk` FOREIGN KEY (`linked_appointment_id`) REFERENCES `appointments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_approved_by_staff_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklists` ADD CONSTRAINT `checklists_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklists` ADD CONSTRAINT `checklists_owner_id_staff_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clinical_notes` ADD CONSTRAINT `clinical_notes_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clinical_notes` ADD CONSTRAINT `clinical_notes_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clinical_notes` ADD CONSTRAINT `clinical_notes_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clinical_timeline_events` ADD CONSTRAINT `clinical_timeline_events_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_ledger` ADD CONSTRAINT `commission_ledger_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_ledger` ADD CONSTRAINT `commission_ledger_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_payouts` ADD CONSTRAINT `commission_payouts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_payouts` ADD CONSTRAINT `commission_payouts_commission_ledger_id_commission_ledger_id_fk` FOREIGN KEY (`commission_ledger_id`) REFERENCES `commission_ledger`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_template_id_consent_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `consent_templates`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_plan_id_treatment_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `treatment_plans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_witnessed_by_staff_id_fk` FOREIGN KEY (`witnessed_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_recorded_by_staff_id_fk` FOREIGN KEY (`recorded_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctor_schedules` ADD CONSTRAINT `doctor_schedules_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctor_schedules` ADD CONSTRAINT `doctor_schedules_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctor_statuses` ADD CONSTRAINT `doctor_statuses_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctor_statuses` ADD CONSTRAINT `doctor_statuses_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_invoice_refs` ADD CONSTRAINT `external_invoice_refs_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_invoice_refs` ADD CONSTRAINT `external_invoice_refs_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_invoice_refs` ADD CONSTRAINT `external_invoice_refs_treatment_cost_id_treatment_costs_id_fk` FOREIGN KEY (`treatment_cost_id`) REFERENCES `treatment_costs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_alert_rules` ADD CONSTRAINT `finance_alert_rules_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `finance_alerts` ADD CONSTRAINT `finance_alerts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_up_cases` ADD CONSTRAINT `follow_up_cases_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_up_cases` ADD CONSTRAINT `follow_up_cases_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_up_cases` ADD CONSTRAINT `follow_up_cases_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_up_cases` ADD CONSTRAINT `follow_up_cases_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_up_cases` ADD CONSTRAINT `follow_up_cases_assignee_id_staff_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `imaging_records` ADD CONSTRAINT `imaging_records_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `imaging_records` ADD CONSTRAINT `imaging_records_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `imaging_records` ADD CONSTRAINT `imaging_records_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `imaging_records` ADD CONSTRAINT `imaging_records_uploaded_by_staff_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_owner_id_staff_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_cases` ADD CONSTRAINT `lab_cases_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_cases` ADD CONSTRAINT `lab_cases_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_cases` ADD CONSTRAINT `lab_cases_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_cases` ADD CONSTRAINT `lab_cases_billing_submitted_by_staff_id_fk` FOREIGN KEY (`billing_submitted_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_payables` ADD CONSTRAINT `lab_payables_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_payables` ADD CONSTRAINT `lab_payables_treatment_cost_id_treatment_costs_id_fk` FOREIGN KEY (`treatment_cost_id`) REFERENCES `treatment_costs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_assignee_id_staff_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_segments` ADD CONSTRAINT `marketing_segments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_templates` ADD CONSTRAINT `marketing_templates_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `patient_relationships` ADD CONSTRAINT `patient_relationships_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `patient_relationships` ADD CONSTRAINT `patient_relationships_related_patient_id_patients_id_fk` FOREIGN KEY (`related_patient_id`) REFERENCES `patients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `patient_timeline_events` ADD CONSTRAINT `patient_timeline_events_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `patients` ADD CONSTRAINT `patients_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_methods` ADD CONSTRAINT `payment_methods_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_status` ADD CONSTRAINT `payment_status_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_status` ADD CONSTRAINT `payment_status_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD CONSTRAINT `prescriptions_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recall_cases` ADD CONSTRAINT `recall_cases_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recall_cases` ADD CONSTRAINT `recall_cases_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recall_cases` ADD CONSTRAINT `recall_cases_recall_rule_id_recall_rules_id_fk` FOREIGN KEY (`recall_rule_id`) REFERENCES `recall_rules`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recall_cases` ADD CONSTRAINT `recall_cases_assignee_id_staff_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recall_rules` ADD CONSTRAINT `recall_rules_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_records` ADD CONSTRAINT `recon_bukku_sync_fk` FOREIGN KEY (`bukku_sync_record_id`) REFERENCES `bukku_sync_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_commitments` ADD CONSTRAINT `recurring_commitments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referrals` ADD CONSTRAINT `referrals_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referrals` ADD CONSTRAINT `referrals_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referrals` ADD CONSTRAINT `referrals_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referrals` ADD CONSTRAINT `referrals_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_staff_id_staff_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_staff_id_staff_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_records` ADD CONSTRAINT `sale_records_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_records` ADD CONSTRAINT `sale_records_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff` ADD CONSTRAINT `staff_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assignee_id_staff_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tooth_records` ADD CONSTRAINT `tooth_records_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tooth_records` ADD CONSTRAINT `tooth_records_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tooth_records` ADD CONSTRAINT `tooth_records_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tooth_records` ADD CONSTRAINT `tooth_records_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_costs` ADD CONSTRAINT `treatment_costs_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_costs` ADD CONSTRAINT `treatment_costs_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_costs` ADD CONSTRAINT `treatment_costs_plan_id_treatment_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `treatment_plans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_costs` ADD CONSTRAINT `treatment_costs_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_costs` ADD CONSTRAINT `treatment_costs_treatment_id_treatment_catalog_id_fk` FOREIGN KEY (`treatment_id`) REFERENCES `treatment_catalog`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_plan_items` ADD CONSTRAINT `treatment_plan_items_plan_id_treatment_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `treatment_plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_plan_items` ADD CONSTRAINT `treatment_plan_items_treatment_id_treatment_catalog_id_fk` FOREIGN KEY (`treatment_id`) REFERENCES `treatment_catalog`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_plans` ADD CONSTRAINT `treatment_plans_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_plans` ADD CONSTRAINT `treatment_plans_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_plans` ADD CONSTRAINT `treatment_plans_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_plans` ADD CONSTRAINT `treatment_plans_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_sessions` ADD CONSTRAINT `treatment_sessions_plan_id_treatment_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `treatment_plans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_sessions` ADD CONSTRAINT `treatment_sessions_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `treatment_sessions` ADD CONSTRAINT `treatment_sessions_doctor_id_staff_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_assignments` ADD CONSTRAINT `wa_assignments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_assignments` ADD CONSTRAINT `wa_assignments_conversation_id_wa_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `wa_conversations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_assignments` ADD CONSTRAINT `wa_assignments_assigned_to_staff_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_assignments` ADD CONSTRAINT `wa_assignments_actor_id_staff_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_channels` ADD CONSTRAINT `wa_channels_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_channel_id_wa_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `wa_channels`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_assigned_to_staff_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_messages` ADD CONSTRAINT `wa_messages_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_messages` ADD CONSTRAINT `wa_messages_channel_id_wa_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `wa_channels`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_messages` ADD CONSTRAINT `wa_messages_conversation_id_wa_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `wa_conversations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_safety_decisions` ADD CONSTRAINT `wa_safety_decisions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_safety_decisions` ADD CONSTRAINT `wa_safety_decisions_channel_id_wa_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `wa_channels`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_safety_decisions` ADD CONSTRAINT `wa_safety_decisions_conversation_id_wa_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `wa_conversations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_templates` ADD CONSTRAINT `wa_templates_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsapp_bot_prompts` ADD CONSTRAINT `whatsapp_bot_prompts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsapp_bot_prompts` ADD CONSTRAINT `whatsapp_bot_prompts_updated_by_staff_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `staff`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `adverse_events_patient_idx` ON `adverse_events` (`patient_id`);--> statement-breakpoint
CREATE INDEX `ai_agents_domain_idx` ON `ai_agents` (`org_id`,`owner_domain`,`status`);--> statement-breakpoint
CREATE INDEX `ai_audit_log_agent_idx` ON `ai_audit_log` (`org_id`,`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_audit_log_status_idx` ON `ai_audit_log` (`org_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_capabilities_agent_idx` ON `ai_capabilities` (`agent_id`);--> statement-breakpoint
CREATE INDEX `ai_guardrails_agent_idx` ON `ai_guardrails` (`org_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `ai_knowledge_agent_idx` ON `ai_knowledge` (`agent_id`);--> statement-breakpoint
CREATE INDEX `appt_branch_date_idx` ON `appointments` (`branch_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `appt_doctor_date_idx` ON `appointments` (`doctor_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `appt_patient_idx` ON `appointments` (`patient_id`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_branch_idx` ON `audit_log` (`branch_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `branches_org_idx` ON `branches` (`org_id`);--> statement-breakpoint
CREATE INDEX `bukku_sync_records_status_idx` ON `bukku_sync_records` (`sync_status`);--> statement-breakpoint
CREATE INDEX `bukku_sync_records_entity_idx` ON `bukku_sync_records` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `campaigns_branch_status_idx` ON `campaigns` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `checklists_branch_date_idx` ON `checklists` (`branch_id`,`checklist_date`);--> statement-breakpoint
CREATE INDEX `checklists_branch_status_idx` ON `checklists` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `clinical_notes_encounter_idx` ON `clinical_notes` (`encounter_id`);--> statement-breakpoint
CREATE INDEX `clinical_notes_patient_idx` ON `clinical_notes` (`patient_id`);--> statement-breakpoint
CREATE INDEX `clinical_notes_doctor_idx` ON `clinical_notes` (`doctor_id`);--> statement-breakpoint
CREATE INDEX `clinical_timeline_patient_idx` ON `clinical_timeline_events` (`patient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `clinical_timeline_type_idx` ON `clinical_timeline_events` (`type`);--> statement-breakpoint
CREATE INDEX `commission_ledger_branch_idx` ON `commission_ledger` (`branch_id`);--> statement-breakpoint
CREATE INDEX `commission_ledger_doctor_idx` ON `commission_ledger` (`doctor_id`);--> statement-breakpoint
CREATE INDEX `commission_ledger_period_idx` ON `commission_ledger` (`period`);--> statement-breakpoint
CREATE INDEX `commission_ledger_status_idx` ON `commission_ledger` (`status`);--> statement-breakpoint
CREATE INDEX `commission_payouts_branch_idx` ON `commission_payouts` (`branch_id`);--> statement-breakpoint
CREATE INDEX `commission_payouts_ledger_idx` ON `commission_payouts` (`commission_ledger_id`);--> statement-breakpoint
CREATE INDEX `commission_payouts_date_idx` ON `commission_payouts` (`payout_date`);--> statement-breakpoint
CREATE INDEX `consent_records_patient_idx` ON `consent_records` (`patient_id`);--> statement-breakpoint
CREATE INDEX `consent_records_plan_idx` ON `consent_records` (`plan_id`);--> statement-breakpoint
CREATE INDEX `doctor_statuses_branch_idx` ON `doctor_statuses` (`branch_id`);--> statement-breakpoint
CREATE INDEX `doctor_statuses_doctor_effective_idx` ON `doctor_statuses` (`doctor_id`,`effective_at`);--> statement-breakpoint
CREATE INDEX `documents_org_branch_idx` ON `documents` (`org_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `documents_patient_idx` ON `documents` (`patient_id`);--> statement-breakpoint
CREATE INDEX `documents_status_idx` ON `documents` (`status`);--> statement-breakpoint
CREATE INDEX `domain_events_type_idx` ON `domain_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `domain_events_unpublished_idx` ON `domain_events` (`published_at`);--> statement-breakpoint
CREATE INDEX `encounters_patient_idx` ON `encounters` (`patient_id`);--> statement-breakpoint
CREATE INDEX `encounters_branch_idx` ON `encounters` (`branch_id`);--> statement-breakpoint
CREATE INDEX `encounters_doctor_idx` ON `encounters` (`doctor_id`);--> statement-breakpoint
CREATE INDEX `encounters_appt_idx` ON `encounters` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `expense_categories_branch_status_idx` ON `expense_categories` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `expenses_branch_idx` ON `expenses` (`branch_id`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category`);--> statement-breakpoint
CREATE INDEX `expenses_status_idx` ON `expenses` (`status`);--> statement-breakpoint
CREATE INDEX `expenses_due_date_idx` ON `expenses` (`due_date`);--> statement-breakpoint
CREATE INDEX `expenses_recurring_idx` ON `expenses` (`recurring_id`);--> statement-breakpoint
CREATE INDEX `external_invoice_refs_branch_idx` ON `external_invoice_refs` (`branch_id`);--> statement-breakpoint
CREATE INDEX `external_invoice_refs_patient_idx` ON `external_invoice_refs` (`patient_id`);--> statement-breakpoint
CREATE INDEX `external_invoice_refs_treatment_cost_idx` ON `external_invoice_refs` (`treatment_cost_id`);--> statement-breakpoint
CREATE INDEX `external_invoice_refs_external_number_idx` ON `external_invoice_refs` (`external_invoice_number`);--> statement-breakpoint
CREATE INDEX `finance_alert_rules_branch_active_idx` ON `finance_alert_rules` (`branch_id`,`active`);--> statement-breakpoint
CREATE INDEX `finance_alerts_branch_idx` ON `finance_alerts` (`branch_id`);--> statement-breakpoint
CREATE INDEX `finance_alerts_type_idx` ON `finance_alerts` (`alert_type`);--> statement-breakpoint
CREATE INDEX `finance_alerts_severity_idx` ON `finance_alerts` (`severity`);--> statement-breakpoint
CREATE INDEX `finance_alerts_status_idx` ON `finance_alerts` (`status`);--> statement-breakpoint
CREATE INDEX `finance_alerts_entity_idx` ON `finance_alerts` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `follow_up_cases_branch_status_due_idx` ON `follow_up_cases` (`branch_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `follow_up_cases_patient_idx` ON `follow_up_cases` (`patient_id`);--> statement-breakpoint
CREATE INDEX `idempotency_expires_idx` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE INDEX `imaging_records_patient_idx` ON `imaging_records` (`patient_id`);--> statement-breakpoint
CREATE INDEX `imaging_records_branch_idx` ON `imaging_records` (`branch_id`);--> statement-breakpoint
CREATE INDEX `imaging_records_encounter_idx` ON `imaging_records` (`encounter_id`);--> statement-breakpoint
CREATE INDEX `incidents_branch_status_idx` ON `incidents` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `incidents_branch_severity_idx` ON `incidents` (`branch_id`,`severity`);--> statement-breakpoint
CREATE INDEX `insurance_companies_org_status_idx` ON `insurance_companies` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `kpi_definitions_org_idx` ON `kpi_definitions` (`org_id`);--> statement-breakpoint
CREATE INDEX `lab_cases_branch_status_idx` ON `lab_cases` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `lab_cases_patient_idx` ON `lab_cases` (`patient_id`);--> statement-breakpoint
CREATE INDEX `lab_payables_branch_idx` ON `lab_payables` (`branch_id`);--> statement-breakpoint
CREATE INDEX `lab_payables_treatment_cost_idx` ON `lab_payables` (`treatment_cost_id`);--> statement-breakpoint
CREATE INDEX `lab_payables_status_idx` ON `lab_payables` (`status`);--> statement-breakpoint
CREATE INDEX `lab_payables_due_date_idx` ON `lab_payables` (`due_date`);--> statement-breakpoint
CREATE INDEX `leads_branch_status_idx` ON `leads` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `leads_org_source_idx` ON `leads` (`org_id`,`source`);--> statement-breakpoint
CREATE INDEX `marketing_segments_branch_idx` ON `marketing_segments` (`branch_id`);--> statement-breakpoint
CREATE INDEX `marketing_templates_branch_channel_status_idx` ON `marketing_templates` (`branch_id`,`channel`,`status`);--> statement-breakpoint
CREATE INDEX `panel_companies_org_status_idx` ON `panel_companies` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `patient_rel_patient_idx` ON `patient_relationships` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_rel_related_idx` ON `patient_relationships` (`related_patient_id`);--> statement-breakpoint
CREATE INDEX `patient_timeline_patient_idx` ON `patient_timeline_events` (`patient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `patient_timeline_type_idx` ON `patient_timeline_events` (`type`);--> statement-breakpoint
CREATE INDEX `patients_branch_idx` ON `patients` (`branch_id`);--> statement-breakpoint
CREATE INDEX `patients_name_idx` ON `patients` (`name`);--> statement-breakpoint
CREATE INDEX `payment_methods_branch_status_idx` ON `payment_methods` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_status_branch_idx` ON `payment_status` (`branch_id`);--> statement-breakpoint
CREATE INDEX `payment_status_status_idx` ON `payment_status` (`status`);--> statement-breakpoint
CREATE INDEX `prescriptions_patient_idx` ON `prescriptions` (`patient_id`);--> statement-breakpoint
CREATE INDEX `prescriptions_branch_idx` ON `prescriptions` (`branch_id`);--> statement-breakpoint
CREATE INDEX `prescriptions_doctor_idx` ON `prescriptions` (`doctor_id`);--> statement-breakpoint
CREATE INDEX `recall_cases_branch_status_due_idx` ON `recall_cases` (`branch_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `recall_cases_patient_idx` ON `recall_cases` (`patient_id`);--> statement-breakpoint
CREATE INDEX `recall_rules_branch_active_idx` ON `recall_rules` (`branch_id`,`active`);--> statement-breakpoint
CREATE INDEX `reconciliation_records_entity_idx` ON `reconciliation_records` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_records_status_idx` ON `reconciliation_records` (`reconciliation_status`);--> statement-breakpoint
CREATE INDEX `reconciliation_records_sync_idx` ON `reconciliation_records` (`bukku_sync_record_id`);--> statement-breakpoint
CREATE INDEX `recurring_commitments_branch_idx` ON `recurring_commitments` (`branch_id`);--> statement-breakpoint
CREATE INDEX `recurring_commitments_category_idx` ON `recurring_commitments` (`category`);--> statement-breakpoint
CREATE INDEX `recurring_commitments_next_due_idx` ON `recurring_commitments` (`next_due_date`);--> statement-breakpoint
CREATE INDEX `recurring_commitments_status_idx` ON `recurring_commitments` (`status`);--> statement-breakpoint
CREATE INDEX `referrals_patient_idx` ON `referrals` (`patient_id`);--> statement-breakpoint
CREATE INDEX `referrals_branch_idx` ON `referrals` (`branch_id`);--> statement-breakpoint
CREATE INDEX `referrals_doctor_idx` ON `referrals` (`doctor_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_staff_idx` ON `refresh_tokens` (`staff_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_org_idx` ON `refresh_tokens` (`org_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_expires_idx` ON `refresh_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `report_audit_org_created_idx` ON `report_audit` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `report_audit_org_actor_idx` ON `report_audit` (`org_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `role_assign_staff_idx` ON `role_assignments` (`staff_id`,`status`);--> statement-breakpoint
CREATE INDEX `sale_records_branch_idx` ON `sale_records` (`branch_id`);--> statement-breakpoint
CREATE INDEX `sale_records_patient_idx` ON `sale_records` (`patient_id`);--> statement-breakpoint
CREATE INDEX `sale_records_date_idx` ON `sale_records` (`sale_date`);--> statement-breakpoint
CREATE INDEX `sale_records_status_idx` ON `sale_records` (`status`);--> statement-breakpoint
CREATE INDEX `settings_definitions_category_idx` ON `settings_definitions` (`org_id`,`category`);--> statement-breakpoint
CREATE INDEX `settings_values_key_idx` ON `settings_values` (`org_id`,`key`);--> statement-breakpoint
CREATE INDEX `settings_values_scope_idx` ON `settings_values` (`org_id`,`scope`,`scope_ref`);--> statement-breakpoint
CREATE INDEX `settings_versions_key_idx` ON `settings_versions` (`org_id`,`key`,`created_at`);--> statement-breakpoint
CREATE INDEX `settings_versions_scope_idx` ON `settings_versions` (`org_id`,`scope`,`scope_ref`);--> statement-breakpoint
CREATE INDEX `staff_branch_idx` ON `staff` (`branch_id`);--> statement-breakpoint
CREATE INDEX `staff_role_idx` ON `staff` (`role`);--> statement-breakpoint
CREATE INDEX `tasks_branch_status_idx` ON `tasks` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `tasks_due_date_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tooth_records_patient_idx` ON `tooth_records` (`patient_id`,`fdi_no`);--> statement-breakpoint
CREATE INDEX `treatment_catalog_org_cat_idx` ON `treatment_catalog` (`org_id`,`category`);--> statement-breakpoint
CREATE INDEX `treatment_costs_branch_idx` ON `treatment_costs` (`branch_id`);--> statement-breakpoint
CREATE INDEX `treatment_costs_patient_idx` ON `treatment_costs` (`patient_id`);--> statement-breakpoint
CREATE INDEX `treatment_costs_plan_idx` ON `treatment_costs` (`plan_id`);--> statement-breakpoint
CREATE INDEX `treatment_costs_encounter_idx` ON `treatment_costs` (`encounter_id`);--> statement-breakpoint
CREATE INDEX `treatment_costs_treatment_idx` ON `treatment_costs` (`treatment_id`);--> statement-breakpoint
CREATE INDEX `treatment_costs_date_idx` ON `treatment_costs` (`cost_date`);--> statement-breakpoint
CREATE INDEX `treatment_plan_items_plan_idx` ON `treatment_plan_items` (`plan_id`);--> statement-breakpoint
CREATE INDEX `treatment_plan_items_treatment_idx` ON `treatment_plan_items` (`treatment_id`);--> statement-breakpoint
CREATE INDEX `treatment_plans_patient_idx` ON `treatment_plans` (`patient_id`);--> statement-breakpoint
CREATE INDEX `treatment_plans_branch_idx` ON `treatment_plans` (`branch_id`);--> statement-breakpoint
CREATE INDEX `treatment_plans_doctor_idx` ON `treatment_plans` (`doctor_id`);--> statement-breakpoint
CREATE INDEX `treatment_plans_encounter_idx` ON `treatment_plans` (`encounter_id`);--> statement-breakpoint
CREATE INDEX `treatment_sessions_plan_idx` ON `treatment_sessions` (`plan_id`);--> statement-breakpoint
CREATE INDEX `wa_assignments_conv_idx` ON `wa_assignments` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wa_assignments_branch_idx` ON `wa_assignments` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wa_channels_branch_status_idx` ON `wa_channels` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `wa_conversations_branch_status_idx` ON `wa_conversations` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `wa_conversations_assigned_idx` ON `wa_conversations` (`branch_id`,`assigned_to`);--> statement-breakpoint
CREATE INDEX `wa_conversations_patient_idx` ON `wa_conversations` (`patient_id`);--> statement-breakpoint
CREATE INDEX `wa_messages_conv_created_idx` ON `wa_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wa_messages_branch_status_idx` ON `wa_messages` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `wa_safety_decisions_branch_idx` ON `wa_safety_decisions` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wa_safety_decisions_channel_idx` ON `wa_safety_decisions` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wa_safety_decisions_conv_idx` ON `wa_safety_decisions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `wa_templates_branch_active_idx` ON `wa_templates` (`branch_id`,`active`);