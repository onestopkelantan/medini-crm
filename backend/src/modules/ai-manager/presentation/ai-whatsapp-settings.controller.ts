import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import {
  AiWhatsappSettingsService,
  planBlast,
} from '../application/ai-whatsapp-settings.service';

/**
 * Tetapan AI WhatsApp — anti-ban + eskalasi, per cawangan.
 *
 * Ditetapkan di sini (AI Manager). WhatsApp Hub membaca nilai yang sama.
 */
@Controller({
  path: 'ai/whatsapp-settings',
  version: '1',
})
export class AiWhatsappSettingsController {
  constructor(private readonly service: AiWhatsappSettingsService) {}

  @Get()
  @RequirePermission('ai', 'view')
  get(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.get(req.principal!, branchId);
  }

  @Put()
  @RequirePermission('ai', 'edit')
  save(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.save(req.principal!, body, branchId);
  }

  /**
   * Blast scheduling for a promotion.
   *
   * GET returns the saved envelope plus a live preview for the numbers the
   * operator typed, so the UI can show "100/day, one every 8 min 24s" without a
   * second round trip. The preview is clamped to a sane range because it arrives
   * from the query string.
   */
  @Get('blast')
  @RequirePermission('ai', 'view')
  async getBlast(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('recipients') recipients?: string,
    @Query('days') days?: string,
  ) {
    const settings = await this.service.get(req.principal!, branchId);

    const num = (raw: string | undefined, fallback: number, max: number) => {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : fallback;
    };

    const plan = planBlast(
      num(recipients, 1400, 1_000_000),
      Math.max(1, num(days, 14, 3650)),
      {
        windowStartHour: settings.blastWindowStartHour,
        windowEndHour: settings.blastWindowEndHour,
        maxBlastPerDay: settings.maxBlastPerDay,
      },
    );

    return { settings, plan };
  }

  /** Save the blast envelope (window hours, daily ceiling, gap band). */
  @Put('blast')
  @RequirePermission('ai', 'edit')
  saveBlast(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.saveBlast(req.principal!, body, branchId);
  }

  /** Read-only preview — never writes, so the UI can call it on every keystroke. */
  @Get('blast/preview')
  @RequirePermission('ai', 'view')
  previewBlast(
    @Req() req: AuthedRequest,
    @Query('recipients') recipients?: string,
    @Query('days') days?: string,
    @Query('branchId') branchId?: string,
  ) {
    const num = (raw: string | undefined, fallback: number, max: number) => {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : fallback;
    };

    return this.service.previewBlast(
      req.principal!,
      num(recipients, 0, 1_000_000),
      Math.max(1, num(days, 1, 3650)),
      branchId,
    );
  }
}
