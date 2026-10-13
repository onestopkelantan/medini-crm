import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ScopeService } from '@shared/security/scope.service';
import { PermissionGuard } from '@core/auth/permission.guard';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/errors';
import type { Principal } from '@core/auth/principal';

/** Minimal HTTP context fake for guard unit tests. */
interface FakeReq { principal?: Principal; params: Record<string, string | null | undefined>; query: Record<string, string | null | undefined>; body: Record<string, string | null | undefined> }
function ctx(principal: Principal | undefined, target: { branchId?: string | null; doctorId?: string | null }, required?: { domain: string; action: string }) {
  const reflector = new Reflector();
  reflector.getAllAndOverride = (() => required ?? undefined) as never;
  const scope = new ScopeService();
  const guard = new PermissionGuard(reflector, scope);
  const req: FakeReq = { principal, params: {}, query: {}, body: {} };
  if (target.branchId !== undefined) req.params.branchId = target.branchId;
  if (target.doctorId !== undefined) req.params.doctorId = target.doctorId;
  const execCtx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { guard, ctx: execCtx };
}

const hq: Principal = { staffId: 's1', name: 'HQ User', username: 'hq', role: 'hq', orgId: 'org-1', branchId: null, doctorId: null };
const bm: Principal = { staffId: 's2', name: 'Branch Manager', username: 'manager', role: 'branch_manager', orgId: 'org-1', branchId: 'sentosa', doctorId: null };
const doctor: Principal = { staffId: 's3', name: 'Doctor', username: 'doctor', role: 'doctor', orgId: 'org-1', branchId: 'gp', doctorId: 'dr-aina' };

