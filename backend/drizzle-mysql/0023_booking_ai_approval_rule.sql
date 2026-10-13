-- ============================================================================
-- 0023 — booking-ai: classify `booking.create` as an auto-MEDIUM action
--
-- WHY
--
-- The reply pipeline was policy-gated, but booking creation ran inside it with
-- no check on the `booking-ai` agent. Gating it now means the policy engine
-- evaluates EXECUTE for `booking-ai` — and the engine FAILS CLOSED on an
-- unclassified EXECUTE with no approval rule ("unclassified EXECUTE requires
-- human review"). Without this rule every automatic booking would be held.
--
-- The rule mirrors `wa.reply_patient`: it classifies the action; the real
-- safeguards (slot validation, duplicate check, operating hours, doctor shift)
-- run downstream in maybeSaveBooking exactly as before.
--
-- RISK: MEDIUM — the booking is created autonomously for a patient who asked
-- for it, is reversible by staff, and carries no clinical judgement.
--
-- IDEMPOTENT: INSERT IGNORE on the unique index (org_id, agent_id, action_key).
-- ============================================================================

INSERT IGNORE INTO ai_approval_rules
  (id, org_id, agent_id, action_key, risk, auto, note, created_at, updated_at)
SELECT UUID(), a.org_id, a.id, 'booking.create', 'MEDIUM', 1,
       'Booking AI: creates an appointment from a patient''s WhatsApp booking request. Slot/hour/shift validation and duplicate checks apply downstream; this rule only classifies the action for the EXECUTE fail-closed rule.',
       NOW(6), NOW(6)
  FROM ai_agents a
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.`key` = 'booking-ai'
   AND a.deleted_at IS NULL;
--> statement-breakpoint
