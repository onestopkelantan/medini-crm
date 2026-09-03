import { Body, Controller, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { DoctorRegistrationService } from '../application/doctor-registration.service';

@Controller({ path: 'appointments', version: '1' })
export class DoctorRegistrationController {
  constructor(private readonly service: DoctorRegistrationService) {}

  @Post('doctors/register')
  @RequirePermission('appointments', 'create')
  register(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.register(req.principal!, body);
  }
}
