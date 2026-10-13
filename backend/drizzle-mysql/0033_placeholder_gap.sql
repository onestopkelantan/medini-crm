-- ============================================================================
-- 0033 — PLACEHOLDER (no-op).
-- The number 0033 was skipped by mistake during the parallel-desktop session:
-- 0032 (prescriptions) jumped straight to 0034 (inventory Invelli). Both of
-- those are already committed, hand-applied, and recorded in the DB journal,
-- so renumbering them now would rewrite history the journal already describes.
--
-- This file exists so the migration chain stays contiguous (0000..0035) and
-- the RA-1 drift guard / migrate.spec contiguity checks pass. It applies
-- nothing and is safe to run on any database state.
-- ============================================================================

SELECT 1; -- no-op
