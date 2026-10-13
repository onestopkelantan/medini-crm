import { Controller, Get, Query, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { ForbiddenError } from '../../../shared/errors/errors';
import { InsightsService } from '../application/insights.service';

/**
 * Insights scan — proactive, deterministic cards (Phase C).
 *
 * HQ-ONLY, same as the analyst endpoint: group figures + cross-branch
 * comparisons. The response is COMPUTED cards (no model call) — the model
 * may narrate them later, but it never decides what counts as an insight.
 */
@Controller({ path: 'ai/insights', version: '1' })
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('scan')
  @RequirePermission('ai', 'view')
  async scan(@Req() req: AuthedRequest, @Query('period') period?: string) {
    if (req.principal!.role !== 'hq') {
      throw new ForbiddenError('Insights scan is restricted to HQ');
    }
    return this.insights.scan(req.principal!, period);
  }
}
