/*
  Allow the WhatsApp system worker to create patients and appointments
  inside its assigned branch only.
*/

DROP POLICY IF EXISTS s8_worker_exclusion ON appointments;

CREATE POLICY s8_worker_exclusion ON appointments
  AS RESTRICTIVE
  FOR ALL
  USING (
    app_role() <> 'system_worker'
    OR (
      app_role() = 'system_worker'
      AND branch_id::text = ANY(
        COALESCE(app_branch_ids(), ARRAY[]::text[])
      )
    )
  )
  WITH CHECK (
    app_role() <> 'system_worker'
    OR (
      app_role() = 'system_worker'
      AND branch_id::text = ANY(
        COALESCE(app_branch_ids(), ARRAY[]::text[])
      )
    )
  );

DROP POLICY IF EXISTS s8_worker_exclusion ON patients;

CREATE POLICY s8_worker_exclusion ON patients
  AS RESTRICTIVE
  FOR ALL
  USING (
    app_role() <> 'system_worker'
    OR (
      app_role() = 'system_worker'
      AND branch_id::text = ANY(
        COALESCE(app_branch_ids(), ARRAY[]::text[])
      )
    )
  )
  WITH CHECK (
    app_role() <> 'system_worker'
    OR (
      app_role() = 'system_worker'
      AND branch_id::text = ANY(
        COALESCE(app_branch_ids(), ARRAY[]::text[])
      )
    )
  );

DROP POLICY IF EXISTS whatsapp_auto_booking_appointments_worker
  ON appointments;

CREATE POLICY whatsapp_auto_booking_appointments_worker
  ON appointments
  FOR INSERT
  WITH CHECK (
    app_role() = 'system_worker'
    AND org_id = app_org_id()
    AND branch_id::text = ANY(
      COALESCE(app_branch_ids(), ARRAY[]::text[])
    )
  );

DROP POLICY IF EXISTS whatsapp_auto_booking_patients_worker
  ON patients;

CREATE POLICY whatsapp_auto_booking_patients_worker
  ON patients
  FOR INSERT
  WITH CHECK (
    app_role() = 'system_worker'
    AND org_id = app_org_id()
    AND branch_id::text = ANY(
      COALESCE(app_branch_ids(), ARRAY[]::text[])
    )
  );

GRANT SELECT, INSERT ON patients TO medini_app;
GRANT SELECT, INSERT ON appointments TO medini_app;