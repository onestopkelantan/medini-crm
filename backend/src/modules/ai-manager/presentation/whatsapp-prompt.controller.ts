import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { WhatsappPromptService } from '../application/whatsapp-prompt.service';

/**
 * Tetapan prompt WhatsApp mengikut cawangan.
 *
 * Permission WhatsApp diperiksa pada endpoint.
 * Service mengehadkan pengurusan kepada HQ dan
 * pengurus cawangan, bersama semakan organisasi,
 * cawangan dan RLS database.
 */
@Controller({
  path: 'whatsapp/prompt',
  version: '1',
})
export class WhatsappPromptController {
  constructor(
    private readonly service: WhatsappPromptService,
  ) {}

  @Get()
  @RequirePermission('whatsapp', 'view')
  getPrompt(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.get(
      req.principal!,
      branchId,
    );
  }

  @Put()
  @RequirePermission('whatsapp', 'edit')
  savePrompt(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.save(
      req.principal!,
      body,
      branchId,
    );
  }
}