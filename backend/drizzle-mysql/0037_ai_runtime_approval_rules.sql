-- 0037 — Complete runtime AI approval classification.
--
-- The governance contract and live webhook both use these two runtime actions.
-- The MySQL canonical seed carried only AP-3/AP-4, so a fresh database failed
-- closed for legitimate receptionist replies/bookings and the live contract
-- caught the drift. Idempotent through the org+agent+action unique key.

INSERT IGNORE INTO ai_approval_rules
  (id, org_id, agent_id, action_key, risk, auto, note, created_at, updated_at)
SELECT UUID(), a.org_id, a.id, 'wa.reply_patient', 'MEDIUM', 1,
       'AI receptionist reply may auto-send after guardrails', NOW(6), NOW(6)
  FROM ai_agents a
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.`key` = 'ai-receptionist' AND a.deleted_at IS NULL;
--> statement-breakpoint

INSERT IGNORE INTO ai_approval_rules
  (id, org_id, agent_id, action_key, risk, auto, note, created_at, updated_at)
SELECT UUID(), a.org_id, a.id, 'booking.create', 'MEDIUM', 1,
       'Booking creation may auto-execute after slot and guardrail checks', NOW(6), NOW(6)
  FROM ai_agents a
 WHERE a.org_id = '00000000-0000-0000-0000-000000000001'
   AND a.`key` = 'booking-ai' AND a.deleted_at IS NULL;
