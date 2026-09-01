/*
 * Menghalang dua appointment aktif menggunakan slot sama.
 * Appointment cancelled dan no-show akan melepaskan slot.
 */
CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_branch_slot_unique
  ON appointments (
    org_id,
    branch_id,
    scheduled_date,
    scheduled_time
  )
  WHERE deleted_at IS NULL
    AND status NOT IN ('cancelled', 'no-show');