import { Body, Controller, Post, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { ForbiddenError } from '../../../shared/errors/errors';
import { AnalystService } from '../application/analyst.service';

/**
 * Data Analyst — ask a data question, get a grounded answer.
 *
 * HQ-ONLY, following the /nur/ask precedent: this surface exposes GROUP
 * financial figures through a model; that is at least as sensitive as raw
 * model configuration. Branch managers lose nothing — their scoped Reports
 * page already shows their own branch.
 */
@Controller({ path: 'ai/analyst', version: '1' })
export class AnalystController {
  constructor(private readonly analyst: AnalystService) {}

  @Post('ask')
  @RequirePermission('ai', 'view')
  async ask(@Req() req: AuthedRequest, @Body() body: { message?: string }) {
    if (req.principal!.role !== 'hq') {
      throw new ForbiddenError('Data Analyst is restricted to HQ');
    }
    const message = body?.message?.trim();
    if (!message) return { error: 'message required' };
    return this.analyst.ask(req.principal!, message);
  }
}
