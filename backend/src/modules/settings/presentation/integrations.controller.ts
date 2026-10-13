import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { IntegrationsService, IntegrationSetResult, IntegrationTestResult } from '../application/integrations.service';

/**
 * IntegrationsController — external-integration testing and configuration.
 * Gated by `settings:approve` (HQ-only, same tier as SecretRef management).
 * Shares the `settings` path prefix with SettingsController (no route overlap).
 */
@Controller({ path: 'settings', version: '1' })
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Post('integrations/:key/test')
  @RequirePermission('settings', 'approve')
  testIntegration(@Req() req: AuthedRequest, @Param('key') key: string): Promise<IntegrationTestResult> {
    return this.service.test(req.principal!, key);
  }

  /**
   * Set an integration API key. Writes to backend .env file.
   * The secret value is sent over HTTPS but NEVER stored in database.
   */
  @Post('integrations/:key/set')
  @RequirePermission('settings', 'approve')
  setIntegration(
    @Req() req: AuthedRequest,
    @Param('key') key: string,
    @Body() body: { value: string },
  ): Promise<IntegrationSetResult> {
    return this.service.set(req.principal!, key, body.value);
  }
}
