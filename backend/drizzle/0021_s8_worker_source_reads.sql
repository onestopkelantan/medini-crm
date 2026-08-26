-- Sprint 8 Remediation Pass 2 (N8-3/N8-4): least-privilege worker reads.
-- The Bukku worker loads the source finance document (sale_records) and the
-- customer display name (patients) under its system_worker scope when
-- building the accounting payload (N8-4). Both grants are SELECT-only,
-- org-isolated (s8_org_isolation, 0017) and branch-scoped (app_branch_ids).
-- Workers still CANNOT insert, update, or delete either table.

DROP POLICY IF EXISTS s8_sale_records_worker_read ON sale_records;
CREATE POLICY s8_sale_records_worker_read ON sale_records FOR SELECT
  USING (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));

DROP POLICY IF EXISTS s8_patients_worker_read ON patients;
CREATE POLICY s8_patients_worker_read ON patients FOR SELECT
  USING (app_role() = 'system_worker' AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])));
