-- FASA 5A-fix — one WhatsApp session per branch
--
-- WHY THIS IS NEEDED
--
-- The webhook used to answer every patient as a single hard-coded branch, so no
-- branch had its own identity. Routing now keys off the WAHA session name, and
-- these columns are where that mapping is stored. Until a branch has a session
-- name it cannot be routed to, so the QR page has nothing to link a number to.
--
-- `branches.whatsapp_session` is the per-branch field; the resolver also reads
-- `wa_channels.session_name`, which stays authoritative once a channel row
-- exists (it carries the phone, status and health the Hub displays).
--
-- Naming: medini-<branch code>. The prefix keeps Medini sessions distinguishable
-- when several share one WAHA instance, and the code is already unique.
--
-- Idempotent: only fills NULLs, so re-running never overwrites a session an
-- operator has deliberately changed.

UPDATE branches
   SET whatsapp_session = CONCAT('medini-', code)
 WHERE deleted_at IS NULL
   AND (whatsapp_session IS NULL OR whatsapp_session = '');

-- The existing `setia-tropika` channel is attached to the WRONG branch (Bukit
-- Indah) and its status is `failed`; Setia Tropika will be given its own number
-- later. Left in place deliberately so the mis-attachment is visible in the Hub
-- rather than silently deleted — but its session name is corrected so it cannot
-- be confused with a live per-branch session.
UPDATE wa_channels
   SET session_name = 'medini-legacy-bukit-indah'
 WHERE session_name = 'setia-tropika'
   AND deleted_at IS NULL;

-- Test residue from Fasa 4 — not a real channel.
UPDATE wa_channels
   SET deleted_at = NOW(6)
 WHERE session_name = 'fasa4-test'
   AND deleted_at IS NULL;
