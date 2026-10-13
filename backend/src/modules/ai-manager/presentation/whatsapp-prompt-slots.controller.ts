import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { WhatsappPromptSlotsService } from '../application/whatsapp-prompt-slots.service';

/**
 * Prompt slots — tiga versi prompt per cawangan, satu aktif.
 *
 * HQ dan pengurus cawangan sahaja (dikawal dalam service, bersama semakan
 * organisasi + RLS database).
 */
@Controller({
  path: 'whatsapp/prompt-slots',
  version: '1',
})
export class WhatsappPromptSlotsController {
  constructor(private readonly service: WhatsappPromptSlotsService) {}

  /** Semua slot (1–3) untuk satu cawangan. Slot kosong turut dipulangkan. */
  @Get()
  @RequirePermission('whatsapp', 'view')
  list(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.list(req.principal!, branchId);
  }

  /** Simpan satu slot. `version: 0` bermaksud slot baru. */
  @Put(':slot')
  @RequirePermission('whatsapp', 'edit')
  save(
    @Req() req: AuthedRequest,
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: unknown,
    @Query('branchId') branchId?: string,
  ) {
    const payload = { ...(body as Record<string, unknown>), slot };
    return this.service.save(req.principal!, payload, branchId);
  }

  /** Tandakan satu slot sebagai aktif (slot lain dinyahaktifkan). */
  /** Boss #3 — apply a built-in preset (slot 2 Santai / slot 3 Profesional). */
  @Post('presets/:slot/apply')
  applyPreset(
    @Req() req: AuthedRequest,
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { branchId?: string },
  ) {
    return this.service.applyPreset(req.principal!, slot, body?.branchId);
  }

  @Post(':slot/activate')
  @RequirePermission('whatsapp', 'edit')
  activate(
    @Req() req: AuthedRequest,
    @Param('slot', ParseIntPipe) slot: number,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.activate(req.principal!, slot, branchId);
  }

  /** Padam satu slot. Prompt aktif tidak boleh dipadam. */
  @Delete(':slot')
  @RequirePermission('whatsapp', 'edit')
  remove(
    @Req() req: AuthedRequest,
    @Param('slot', ParseIntPipe) slot: number,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.remove(req.principal!, slot, branchId);
  }

  /** Ambil satu slot untuk ujian Playground. */
  @Get(':slot')
  @RequirePermission('whatsapp', 'view')
  getOne(
    @Req() req: AuthedRequest,
    @Param('slot', ParseIntPipe) slot: number,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.getSlotForTest(req.principal!, slot, branchId);
  }
}
