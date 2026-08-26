-- ============================================================================
-- SPRINT 4 (P1 REMEDIATION) — FINANCE FINANCIAL-INTEGRITY GUARDS
--
-- Scope: TARGETED P1 fixes only (GLM 5.3 forensic audit). Additive. Does NOT
-- modify locked migrations 0000–0008 and does NOT rewrite 0009.
--
-- P1-2: commission duplicate race — closes the check-then-act gap between
--   findCommissionByDoctorPeriod() and INSERT by adding a DB-level UNIQUE
--   partial index on (org_id, doctor_id, period) WHERE deleted_at IS NULL.
--   The DB is the final authority; PostgreSQL 23505 maps to 409 Conflict via
--   the existing pg-error.ts infrastructure.
--
-- Semantics (documented):
--   - same doctor + same period + same org      → REJECTED (duplicate)
--   - same doctor + different period            → allowed
--   - different doctor + same period            → allowed
--   - different org + same doctor + same period → allowed (org in key)
--   - soft-deleted historical row               → ignored by the partial index
--     (a new ACTIVE row for the same doctor+period may be created after the
--     previous is soft-deleted — matches payor/patient nullable-unique convention)
-- ============================================================================

-- Partial unique index: one ACTIVE commission ledger per (org, doctor, period).
CREATE UNIQUE INDEX IF NOT EXISTS "commission_ledger_org_doctor_period_uq"
	ON "commission_ledger" ("org_id", "doctor_id", "period")
	WHERE "deleted_at" IS NULL;
