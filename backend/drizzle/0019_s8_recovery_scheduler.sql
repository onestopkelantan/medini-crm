-- Sprint 8 Remediation (F-03/F-04/F-08): recovery scheduler foundation.
-- Additive only. Preserves S0–S8 behaviour.
--
-- 1. bukku_sync_records.branch_id — records the org's home branch so the
--    recovery sweep can build a valid single-branch worker scope for an
--    org-scoped (branch-less) sync record. Backfilled to the org's first
--    branch; the column is observational scope metadata, not a hard FK.
--
-- 2. branches read policy for system_worker — the recovery scheduler must
--    enumerate the org's active branches under its trusted org GUC in order
--    to fan out per-branch scoped sweeps. Read-only grant; writes to the
--    branch registry remain human-only.

ALTER TABLE bukku_sync_records ADD COLUMN IF NOT EXISTS branch_id uuid;

UPDATE bukku_sync_records b
   SET branch_id = (SELECT id FROM branches WHERE org_id = b.org_id ORDER BY code LIMIT 1)
 WHERE b.branch_id IS NULL;

DROP POLICY IF EXISTS s8_branches_worker_read ON branches;
CREATE POLICY s8_branches_worker_read ON branches FOR SELECT
  USING (app_role() = 'system_worker' AND org_id = app_org_id());
