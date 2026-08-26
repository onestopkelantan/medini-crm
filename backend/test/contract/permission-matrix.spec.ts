import { describe, it, expect } from 'vitest';
import { can } from '@shared/architecture/architecture.contract';

describe('PERMISSION_MATRIX.can — scope enforcement (server-side)', () => {
  it('hq can view finance across all branches', () => {
    expect(can('hq', 'finance', 'view', { branchId: 'sentosa' })).toBe(true);
    expect(can('hq', 'finance', 'approve', { branchId: 'pearl' })).toBe(true);
  });

  it('branch_manager is pinned to own branch (cross-branch blocked)', () => {
    expect(can('branch_manager', 'finance', 'submit', { actorBranchId: 'sentosa', branchId: 'sentosa' })).toBe(true);
    expect(can('branch_manager', 'finance', 'submit', { actorBranchId: 'sentosa', branchId: 'pearl' })).toBe(false);
  });

  it('branch_admin (receptionist) has NO finance access but can use whatsapp in branch', () => {
    expect(can('branch_admin', 'finance', 'view', { actorBranchId: 'uda', branchId: 'uda' })).toBe(false);
    expect(can('receptionist', 'whatsapp', 'create', { actorBranchId: 'uda', branchId: 'uda' })).toBe(true);
  });

  /* SPRINT 6 GOVERNANCE D1: doctor has ZERO whatsapp access (canonical matrix). */
  it('doctor is denied every whatsapp action (S6 governance decision D1)', () => {
    for (const action of ['view', 'create', 'edit', 'submit', 'approve', 'delete'] as const) {
      expect(can('doctor', 'whatsapp', action, { actorBranchId: 'gp', branchId: 'gp', doctorId: 'dr-aina', actorDoctorId: 'dr-aina' })).toBe(false);
    }
    /* other roles keep their locked whatsapp cells */
    expect(can('hq', 'whatsapp', 'view', {})).toBe(true);
    expect(can('hq', 'whatsapp', 'create', {})).toBe(true);
    expect(can('branch_manager', 'whatsapp', 'edit', { actorBranchId: 'gp', branchId: 'gp' })).toBe(true);
    expect(can('branch_manager', 'whatsapp', 'edit', { actorBranchId: 'gp', branchId: 'other' })).toBe(false);
    expect(can('branch_admin', 'whatsapp', 'view', { actorBranchId: 'gp', branchId: 'gp' })).toBe(true);
  });

  it('doctor scope=own: cross-branch and cross-doctor blocked', () => {
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', branchId: 'gp', doctorId: 'dr-aina', actorDoctorId: 'dr-aina' })).toBe(true);
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', branchId: 'gp', doctorId: 'dr-mei', actorDoctorId: 'dr-aina' })).toBe(false);
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', branchId: 'sentosa' })).toBe(false);
  });

  it('administration is HQ-only', () => {
    expect(can('hq', 'admin', 'edit', {})).toBe(true);
    expect(can('branch_manager', 'admin', 'view', { actorBranchId: 's', branchId: 's' })).toBe(false);
    expect(can('doctor', 'admin', 'view', { actorBranchId: 'gp', branchId: 'gp' })).toBe(false);
  });

  it('unknown role / domain / action denied', () => {
    expect(can('superuser', 'finance', 'view', {})).toBe(false);
    expect(can('hq', 'nonexistent', 'view', {})).toBe(false);
    expect(can('hq', 'finance', 'delete', {})).toBe(false); /* finance delete=false even for hq */
  });

  it('branch scope requires an actor branch', () => {
    expect(can('branch_manager', 'patients', 'view', { actorBranchId: null, branchId: 'sentosa' })).toBe(false);
  });

  /* GLM fail-closed hardening (Sprint 1) */
  it('branch scope DENIES when target branchId is missing (no implicit default to actor branch)', () => {
    expect(can('branch_manager', 'finance', 'submit', { actorBranchId: 'sentosa' })).toBe(false);
    expect(can('branch_manager', 'patients', 'view', { actorBranchId: 'sentosa' })).toBe(false);
  });

  it('own scope DENIES when doctor context is incomplete (no silent pass)', () => {
    /* missing target doctorId */
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', branchId: 'gp', actorDoctorId: 'dr-aina' })).toBe(false);
    /* missing actorDoctorId */
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', branchId: 'gp', doctorId: 'dr-aina' })).toBe(false);
    /* both missing */
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', branchId: 'gp' })).toBe(false);
    /* missing target branch */
    expect(can('doctor', 'clinical', 'create', { actorBranchId: 'gp', doctorId: 'dr-aina', actorDoctorId: 'dr-aina' })).toBe(false);
  });
});
