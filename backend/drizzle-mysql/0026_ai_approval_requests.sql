-- ============================================================================
-- 0026 — ai_approval_requests: the QUEUE behind an APPROVAL_REQUIRED verdict
--
-- WHY
--
-- ai_approval_rules DECLARES that an action needs human approval. Nothing
-- recorded the ACTION. When the policy engine returned APPROVAL_REQUIRED, the
-- WhatsApp reply path collapsed it into `agentEnabled = false` and wrote the
-- reason to ai_audit_log — so the request itself disappeared. There was no
-- queue, no approve button, and no record of what a human was ever asked.
--
-- A verdict with no destination is not governance; it is a log line. This table
-- is that destination.
--
-- SEPARATION OF CONCERNS
--   ai_approval_rules    → the POLICY   (this action needs approval)
--   ai_approval_requests → the INSTANCE (this specific action is awaiting it)
--
-- PAYLOAD
--   A SMALL summary of what was proposed (e.g. the drafted reply), never a copy
--   of the owning domain's records — the domain stays the source of truth, and
--   duplicating clinical/financial rows here would create a second version of
--   the truth that drifts.
--
-- PRIVACY
--   `payload` and `decision_note` may contain patient-authored text (the reply
--   the AI drafted). The table is therefore HQ-only at the API and the operator
--   may clear a row. This is the same trade-off the booking_requests record
--   already makes: the raw text IS the point of the screen.
--
-- SCOPING
--   MySQL carries no RLS in this project (org scoping is enforced app-side by
--   DbContextService.runAs); the table follows the same pattern as the other
--   ai_* tables, which likewise have no RLS policies.
--
-- LIFEcycle
--   pending → approved | rejected | cancelled;  decided states are terminal.
--   Enforced in domain/approval-request-lifecycle.ts (pure, unit-tested).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + guarded FK/index creation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `ai_approval_requests` (
  `id` varchar(36) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `agent_id` varchar(36),
  `agent_key` varchar(64) NOT NULL,
  `domain` varchar(32) NOT NULL,
  `action_key` varchar(128) NOT NULL,
  `risk` enum('LOW','MEDIUM','HIGH') NOT NULL,
  `reason` text NOT NULL,
  `payload` json,
  `status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `requested_by` varchar(36),
  `decided_by` varchar(36),
  `decided_at` datetime(6),
  `decision_note` text,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by` varchar(36),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_by` varchar(36),
  CONSTRAINT `ai_approval_requests_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

-- FK to ai_agents: SET NULL, not RESTRICT. An approval request is a historical
-- record — retiring or renaming an agent must never be blocked by it, and the
-- request stays readable through the denormalised `agent_key` either way.
ALTER TABLE `ai_approval_requests`
  ADD CONSTRAINT `ai_approval_requests_agent_id_ai_agents_id_fk`
  FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX `ai_approval_requests_org_status_idx` ON `ai_approval_requests` (`org_id`,`status`,`created_at`);
--> statement-breakpoint

CREATE INDEX `ai_approval_requests_org_created_idx` ON `ai_approval_requests` (`org_id`,`created_at`);
--> statement-breakpoint
