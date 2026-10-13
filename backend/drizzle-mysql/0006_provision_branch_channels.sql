-- FASA 5A-fix (b) — provision one QR-ready WhatsApp channel per branch
--
-- WHY
--
-- One WhatsApp number per branch. Until a branch has a channel row the webhook
-- correctly refuses its messages, so the branch cannot be onboarded at all:
-- there is nothing for the QR page to attach a number to. This pre-creates one
-- channel per branch in the NEED_QR state, which is exactly "opened and waiting
-- for a scan" — not an error.
--
-- STATUS SEMANTICS
--
-- `need_qr`  = opened, waiting for the operator to scan (this migration)
-- `working`  = scanned and connected
-- `failed`   = WAHA could not keep the session alive
--
-- `need_qr` rather than `failed` matters: an operator opening the Hub must be
-- invited to scan, not told something broke.
--
-- PLACEHOLDER NUMBERS
--
-- A channel row requires a phone value, but the real number is unknown until the
-- operator scans. A placeholder in the 6010000xxxx range is used so it is
-- obviously not a real line; the operator replaces it when scanning. It is NOT
-- used for routing — routing keys off the session name.
--
-- ORDER MATTERS: stale rows are retired BEFORE the insert. Doing it the other way
-- round silently skips any branch whose only channel is a legacy row that is
-- about to be deleted — which is exactly how Bukit Indah ended up with none.
--
-- Idempotent: a branch that already has an active channel is skipped, so
-- re-running never duplicates or overwrites real configuration.

-- 1. Retire legacy / test rows so they cannot mask a branch during provisioning.
--    The mis-attached `setia-tropika` row belongs to no branch's real number, and
--    `fasa4-test` is test residue.
UPDATE wa_channels
   SET deleted_at = NOW(6)
 WHERE deleted_at IS NULL
   AND session_name IN ('medini-legacy-bukit-indah', 'fasa4-test', 'setia-tropika');

-- 2. Give every branch without an active channel one, ready for a QR scan.
INSERT INTO wa_channels
  (id, org_id, branch_id, phone, session_name, status, health_score,
   sent_today_count, created_at, updated_at)
SELECT
  UUID(),
  b.org_id,
  b.id,
  CONCAT('6010', LPAD(ROW_NUMBER() OVER (ORDER BY b.code), 7, '0')),
  COALESCE(NULLIF(b.whatsapp_session, ''), CONCAT('medini-', b.code)),
  'need_qr',
  0,
  0,
  NOW(6),
  NOW(6)
FROM branches b
WHERE b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM wa_channels c
    WHERE c.branch_id = b.id
      AND c.deleted_at IS NULL
  );
