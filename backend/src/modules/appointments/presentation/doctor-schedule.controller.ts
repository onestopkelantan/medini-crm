import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { DoctorScheduleService } from '../application/doctor-schedule.service';

@Controller({ path: 'doctor-schedules', version: '1' })
export class DoctorScheduleController {
  constructor(private readonly service: DoctorScheduleService) {}

  @Get()
  @RequirePermission('appointments', 'view')
  list(@Req() req: AuthedRequest) {
    return this.service.list(req.principal!);
  }


  @Get('holidays')
  @RequirePermission('appointments', 'view')
  listHolidays(@Req() req: AuthedRequest) {
    return this.service.listHolidays(req.principal!);
  }

  @Post('holidays')
  @RequirePermission('appointments', 'create')
  createHoliday(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createHoliday(req.principal!, body);
  }

  @Delete('holidays/:id')
  @RequirePermission('appointments', 'create')
  removeHoliday(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.removeHoliday(req.principal!, id);
  }
  @Patch(':id')
  @RequirePermission('appointments', 'create')
  update(@Param('id') id: string, @Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.update(req.principal!, id, body);
  }

  @Delete(':id')
  @RequirePermission('appointments', 'create')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.remove(req.principal!, id);
  }

  @Post()
  @RequirePermission('appointments', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.create(req.principal!, body);
  }
}




