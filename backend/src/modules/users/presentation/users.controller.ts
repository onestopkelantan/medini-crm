import { Body, Controller, Param, Patch, Req, ParseUUIDPipe } from '@nestjs/common';
import { UserProfileService } from '../application/user-profile.service';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * UsersController — self-service profile. Requires a valid token; no domain
 * permission (any authenticated user may edit their OWN profile — the service
 * rejects any :id other than the caller's).
 */
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly service: UserProfileService) {}

  @Patch(':id/profile')
  updateProfile(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.updateProfile(req.principal!, id, body);
  }
}
