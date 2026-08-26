import { Body, Controller, Post, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { PasswordChangeService } from './password-change.service';
import { AuthedRequest } from './auth.guard';

/**
 * Self-service account routes under /auth. Requires a valid token (AuthGuard);
 * no domain permission — any authenticated user may change their OWN password.
 * Shares the `auth` path prefix with AuthController (no route overlap).
 */
@Controller({ path: 'auth', version: '1' })
export class AccountController {
  constructor(private readonly passwordChange: PasswordChangeService) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.passwordChange.changePassword(req.principal!, body);
  }
}
