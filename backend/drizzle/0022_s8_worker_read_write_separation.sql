-- Sprint 8 Remediation Pass 2 (N8-2/N8-3/N8-7 FINAL FIX): worker read/write separation.
--
-- ROOT CAUSE (forensic): 0017 created s8_worker_exclusion AS RESTRICTIVE FOR ALL
-- with qual (app_role() <> 'system_worker'). PostgreSQL evaluates RESTRICTIVE
-- policies with AND across ALL commands — a PERMISSIVE policy can NEVER
-- override a failing RESTRICTIVE one. So the worker-read policies added in
-- 0020/0021 (s8_wa_conversations_worker_read, s8_patients_worker_read,
-- s8_sale_records_worker_read) could never pass: the exclusion rejected every
-- row for system_worker regardless. Verified via EXPLAIN ANALYZE
-- ("Rows Removed by Filter") and per-clause bisection.
--
-- FIX (no RLS weakening): on the three tables that legitimately need worker
-- SELECT, replace the FOR ALL exclusion with command-scoped exclusions for
-- INSERT, UPDATE, DELETE only. Worker writes remain fully DENIED (the
-- restrictive quals still fail for system_worker on those commands); worker
-- SELECT now flows through the 0020/0021 permissive policies, still gated by
-- s8_org_isolation (org) and the branch predicate.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients', 'wa_conversations', 'sale_records']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS s8_worker_exclusion ON %I', t);
    EXECUTE format('CREATE POLICY s8_worker_exclusion ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_role() <> ''system_worker'')', t);
    EXECUTE format('DROP POLICY IF EXISTS s8_worker_exclusion_update ON %I', t);
    EXECUTE format('CREATE POLICY s8_worker_exclusion_update ON %I AS RESTRICTIVE FOR UPDATE USING (app_role() <> ''system_worker'') WITH CHECK (app_role() <> ''system_worker'')', t);
    EXECUTE format('DROP POLICY IF EXISTS s8_worker_exclusion_delete ON %I', t);
    EXECUTE format('CREATE POLICY s8_worker_exclusion_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_role() <> ''system_worker'')', t);
  END LOOP;
END $$;
