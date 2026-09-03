import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { DoctorRegistrationService } from '../application/doctor-registration.service';

@Controller({ path: 'doctor-registration', version: '1' })
export class DoctorRegistrationController {
  constructor(private readonly service: DoctorRegistrationService) {}

  @Get('doctors')
  @RequirePermission('appointments', 'view')
  list(@Req() req: AuthedRequest) {
    return this.service.list(req.principal!);
  }

  @Get('branch')
  currentBranch(@Req() req: AuthedRequest) {
    return this.service.currentBranch(req.principal!);
  }

  @Post('doctors/register')
  @RequirePermission('appointments', 'create')
  register(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.register(req.principal!, body);
  }
}
