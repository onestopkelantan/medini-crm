import { Controller, Get, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { AiModelSettingsService } from '../application/ai-model-settings.service';

/**
 * Tetapan model AI — status sahaja, bukan kunci.
 *
 * UI perlu tahu sama ada AI sudah boleh menjawab. Ia TIDAK perlu — dan tidak
 * sepatutnya — memegang kunci API. Governance G9: nilai rahsia tidak pernah
 * disimpan atau dipaparkan; hanya status dan nama pemboleh ubah.
 */
@Controller({
  path: 'ai/whatsapp-model',
  version: '1',
})
export class AiModelSettingsController {
  constructor(private readonly service: AiModelSettingsService) {}

  @Get()
  @RequirePermission('ai', 'view')
  get(@Req() req: AuthedRequest) {
    return this.service.get(req.principal!);
  }
}
