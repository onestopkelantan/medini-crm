import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  ParseUUIDPipe } from '@nestjs/common';
import { PlansService } from '../application/plans.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * PlansController — treatment plan lifecycle API (Sprint 3 S3-D).
 * Lifecycle draft→proposed→accepted→active→completed|cancelled is enforced
 * by the domain state machine; consent gate + pending-items gate apply.
 */
@Controller({ path: 'clinical/plans', version: '1' })
export class PlansController {
  constructor(private readonly service: PlansService) {}

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
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.search(req.principal!, {
      patientId, branchId, status,
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
  changeStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.changeStatus(req.principal!, id, body);
  }

  @Post(':id/items')
  @RequirePermission('clinical', 'edit')
  addItem(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.addItem(req.principal!, id, body);
  }

  @Patch('items/:itemId/status')
  @RequirePermission('clinical', 'edit')
  setItemStatus(@Req() req: AuthedRequest, @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.service.setItemStatus(req.principal!, itemId, body);
  }

  @Post(':id/sessions')
  @RequirePermission('clinical', 'create')
  recordSession(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.recordSession(req.principal!, id, body);
  }
}
