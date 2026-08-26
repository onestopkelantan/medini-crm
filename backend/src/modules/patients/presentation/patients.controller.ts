import { Controller, Get, Post, Patch, Body, Req, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { PatientsService } from '../application/patients.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

@Controller({ path: 'patients', version: '1' })
export class PatientsController {
  constructor(private readonly service: PatientsService) {}

  @Post()
  @RequirePermission('patients', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.register(req.principal!, body);
  }

  @Get()
  @RequirePermission('patients', 'view')
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
  @RequirePermission('patients', 'view')
  getById(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(req.principal!, id);
  }

  @Patch(':id')
  @RequirePermission('patients', 'edit')
  update(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.update(req.principal!, id, body);
  }

  @Get(':id/timeline')
  @RequirePermission('patients', 'view')
  timeline(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.timeline(req.principal!, id, limit ? Number(limit) : undefined);
  }

  @Get(':id/relationships')
  @RequirePermission('patients', 'view')
  relationships(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listRelationships(req.principal!, id);
  }

  @Post(':id/relationships')
  @RequirePermission('patients', 'edit')
  addRelationship(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.addRelationship(req.principal!, id, body);
  }
}
