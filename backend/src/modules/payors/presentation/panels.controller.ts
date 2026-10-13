import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  ParseUUIDPipe } from '@nestjs/common';
import { PanelsService } from '../application/panels.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * PanelsController — Panel master data API (Sprint 2A T3).
 * Permission domain key: 'finance' (payors are Finance-owned master data per
 * DATA_OWNERSHIP) — ROLE_DOMAIN_MATRIX unchanged: hq full, branch_manager
 * view, branch_admin/doctor NONE. The service additionally enforces HQ-only
 * writes (mirrors T1 RLS WITH CHECK).
 */
@Controller({ path: 'panels', version: '1' })
export class PanelsController {
  constructor(private readonly service: PanelsService) {}

  @Post()
  @RequirePermission('finance', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.create(req.principal!, body);
  }

  @Get('library')
  @RequirePermission('finance', 'view')
  library(@Req() _req: AuthedRequest) {
    return this.service.listLibrary();
  }

  @Post('clone')
  @RequirePermission('finance', 'create')
  clone(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.clone(req.principal!, body);
  }

  @Get()
  @RequirePermission('finance', 'view')
  search(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.search(
      req.principal!,
      q,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  @Get(':id')
  @RequirePermission('finance', 'view')
  getById(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(req.principal!, id);
  }

  @Patch(':id')
  @RequirePermission('finance', 'edit')
  update(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.update(req.principal!, id, body);
  }

  @Patch(':id/status')
  @RequirePermission('finance', 'edit')
  changeStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.changeStatus(req.principal!, id, body);
  }
}
