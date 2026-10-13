-- ============================================================================
-- 0022 — AI MANAGER CANONICAL SEED (drift repair)
--
-- WHY
--
-- The approved canonical seed (G4 capability matrix, G5 HIGH-risk AP-3/AP-4,
-- G6 global guardrails GR-1/GR-5, G7 the 8-agent roster) lives in the RETIRED
-- Previous seed was incomplete; this file is the canonical MySQL source.
-- When the project moved to MySQL that seed was never ported — `grep
-- "INSERT INTO ai_agents" backend/drizzle-mysql/` returned nothing — so the
-- governance tables shipped EMPTY and were later populated by hand with a
-- session-invented roster (4 agents, non-canonical keys). The running system
-- therefore satisfied neither the locked roster nor the locked draft-only rule.
--
-- This migration restores the LOCKED state:
--   * roster      : 8 canonical agents, exactly ONE owner domain each
--   * keys        : ai-receptionist, marketing-ai, clinical-ai, booking-ai,
--                   finance-ai, inventory-ai, recall-ai, insights-ai
--   * capabilities: owner-domain READ/DRAFT/EXECUTE; draft_only = TRUE for
--                   marketing-ai, clinical-ai, inventory-ai, insights-ai
--   * guardrails  : GR-1 + GR-5 (global, HARD_BLOCK)
--   * approvals   : AP-3 (marketing-ai) + AP-4 (clinical-ai), HIGH, non-auto
--
-- IDEMPOTENT: renames are key-guarded; inserts use INSERT IGNORE on the natural
-- unique indexes; the guardrail insert is NOT EXISTS-guarded (no unique index).
-- Safe to run on a FRESH database too — it then simply seeds the canonical
-- roster, which is what the missing MySQL port should have done all along.
--
-- ORG: agents are org-global and serve every branch; the canonical seed uses
-- org 00000000-0000-0000-0000-000000000001.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reconcile the session-invented keys onto the canonical keys.
--    UPDATE (not delete+insert) preserves each agent's id, so every existing
--    capability row, approval rule and audit-log entry keeps its FK.
-- ---------------------------------------------------------------------------
UPDATE ai_agents
   SET `key` = 'ai-receptionist',
       name = 'AI Receptionist',
       icon = '🤖',
       description = 'Auto-reply + suggest replies for WhatsApp conversations',
       updated_at = NOW(6)
 WHERE org_id = '00000000-0000-0000-0000-000000000001'
   AND `key` = 'nur-whatsapp-receptionist'
   AND deleted_at IS NULL;
--> statement-breakpoint

UPDATE ai_agents
   SET `key` = 'booking-ai',
       name = 'Booking AI',
       icon = '📅',
       description = 'Appointment booking opportunities + reminders',
       updated_at = NOW(6)
 WHERE org_id = '00000000-0000-0000-0000-000000000001'
   AND `key` = 'booking-manager'
   AND deleted_at IS NULL;
--> statement-breakpoint

UPDATE ai_agents
   SET `key` = 'insights-ai',
       name = 'Insights AI',
       icon = '📊',
       description = 'Read-only analytics insights (draft-only)',
       updated_at = NOW(6)
 WHERE org_id = '00000000-0000-0000-0000-000000000001'
   AND `key` = 'data-analyst'
   AND deleted_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Retire the session-invented agent that has NO canonical equivalent.
--    "Web App Executor" (execute web-app actions) conflicts with LOCKED rule 2
--    (no EXECUTE outside the owner domain) and is not part of the locked roster.
--    Retired until it returns as a proper, approved lock amendment.
-- ---------------------------------------------------------------------------
UPDATE ai_agents
   SET deleted_at = NOW(6), updated_at = NOW(6)
 WHERE org_id = '00000000-0000-0000-0000-000000000001'
   AND `key` = 'web-app-executor'
   AND deleted_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Insert the full canonical roster.
--    Idempotent via the unique index ai_agents_org_key_uq (org_id, key,
--    uq_live_guard): a key that already exists live is ignored.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO ai_agents
  (id, org_id, `key`, name, icon, owner_domain, status, description, created_at, updated_at)
VALUES
  (UUID(),'00000000-0000-0000-0000-000000000001','ai-receptionist','AI Receptionist','🤖','whatsapp','enabled','Auto-reply + suggest replies for WhatsApp conversations',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','marketing-ai','Marketing AI','📣','marketing','enabled','Campaign content generation (draft-only)',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','clinical-ai','Clinical AI','🦷','clinical','enabled','Clinical scribe drafts (draft-only; doctor signs)',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','booking-ai','Booking AI','📅','appointments','enabled','Appointment booking opportunities + reminders',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','finance-ai','Finance AI','💰','finance','enabled','Payment reminder drafts (gated approval)',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','inventory-ai','Inventory AI','📦','operations','enabled','Inventory suggestions (draft-only)',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','recall-ai','Recall AI','🔁','marketing','enabled','Recall detection + outreach drafts',NOW(6),NOW(6)),
  (UUID(),'00000000-0000-0000-0000-000000000001','insights-ai','Insights AI','📊','reports','enabled','Read-only analytics insights (draft-only)',NOW(6),NOW(6));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Canonical capability matrix (approved G4). Owner-domain READ+DRAFT+EXECUTE
