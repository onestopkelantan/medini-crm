import {
  Controller, Post, Get, Body, Req, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, LoginResult } from './auth.service';
import { StaffRegistrationService } from './staff-registration.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { Public, RequirePermission } from './decorators';
import { AuthedRequest } from './auth.guard';
import { AuditService } from '../../shared/audit/audit.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Auth controller — login + refresh + logout + register + a protected self endpoint.
 * /auth/login, /auth/refresh, /auth/register are @Public (pre-auth).
 * /auth/me requires a valid token and returns the DB-derived Principal.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly registration: StaffRegistrationService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } }) /* S10-05: login 5/min/IP */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Returns Bearer access + refresh tokens + safe user payload.' })
  async login(@Body() dto: LoginDto): Promise<LoginResult> {
    try {
      const { result, principal } = await this.auth.login(dto.username, dto.password);
      /* Audit login success — never log the password or token. */
      await this.safeAudit({
        actorId: principal.staffId, actorRole: principal.role, action: 'auth_login_success',
        entity: 'staff', entityId: principal.staffId, branchId: principal.branchId,
      });
      return result;
    } catch (e) {
      /* Audit login failure — generic, no username/password detail leaked. */
      await this.safeAudit({
        actorId: ORG_ID, actorRole: 'anonymous', action: 'auth_login_failure',
        entity: 'staff', entityId: 'unknown', branchId: null,
      });
      throw e;
    }
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } }) /* S10-05: refresh 10/min/IP */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Rotates refresh token, returns new access + refresh pair.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Revokes the refresh token server-side.' })
  async logout(@Req() req: AuthedRequest, @Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken, req.principal!);
    await this.safeAudit({
      actorId: req.principal!.staffId, actorRole: req.principal!.role, action: 'auth_logout',
      entity: 'staff', entityId: req.principal!.staffId, branchId: req.principal!.branchId,
    });
    return { ok: true };
  }

  @Public()
  @Throttle({ auth: { limit: 3, ttl: 60_000 } }) /* S10-05: register 3/min/IP */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOkResponse({ description: 'Staff self-registration via single-use invitation token → Pending.' })
  async register(@Body() dto: RegisterDto) {
    return this.registration.register(dto);
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    const p = req.principal!;
    return {
      data: {
        staffId: p.staffId,
        username: p.username,
        role: p.role,
        orgId: p.orgId,
        branchId: p.branchId,
        doctorId: p.doctorId,
      },
    };
  }

  /* Demo of @RequirePermission — finance view, branch scope. Only roles whose
   * matrix grants finance.view pass; the rest get 403. */
  @Get('can-finance')
  @RequirePermission('finance', 'view')
  canFinance(@Req() req: AuthedRequest) {
    return { data: { allowed: true, role: req.principal!.role } };
  }

  private async safeAudit(e: {
    actorId: string; actorRole: string; action: string; entity: string;
    entityId: string; branchId: string | null;
  }): Promise<void> {
    try {
      await this.audit.record({
        actorId: e.actorId, actorRole: e.actorRole, action: e.action,
        entity: e.entity, entityId: e.entityId, orgId: ORG_ID, branchId: e.branchId,
        source: 'api',
      });
    } catch (err) {
      /* audit failure must not break auth; log (no secrets) and continue */
      this.logger.warn(`audit record failed: ${(err as Error).message}`);
    }
  }
}
