import {
  Injectable, CanActivate, ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeService } from '../../shared/security/scope.service';
import { PERMISSION_KEY, RequiredPermission } from './decorators';
import { AuthedRequest } from './auth.guard';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/errors';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scope: ScopeService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(
      PERMISSION_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    if (!required) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const principal = req.principal;

    if (!principal) {
      throw new UnauthorizedError('Authentication required');
    }

    const target = {
      branchId: this.pick(req, 'branchId'),
      doctorId: this.pick(req, 'doctorId'),
    };

    /*
     * Appointment mutation untuk user cawangan menggunakan branch
     * daripada Principal apabila request tidak menghantar branchId.
     *
     * Scope masih fail-closed:
     * - HQ mesti pilih target branch sendiri bila diperlukan.
     * - Branch user hanya boleh menggunakan branch miliknya.
     * - Doctor tetap ditolak oleh permission matrix untuk create/edit.
     */
    if (
      principal.role !== 'hq' &&
      (
        required.domain === 'appointments' ||
        required.domain === 'patients'
      ) &&
      (
        required.action === 'create' ||
        required.action === 'edit'
      ) &&
      target.branchId == null &&
      principal.branchId
    ) {
      target.branchId = principal.branchId;
    }

    /*
     * Untuk bacaan tanpa branchId, gunakan branch user.
     */
    if (
      required.action === 'view' &&
      target.branchId == null &&
      principal.branchId
    ) {
      target.branchId = principal.branchId;
    }

    /*
     * Doctor hanya boleh lihat data berkaitan dirinya.
     */
    if (
      required.action === 'view' &&
      principal.role === 'doctor' &&
      target.doctorId == null
    ) {
      target.doctorId = principal.doctorId;
    }

    const allowed = this.scope.can(
      principal,
      required.domain,
      required.action,
      target,
    );

    if (!allowed) {
      throw new ForbiddenError(
        'You do not have permission to perform this action',
      );
    }

    return true;
  }

  private pick(req: AuthedRequest, key: string): string | null {
    const fromParams =
      (req.params as Record<string, string> | undefined)?.[key];

    const fromQuery =
      (req.query as Record<string, string> | undefined)?.[key];

    const fromBody =
      (req.body as Record<string, string> | undefined)?.[key];

    return fromParams ?? fromQuery ?? fromBody ?? null;
  }
}
