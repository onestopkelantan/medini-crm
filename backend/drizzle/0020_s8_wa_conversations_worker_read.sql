-- Sprint 8 Remediation Pass 2 (N8-2): wa_conversations worker READ-ONLY access.
-- The WhatsApp transport worker must resolve conversation.contact_phone to
-- build the canonical WAHA chatId (F-01), but 0017's blanket
-- s8_worker_exclusion also blocked wa_conversations — breaking the worker.
--
-- This migration grants the narrowest possible access:
--   system_worker + org scope (s8_org_isolation, from 0017)
--   + branch scope via app_branch_ids()
--   + SELECT only.
-- Workers still CANNOT insert, update, or delete conversations.

DROP POLICY IF EXISTS s8_wa_conversations_worker_read ON wa_conversations;
CREATE POLICY s8_wa_conversations_worker_read ON wa_conversations FOR SELECT
  USING (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));
