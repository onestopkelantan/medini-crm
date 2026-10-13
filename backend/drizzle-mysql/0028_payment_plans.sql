-- ============================================================================
-- 0028 — payment_plans + payment_plan_schedules (P4 — the missing financial heart)
--
-- WHY
--
-- Medini records money as it ARRIVES (sale_records from the POS/Bukku, one
-- full payment at a time) and has no concept of money OWED. Nothing can say
-- "braces RM3,500: RM500 down, six monthly instalments, two paid, one
-- overdue" — which is how dental treatment is actually paid for. KAJIAN
-- calls this "the missing financial heart"; the aging buckets in
-- finance/domain/aging.ts have existed since Sprint 4 with nothing to
-- bucket. This migration is the data model that fills them.
--
-- SHAPE FOLLOWS THE REFERENCE (dental-erp models PaymentPlan/PaymentPlanSchedule):
--   total_amount, down_payment, installments, frequency, start_date,
--   next_due_date + one schedule row per instalment (installment_no, amount,
--   due_date, paid_date, paid_amount, status PENDING/PAID/OVERDUE/WAIVED).
--
-- ONE DELIBERATE DIFFERENCE — THE PARENT IS treatment_plans, NOT an invoice:
-- the reference hangs plans off invoices because it has an invoicing engine.
-- Medini does not — its "invoice" is a POS record of money already received,
-- and instalments on a receipt is a contradiction. What a dental clinic
-- actually sells in instalments is the TREATMENT PACKAGE (braces, dentures),
-- which is exactly what treatment_plans is (draft → accepted → active). A
-- plan that reaches "accepted" becomes payable; a payment plan attaches
-- there.
--
-- MONEY RULES (enforced app-side, MySQL has no CHECK in this project):
--   down_payment >= 0, instalments >= 1, and
--   down_payment + SUM(schedule.amount) = total_amount — the schedule is
--   GENERATED so this holds by construction, never trusted from input.
--
-- SCOPING — same as every money table here: org_id NOT NULL, no RLS (the
-- project pattern; DbContextService.runAs enforces scope app-side).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS; runner executes once (journal:
-- medini_schema_migrations).
-- ============================================================================

CREATE TABLE IF NOT EXISTS `payment_plans` (
  `id` varchar(36) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  /* Nullable because the FKs are ON DELETE SET NULL (MySQL requires it):
   * a payment history must survive its patient's or package's deletion. */
  `patient_id` varchar(36) NULL,
  `treatment_plan_id` varchar(36) NULL,
  -- Snapshot of the package title at plan creation: the printed schedule must
  -- stay readable even if the treatment plan is later renamed or deleted.
  `plan_title_snapshot` varchar(256) NOT NULL,
  `total_amount` decimal(19,4) NOT NULL,
  `down_payment` decimal(19,4) NOT NULL DEFAULT 0,
  `installments` int NOT NULL,
  `frequency` enum('weekly','biweekly','monthly') NOT NULL DEFAULT 'monthly',
  `status` enum('active','completed','defaulted','cancelled') NOT NULL DEFAULT 'active',
  `start_date` date NOT NULL,
  -- First UNPAID due date, denormalised for "who do I chase today" queries.
  -- Maintained by the service on every payment; NULL when nothing is due.
  `next_due_date` date,
  `notes` varchar(512),
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by` varchar(36),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by` varchar(36),
  `deleted_at` datetime(6),
  CONSTRAINT `payment_plans_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

-- FK patient: CASCADE would erase a patient's payment history the moment the
-- patient row is deleted; SET NULL keeps the schedule as an unlinked record.
-- (Same precedent as waitlist_entries / treatment_costs.)
ALTER TABLE `payment_plans`
  ADD CONSTRAINT `payment_plans_patient_id_patients_id_fk`
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- FK treatment_plan: SET NULL — the payment record OUTLIVES its package.
-- plan_title_snapshot keeps it readable after the link rots.
ALTER TABLE `payment_plans`
  ADD CONSTRAINT `payment_plans_treatment_plan_id_treatment_plans_id_fk`
  FOREIGN KEY (`treatment_plan_id`) REFERENCES `treatment_plans`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE `payment_plans`
  ADD CONSTRAINT `payment_plans_branch_id_branches_id_fk`
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- The counter's list: "active plans, oldest due first" per patient.
CREATE INDEX `payment_plans_patient_status_idx` ON `payment_plans` (`patient_id`,`status`);
--> statement-breakpoint
CREATE INDEX `payment_plans_org_status_idx` ON `payment_plans` (`org_id`,`status`);
--> statement-breakpoint
CREATE INDEX `payment_plans_next_due_idx` ON `payment_plans` (`next_due_date`);
--> statement-breakpoint

-- ============================================================================
-- payment_plan_schedules — one row per instalment. The plan is the promise;
-- the schedule is the ledger of that promise being kept (or not).
-- ============================================================================

CREATE TABLE IF NOT EXISTS `payment_plan_schedules` (
  `id` varchar(36) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `payment_plan_id` varchar(36) NOT NULL,
  `installment_no` int NOT NULL,
  `amount` decimal(19,4) NOT NULL,
  `due_date` date NOT NULL,
  `paid_date` datetime(6),
  `paid_amount` decimal(19,4),
  `status` enum('pending','paid','overdue','waived') NOT NULL DEFAULT 'pending',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by` varchar(36),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by` varchar(36),
  `deleted_at` datetime(6),
  CONSTRAINT `payment_plan_schedules_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

-- CASCADE: an instalment is meaningless without its plan — unlike the plan
-- itself, which survives its package. Deleting a plan deletes its schedule.
ALTER TABLE `payment_plan_schedules`
  ADD CONSTRAINT `payment_plan_schedules_plan_id_payment_plans_id_fk`
  FOREIGN KEY (`payment_plan_id`) REFERENCES `payment_plans`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- One row per instalment number per plan — the schedule is a numbered list,
-- and two instalment #3s would double-charge or double-forgive.
CREATE UNIQUE INDEX `payment_plan_schedules_no_uq` ON `payment_plan_schedules` (`payment_plan_id`,`installment_no`);
--> statement-breakpoint

-- The chaser's query: everything unpaid, most overdue first.
CREATE INDEX `payment_plan_schedules_due_idx` ON `payment_plan_schedules` (`status`,`due_date`);
--> statement-breakpoint
