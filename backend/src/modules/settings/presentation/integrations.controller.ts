import { Controller, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { IntegrationsService } from '../application/integrations.service';

/**
 * IntegrationsController — external-integration testing under /settings.
 * Gated by `settings:approve` (HQ-only, same tier as SecretRef management).
 * Shares the `settings` path prefix with SettingsController (no route overlap).
 */
@Controller({ path: 'settings', version: '1' })
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Post('integrations/:key/test')
  @RequirePermission('settings', 'approve')
  testIntegration(@Req() req: AuthedRequest, @Param('key') key: string) {
    return this.service.test(req.principal!, key);
  }
}
