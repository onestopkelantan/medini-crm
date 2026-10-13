import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { NurseScheduleService } from '../application/nurse-schedule.service';

@Controller({ path: 'nurse-schedules', version: '1' })
export class NurseScheduleController {
  constructor(private readonly service: NurseScheduleService) {}

  @Get()
  @RequirePermission('appointments', 'view')
  list(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.list(req.principal!, branchId || undefined);
  }

  /* Senarai perawat utk pemilih UI. */
  @Get('nurses')
  @RequirePermission('appointments', 'view')
  listNurses(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.listNurses(req.principal!, branchId || undefined);
  }

  @Post()
  @RequirePermission('appointments', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.create(req.principal!, body);
  }

  @Delete(':id')
  @RequirePermission('appointments', 'create')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(req.principal!, id);
  }
}