describe('PermissionGuard (authorization enforcement)', () => {
  it('allows hq on finance.view (scope=all)', () => {
    const { guard, ctx: c } = ctx(hq, {}, { domain: 'finance', action: 'view' });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('denies branch_manager on cross-branch finance.submit (403)', () => {
    const { guard, ctx: c } = ctx(bm, { branchId: 'pearl' }, { domain: 'finance', action: 'submit' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('allows branch_manager on own-branch finance.submit', () => {
    const { guard, ctx: c } = ctx(bm, { branchId: 'sentosa' }, { domain: 'finance', action: 'submit' });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('denies branch_manager when target branchId is missing (fail-closed)', () => {
    const { guard, ctx: c } = ctx(bm, { branchId: null }, { domain: 'finance', action: 'submit' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('denies doctor on cross-doctor clinical.create (403)', () => {
    const { guard, ctx: c } = ctx(doctor, { branchId: 'gp', doctorId: 'dr-mei' }, { domain: 'clinical', action: 'create' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('denies doctor when doctor context missing (fail-closed)', () => {
    /* Selepas pembaikan 403-doktor (8 Okt 2026), guard mengisi sendiri
     * target.doctorId = principal.doctorId bila doktor login menulis
     * tanpa menyatakan doctorId. "Fail-closed tanpa konteks doktor"
     * kini hanya berlaku bila principal itu sendiri TIADA identiti
     * doktor (doctorId null) — kes ini: doktor rosak/tanpa doctor_ref. */
    const brokenDoctor: Principal = { ...doctor, doctorId: null };
    const { guard, ctx: c } = ctx(brokenDoctor, { branchId: 'gp', doctorId: null }, { domain: 'clinical', action: 'create' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('auto-fills doctor identity for doctor clinical.create (bugfix 8 Okt 2026)', () => {
    /* Doktor menulis ATAS NAMA SENDIRI tanpa perlu mengetik doctorId
     * dalam body — guard mengisinya; sebelum pembaikan ini semua tulis
     * klinikal doktor 403 palsu. */
    const { guard, ctx: c } = ctx(doctor, { branchId: 'gp', doctorId: null }, { domain: 'clinical', action: 'create' });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('denies unknown domain (403)', () => {
    const { guard, ctx: c } = ctx(hq, {}, { domain: 'nonexistent', action: 'view' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('throws 401 when no principal attached (guard runs before auth)', () => {
    const { guard, ctx: c } = ctx(undefined, {}, { domain: 'finance', action: 'view' });
    expect(() => guard.canActivate(c)).toThrow(UnauthorizedError);
  });

  it('passes through routes with no permission metadata (auth-only)', () => {
    const { guard, ctx: c } = ctx(bm, {}, undefined);
    expect(guard.canActivate(c)).toBe(true);
  });

  /* Sprint 2 final remediation — Blocker 2: branch-scoped VIEW derives branch
   * from principal; mutations stay fail-closed; foreign branch still denied. */
  it('allows branch_manager VIEW without target branchId (derives from principal)', () => {
    const { guard, ctx: c } = ctx(bm, {}, { domain: 'patients', action: 'view' });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('allows branch_admin VIEW without target branchId (derives from principal)', () => {
    const reception: Principal = { staffId: 's4', name: 'Reception', username: 'reception', role: 'branch_admin', orgId: 'org-1', branchId: 'sentosa', doctorId: null };
    const { guard, ctx: c } = ctx(reception, {}, { domain: 'patients', action: 'view' });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('denies branch_manager VIEW of a foreign branch (403)', () => {
    const { guard, ctx: c } = ctx(bm, { branchId: 'pearl' }, { domain: 'patients', action: 'view' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  /* Branch-scoped mutations derive the target branch from the principal when
   * the request omits it (same rule as appointments below). The matrix grants
   * branch_manager patients.create within its OWN branch, so the fail-closed
   * property that actually matters is that the branch can never be widened to
   * a foreign one, or left unresolved. Both cases are asserted here. */
  it('derives own branch: branch_manager patients.create without branchId is allowed', () => {
    const { guard, ctx: c } = ctx(bm, {}, { domain: 'patients', action: 'create' });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('keeps mutations fail-closed: branch_manager patients.create for a foreign branch is denied', () => {
    const { guard, ctx: c } = ctx(bm, { branchId: 'pearl' }, { domain: 'patients', action: 'create' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('keeps mutations fail-closed: branch user with no branch of its own is denied', () => {
    const orphan: Principal = { staffId: 's9', name: 'Orphan Manager', username: 'orphan', role: 'branch_manager', orgId: 'org-1', branchId: null, doctorId: null };
    const { guard, ctx: c } = ctx(orphan, {}, { domain: 'patients', action: 'create' });
    expect(() => guard.canActivate(c)).toThrow(ForbiddenError);
  });

  it('allows branch_manager appointments.create without target branchId', () => {
    const { guard, ctx: c } = ctx(
      bm,
      {},
      { domain: 'appointments', action: 'create' },
    );

    expect(guard.canActivate(c)).toBe(true);
  });

  it('allows branch_admin appointments.create without target branchId', () => {
    const reception: Principal = {
      staffId: 's4',
      name: 'Reception',
      username: 'reception',
      role: 'branch_admin',
      orgId: 'org-1',
      branchId: 'sentosa',
      doctorId: null,
    };

    const { guard, ctx: c } = ctx(
      reception,
      {},
      { domain: 'appointments', action: 'create' },
    );

    expect(guard.canActivate(c)).toBe(true);
  });

  it('denies branch_manager appointments.create for foreign branch', () => {
    const { guard, ctx: c } = ctx(
      bm,
      { branchId: 'pearl' },
      { domain: 'appointments', action: 'create' },
    );

    expect(() => guard.canActivate(c))
      .toThrow(ForbiddenError);
  });

  it('denies doctor appointments.create', () => {
    const { guard, ctx: c } = ctx(
      doctor,
      {},
      { domain: 'appointments', action: 'create' },
    );

    expect(() => guard.canActivate(c))
      .toThrow(ForbiddenError);
  });

});
