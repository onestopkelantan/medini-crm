import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { WaOptOutService } from '../application/wa-opt-out.service';

/**
 * Senarai STOP — pesakit yang meminta berhenti menerima mesej.
 *
 * The operator must be able to SEE this list, not just have it enforced
 * silently: "why did this patient not get the campaign?" is a question the
 * screen answers, and a manual addition (a phone complaint, a wrong number)
 * needs somewhere to go.
 */
@Controller({ path: 'whatsapp/opt-outs', version: '1' })
export class WaOptOutController {
  constructor(private readonly service: WaOptOutService) {}

  /** The list, newest first. Includes revoked entries so history is visible. */
  @Get()
  @RequirePermission('whatsapp', 'view')
  list(@Req() req: AuthedRequest) {
    return this.service.list(req.principal!);
  }

  /** Count only — for the Hub badge. */
  @Get('count')
  @RequirePermission('whatsapp', 'view')
  async count(@Req() req: AuthedRequest) {
    return { count: await this.service.count(req.principal!) };
  }

  /** Staff-added block (a complaint received by phone, a wrong number). */
  @Post()
  @RequirePermission('whatsapp', 'edit')
  add(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.recordManual(req.principal!, body);
  }

  /**
   * Lift a block, only when the patient asks to receive messages again.
   * Revoked rather than deleted, so the history survives.
   */
  @Delete(':id')
  @RequirePermission('whatsapp', 'edit')
  revoke(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.revoke(req.principal!, id);
  }
}
