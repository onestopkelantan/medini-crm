import { Body, Controller, Post, Query, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { WhatsappPlaygroundService } from '../application/whatsapp-playground.service';

/**
 * Playground — uji prompt dengan LLM sebenar.
 *
 * Tiada mesej dihantar ke WhatsApp dan tiada perbualan dicipta; ini ujian
 * tertutup supaya operator nampak jawapan sebenar sebelum prompt diaktifkan.
 */
@Controller({
  path: 'whatsapp/playground',
  version: '1',
})
export class WhatsappPlaygroundController {
  constructor(private readonly service: WhatsappPlaygroundService) {}

  @Post('test')
  @RequirePermission('whatsapp', 'edit')
  test(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.test(req.principal!, body, branchId);
  }
}
