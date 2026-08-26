import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { SettingsService } from '../application/settings.service';

/**
 * Settings REST API v1 (Sprint 7 T2) — configuration governance.
 * RBAC via canonical matrix: hq view/edit/approve; branch_manager view + own-branch
 * override; branch_admin/receptionist/doctor view only. SecretRef = HQ-only (G9).
 */
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  /* ---------- registry (definitions) ---------- */
  @Get('definitions') @RequirePermission('settings', 'view') listDefinitions(@Req() req: AuthedRequest, @Query('category') category?: string) { return this.service.listDefinitions(req.principal!, category); }
  @Post('definitions') @RequirePermission('settings', 'edit') createDefinition(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createDefinition(req.principal!, body); }

  /* ---------- effective resolution + scoped set + history ---------- */
  @Get('values/:key/effective') @RequirePermission('settings', 'view') getEffective(@Req() req: AuthedRequest, @Param('key') key: string, @Query() ctx: Record<string, string>) { return this.service.getEffective(req.principal!, key, ctx); }
  @Post('values/:key') @RequirePermission('settings', 'edit') setValue(@Req() req: AuthedRequest, @Param('key') key: string, @Body() body: unknown) { return this.service.setValue(req.principal!, key, body); }
  @Get('values/:key/versions') @RequirePermission('settings', 'view') getVersions(@Req() req: AuthedRequest, @Param('key') key: string) { return this.service.getVersions(req.principal!, key); }

  /* ---------- secret references (metadata only, HQ-only, G9) ---------- */
  @Get('secrets') @RequirePermission('settings', 'approve') listSecretRefs(@Req() req: AuthedRequest) { return this.service.listSecretRefs(req.principal!); }
  @Post('secrets') @RequirePermission('settings', 'approve') registerSecretRef(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.registerSecretRef(req.principal!, body); }
}
