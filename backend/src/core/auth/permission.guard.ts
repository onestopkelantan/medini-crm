import {
  Injectable, CanActivate, ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeService } from '../../shared/security/scope.service';
import { PERMISSION_KEY, RequiredPermission } from './decorators';
import { AuthedRequest } from './auth.guard';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/errors';

/**
 * PermissionGuard — central authorization enforcement (Part 7/8).
 *
 * Runs AFTER AuthGuard (which attaches the Principal). Reads the route's
 * @RequirePermission(domain, action) metadata and calls ScopeService → can().
 * Developers declare permission once on the route; they never hand-roll checks.
 *
 * Fail-closed (Part 9): unknown role/domain/action and missing branch/doctor
 * context all DENY via the locked can() contract. Target scope (branch/doctor)
 * is taken from validated request params/query — never trusted blindly: the
 * can() matrix already enforces that a non-HQ actor's target must equal the
 * actor's own branch/doctor, so a forged foreign branchId is denied here.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scope: ScopeService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true; /* no permission metadata → auth-only route */

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const principal = req.principal;
    if (!principal) throw new UnauthorizedError('Authentication required');

    /* Target context from request (params/query/body). The can() contract
     * enforces scope: a branch-scoped actor targeting a foreign branch is
     * DENIED here. Missing target context → DENY (fail-closed). */
    const target = {
      branchId: this.pick(req, 'branchId'),
      doctorId: this.pick(req, 'doctorId'),
    };

    /* Sprint 2 final remediation — Blocker 2: branch-scoped READ (view) must
     * derive the effective branch from the AUTHENTICATED PRINCIPAL when the
     * endpoint carries no target branchId (e.g. GET /patients?q=..., dashboard
     * context, day queue). Without this, daily-operations roles (manager,
     * reception) got 403 on every read. Foreign-branch reads stay DENIED by
     * can() (target !== actor branch). MUTATIONS never auto-assume context —
     * HQ mutation without explicit branchId still yields 422 in the service. */
    if (required.action === 'view') {
      if (target.branchId == null && principal.branchId) {
        target.branchId = principal.branchId;
      }
      /* doctor own-scope VIEW: identity also derives from the principal; the
       * fine-grained doctor↔patient linkage is enforced by the domain service. */
      if (principal.role === 'doctor' && target.doctorId == null) {
        target.doctorId = principal.doctorId;
      }
    }

    const allowed = this.scope.can(principal, required.domain, required.action, target);
    if (!allowed) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
    return true;
  }

  private pick(req: AuthedRequest, key: string): string | null {
    const fromParams = (req.params as Record<string, string> | undefined)?.[key];
    const fromQuery = (req.query as Record<string, string> | undefined)?.[key];
    const fromBody = (req.body as Record<string, string> | undefined)?.[key];
    return fromParams ?? fromQuery ?? fromBody ?? null;
  }
}