--    for every agent; draft_only = TRUE for marketing-ai / clinical-ai /
--    inventory-ai / insights-ai (policy rule 4 then blocks their EXECUTE).
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO ai_capabilities
  (id, org_id, agent_id, domain, capability, draft_only, created_at, updated_at)
SELECT UUID(), a.org_id, a.id, a.owner_domain, c.cap,
       CASE WHEN a.`key` IN ('marketing-ai','clinical-ai','inventory-ai','insights-ai')
            THEN 1 ELSE 0 END,
       NOW(6), NOW(6)
  FROM ai_agents a
  CROSS JOIN (
    SELECT 'READ' AS cap UNION ALL SELECT 'DRAFT' UNION ALL SELECT 'EXECUTE'
  ) c
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.deleted_at IS NULL;
--> statement-breakpoint

-- 4b. Correct draft_only on rows that already existed (INSERT IGNORE does not
--     update them) — e.g. insights-ai reports EXECUTE must become draft_only.
UPDATE ai_capabilities c
  JOIN ai_agents a ON a.id = c.agent_id
   SET c.draft_only = CASE WHEN a.`key` IN ('marketing-ai','clinical-ai','inventory-ai','insights-ai')
                           THEN 1 ELSE 0 END,
       c.updated_at = NOW(6)
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.deleted_at IS NULL
   AND c.domain = a.owner_domain;
--> statement-breakpoint

-- 4c. Remove non-canonical grants: cross-domain capabilities (the locked model
--     grants each agent ONLY its owner domain) and grants of retired agents.
DELETE c FROM ai_capabilities c
  JOIN ai_agents a ON a.id = c.agent_id
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND (a.deleted_at IS NOT NULL OR c.domain <> a.owner_domain);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Global guardrails (approved G6). agent_id NULL = applies to ALL agents.
--    ai_guardrails has NO unique index, so guard with NOT EXISTS; the derived
--    table avoids MySQL's "can't read target table in subquery" restriction.
-- ---------------------------------------------------------------------------
INSERT INTO ai_guardrails (id, org_id, agent_id, rule_key, rule, level, created_at, updated_at)
SELECT UUID(), '00000000-0000-0000-0000-000000000001', NULL, 'GR-1',
       'AI must not provide medical advice or diagnosis', 'HARD_BLOCK', NOW(6), NOW(6)
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM (SELECT org_id, agent_id, rule_key FROM ai_guardrails) g
    WHERE g.org_id = '00000000-0000-0000-0000-000000000001'
      AND g.rule_key = 'GR-1' AND g.agent_id IS NULL
 );
--> statement-breakpoint

INSERT INTO ai_guardrails (id, org_id, agent_id, rule_key, rule, level, created_at, updated_at)
SELECT UUID(), '00000000-0000-0000-0000-000000000001', NULL, 'GR-5',
       'AI must not send PHI to external model prompts', 'HARD_BLOCK', NOW(6), NOW(6)
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM (SELECT org_id, agent_id, rule_key FROM ai_guardrails) g
    WHERE g.org_id = '00000000-0000-0000-0000-000000000001'
      AND g.rule_key = 'GR-5' AND g.agent_id IS NULL
 );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Approval rules (approved G5) — the canonical HIGH-risk pair, human-mandatory.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO ai_approval_rules
  (id, org_id, agent_id, action_key, risk, auto, note, created_at, updated_at)
SELECT UUID(), a.org_id, a.id, 'AP-3', 'HIGH', 0,
       'Campaign send requires human approval', NOW(6), NOW(6)
  FROM ai_agents a
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.`key` = 'marketing-ai' AND a.deleted_at IS NULL;
--> statement-breakpoint

INSERT IGNORE INTO ai_approval_rules
  (id, org_id, agent_id, action_key, risk, auto, note, created_at, updated_at)
SELECT UUID(), a.org_id, a.id, 'AP-4', 'HIGH', 0,
       'Clinical sign-off requires doctor approval', NOW(6), NOW(6)
  FROM ai_agents a
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.`key` = 'clinical-ai' AND a.deleted_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Remove the obsolete runtime rule. `analyst.answer` was created so the Data
--    Analyst could AUTO-execute; insights-ai is DRAFT-ONLY (LOCKED rule 3), so
--    it can no longer EXECUTE and the auto-approval is now contradictory.
--    (`wa.reply_patient`, MEDIUM + auto, is KEPT: it is the runtime action for
--    the enabled receptionist and MEDIUM-output is permitted by LOCKED rule 5.)
-- ---------------------------------------------------------------------------
DELETE FROM ai_approval_rules WHERE action_key = 'analyst.answer';
--> statement-breakpoint
