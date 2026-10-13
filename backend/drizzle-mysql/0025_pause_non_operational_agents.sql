-- ============================================================================
-- 0025 — Pause the three non-operational AI agents
--
-- WHY
--
-- The locked roster (0022) seeds EIGHT agents, all `enabled`. This clinic runs
-- with FIVE: ai-receptionist, booking-ai, finance-ai, insights-ai, clinical-ai
-- (operator decision, 5 Oct 2026). The remaining three are NOT retired — they
-- stay in the roster, so the drift guard (test/contract/ai-governance.contract)
-- stays green — they are PAUSED:
--
--   * marketing-ai  — its domain UI was removed from the product
--   * inventory-ai  — stock/inventory is deliberately out of scope
--   * recall-ai     — dormant: no code path calls it, and it is not draft-only,
--                     so while enabled it held an ungated EXECUTE capability
--
-- WHY A MIGRATION AND NOT A BUTTON
--
-- 0022 seeds every agent `enabled` using INSERT IGNORE. On a FRESH database (or
-- any re-run of the bootstrap) a pause applied through the UI would simply be
-- undone — the tables would come up with eight enabled agents again. The pause
-- must live in the migration set so a cold start reproduces the intended
-- operational state. This is the same reasoning that put the roster itself in
-- a migration rather than trusting an operator to click it in.
--
-- REVERSIBLE, NOT A LOCK
--
-- A paused agent is enabled again from AI Manager → Agents; the lifecycle
-- transitions enabled <-> paused are legal by design (canTransitionAiAgent).
-- Re-enabling is an operational act and does NOT require touching this file.
-- Nothing is deleted — every id, capability row, approval rule and audit entry
-- is preserved.
--
-- POLICY EFFECT
--
-- A paused agent evaluates BLOCKED at step 2 of the policy engine
-- ("agent is paused (not enabled)") for every capability, so it cannot act.
--
-- IDEMPOTENT: assigning a fixed status is naturally idempotent.
-- ============================================================================

UPDATE ai_agents
   SET status = 'paused', updated_at = NOW(6)
 WHERE org_id = '00000000-0000-0000-0000-000000000001'
   AND `key` IN ('marketing-ai', 'inventory-ai', 'recall-ai')
   AND deleted_at IS NULL;
--> statement-breakpoint
