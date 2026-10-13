import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  ParseUUIDPipe } from '@nestjs/common';
import { EncountersService } from '../application/encounters.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * EncountersController — clinical case API (Sprint 3 S3-D).
 * Permission domain 'clinical' (ROLE_DOMAIN_MATRIX unchanged):
 * hq view(all) · branch_manager view(branch) · doctor create/edit(own) ·
 * branch_admin NONE (denied at PermissionGuard).
 */
@Controller({ path: 'clinical/encounters', version: '1' })
export class EncountersController {
  constructor(private readonly service: EncountersService) {}

  @Post()
  @RequirePermission('clinical', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.create(req.principal!, body);
  }

  @Get()
  @RequirePermission('clinical', 'view')
  search(
    @Req() req: AuthedRequest,
    @Query('patientId') patientId?: string,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.search(req.principal!, {
      patientId, branchId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  @RequirePermission('clinical', 'view')
  getById(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(req.principal!, id);
  }

  @Patch(':id/status')
  @RequirePermission('clinical', 'edit')
  transition(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.transition(req.principal!, id, body);
  }

  @Post(':id/acknowledge-allergy')
  @RequirePermission('clinical', 'edit')
  acknowledgeAllergy(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.acknowledgeAllergy(req.principal!, id);
  }
}
