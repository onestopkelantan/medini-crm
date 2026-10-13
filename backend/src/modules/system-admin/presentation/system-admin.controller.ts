import {
  Controller, Get, Req, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { AuthGuard, AuthedRequest } from '../../../core/auth/auth.guard';
import { SystemAdminService } from '../application/system-admin.service';

/**
 * SystemAdminController — S10 GLM 5.3 (Developer / System Admin).
 *
 * Technical surface for the `developer` role. Guard chain: AuthGuard (JWT →
 * Principal) → inline role gate (developer only). Deliberately NOT wired
 * through PermissionGuard/@RequirePermission: the developer has NO business
 * domains in the matrix, and these endpoints are not business domains.
 *
 * Mounted at the GLOBAL prefix (like /health): /system-admin/* (no /api/v1).
 */
@Controller({ path: 'system-admin', version: '' })
@UseGuards(AuthGuard)
export class SystemAdminController {
  constructor(private readonly svc: SystemAdminService) {}

  private requireDeveloper(req: AuthedRequest): void {
    if (req.principal?.role !== 'developer') {
      throw new ForbiddenException('System Admin surface is restricted to the developer role');
    }
  }

  /** GET /system-admin/overview — service/version/env/uptime. */
  @Get('overview')
  overview(@Req() req: AuthedRequest) {
    this.requireDeveloper(req);
    return this.svc.overview();
  }

  /** GET /system-admin/health — liveness. */
  @Get('health')
  health(@Req() req: AuthedRequest) {
    this.requireDeveloper(req);
    return this.svc.overview(); /* same shape; uptime is the signal */
  }

  /** GET /system-admin/readiness — real dependency probes. */
  @Get('readiness')
  readiness(@Req() req: AuthedRequest) {
    this.requireDeveloper(req);
    return this.svc.readiness();
  }
}
