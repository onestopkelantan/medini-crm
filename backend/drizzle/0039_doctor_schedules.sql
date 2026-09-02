/* Jadual waktu bertugas doktor mengikut cawangan dan tarikh. */
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  schedule_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT doctor_schedules_valid_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS doctor_schedules_branch_date_idx
  ON doctor_schedules (org_id, branch_id, schedule_date);

CREATE INDEX IF NOT EXISTS doctor_schedules_doctor_date_idx
  ON doctor_schedules (doctor_id, schedule_date);

CREATE UNIQUE INDEX IF NOT EXISTS doctor_schedules_slot_unique
  ON doctor_schedules (
    org_id,
    branch_id,
    doctor_id,
    schedule_date,
    start_time,
    end_time
  );
