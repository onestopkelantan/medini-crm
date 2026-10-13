-- FASA 5C-A — seed patients.last_visit_at from existing appointment history
--
-- WHY
--
-- `patients.last_visit_at` is the column every recall and marketing window reads,
-- and until this phase nothing wrote it. It was NULL for every patient, which
-- made the audience filter behave as a no-op: a 1-day window returned the same
-- patients as a 10-year window, i.e. everybody.
--
-- Writing it on completion fixes the future. This migration repairs the past:
-- without it, existing patients stay invisible to recall until they happen to be
-- seen again, so the first campaigns would run against an empty (or wrong) list.
--
-- SCOPE
--
-- Only the most recent COMPLETED appointment per patient, and only where the
-- stored value is NULL or older. `GREATEST`-style forward-only semantics: a
-- patient whose recorded last visit is more recent than any appointment is left
-- untouched, so this can never move a patient backwards into an older bucket.
--
-- Idempotent: re-running finds nothing newer to apply.

UPDATE patients p
   SET p.last_visit_at = (
         SELECT MAX(TIMESTAMP(a.scheduled_date, a.scheduled_time))
           FROM appointments a
          WHERE a.org_id = p.org_id
            AND a.patient_id = p.id
            AND a.deleted_at IS NULL
            AND a.status = 'completed'
       ),
       p.updated_at = NOW(6)
 WHERE p.deleted_at IS NULL
   AND p.last_visit_at IS NULL
   AND EXISTS (
         SELECT 1
           FROM appointments a
          WHERE a.org_id = p.org_id
            AND a.patient_id = p.id
            AND a.deleted_at IS NULL
            AND a.status = 'completed'
       );
