import { Controller, Get, Post, Patch, Body, Req, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { AppointmentsService } from '../application/appointments.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

@Controller({ path: 'appointments', version: '1' })
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Post()
  @RequirePermission('appointments', 'create')
  book(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.book(req.principal!, body);
  }

  @Get()
  @RequirePermission('appointments', 'view')
  list(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    return this.service.list(req.principal!, query);
  }

  @Get('queue')
  @RequirePermission('appointments', 'view')
  queue(
    @Req() req: AuthedRequest,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.queue(req.principal!, date, branchId);
  }

  @Get(':id')
  @RequirePermission('appointments', 'view')
  getById(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(req.principal!, id);
  }

  @Patch(':id/status')
  @RequirePermission('appointments', 'edit')
  changeStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.changeStatus(req.principal!, id, body);
  }

  @Patch(':id/reschedule')
  @RequirePermission('appointments', 'edit')
  reschedule(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.reschedule(req.principal!, id, body);
  }
}
