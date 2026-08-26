-- Migration: 0031_f02_doctor_admin_deny.sql
-- F-02: Doctor → HQ DB-layer defence-in-depth
--
-- Root cause: n9_staff_human_all PERMISSIVE policy is too broad — it allows
-- ALL human roles (including doctor) to perform ALL operations on staff
-- without any role-based restriction. The API layer blocks this, but the
-- DB layer does not.
--
-- Fix: Add RESTRICTIVE policies that deny doctor (and other non-admin roles)
-- from performing INSERT/UPDATE/DELETE on staff and role_assignments tables
-- when the target row has role IN ('hq', 'developer').
--
-- Preserves:
-- - HQ/branch_manager/branch_admin legitimate access (SELECT still allowed
--   for all staff in same org via existing policies)
-- - Worker/developer deny (existing restrictive policies)
-- - Org isolation (t2 policies)
-- - Cross-branch behaviour (branch managers can still manage their branch)

-- ============================================================================
-- staff table: deny doctor INSERT/UPDATE/DELETE of HQ/developer rows
-- ============================================================================

-- Doctor cannot INSERT staff with role='hq' or role='developer'
CREATE POLICY f02_staff_doctor_insert_hq_deny ON staff
  AS RESTRICTIVE
  FOR INSERT
  TO medini_app
  WITH CHECK (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  );

-- Doctor cannot UPDATE staff to role='hq' or role='developer'
CREATE POLICY f02_staff_doctor_update_hq_deny ON staff
  AS RESTRICTIVE
  FOR UPDATE
  TO medini_app
  USING (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  )
  WITH CHECK (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  );

-- Doctor cannot DELETE staff with role='hq' or role='developer'
CREATE POLICY f02_staff_doctor_delete_hq_deny ON staff
  AS RESTRICTIVE
  FOR DELETE
  TO medini_app
  USING (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  );

-- ============================================================================
-- role_assignments table: deny doctor INSERT/UPDATE/DELETE of HQ/developer
-- ============================================================================

-- Doctor cannot INSERT role_assignments with role='hq' or role='developer'
CREATE POLICY f02_ra_doctor_insert_hq_deny ON role_assignments
  AS RESTRICTIVE
  FOR INSERT
  TO medini_app
  WITH CHECK (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  );

-- Doctor cannot UPDATE role_assignments to role='hq' or role='developer'
CREATE POLICY f02_ra_doctor_update_hq_deny ON role_assignments
  AS RESTRICTIVE
  FOR UPDATE
  TO medini_app
  USING (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  )
  WITH CHECK (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  );

-- Doctor cannot DELETE role_assignments with role='hq' or role='developer'
CREATE POLICY f02_ra_doctor_delete_hq_deny ON role_assignments
  AS RESTRICTIVE
  FOR DELETE
  TO medini_app
  USING (
    COALESCE(app_role(), '') NOT IN ('doctor', 'receptionist')
    OR role NOT IN ('hq', 'developer')
  );

-- ============================================================================
-- Verification: ensure policies are restrictive (AND with permissive)
-- ============================================================================
-- RESTRICTIVE policies are ANDed with PERMISSIVE policies.
-- So even though n9_staff_human_all allows ALL for non-workers,
-- f02_* policies restrict that to: NOT (doctor/receptionist modifying HQ/developer).
--
-- Result:
-- - HQ/branch_manager/branch_admin: can still manage staff (role not in deny list)
-- - doctor/receptionist: can SELECT staff, but cannot INSERT/UPDATE/DELETE
--   rows where role IN ('hq', 'developer')
-- - worker: denied by existing n9_worker_exclusion policies
-- - developer: denied by existing s10_developer_* policies
