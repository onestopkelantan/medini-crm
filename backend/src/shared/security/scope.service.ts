import { Injectable } from '@nestjs/common';
import {
  can, PermissionContext, RoleAction,
} from '../architecture/architecture.contract';
import { Principal } from '../../core/auth/principal';

/* Principal is defined canonically in core/auth/principal.ts (Sprint 1 Task 2).
 * Re-exported here for backward compatibility with Sprint 0 imports. */
export type { Principal } from '../../core/auth/principal';

/**
 * ScopeService — single place that translates a Principal into an authorization
 * decision using the locked PERMISSION_MATRIX. Server-side only.
 */
@Injectable()
export class ScopeService {
  can(principal: Principal, domain: string, action: RoleAction | string, target: { branchId?: string | null; doctorId?: string | null } = {}): boolean {
    const ctx: PermissionContext = {
      actorBranchId: principal.branchId,
      branchId: target.branchId,
      doctorId: target.doctorId,
      actorDoctorId: principal.doctorId,
    };
    return can(principal.role, domain, action, ctx);
  }
}
