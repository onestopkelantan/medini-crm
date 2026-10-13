import { Body, Controller, Post, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { ForbiddenError } from '../../../shared/errors/errors';
import { FinanceAiService } from '../application/finance-ai.service';

/**
 * Finance AI — Fasa D: collection escalation scan.
 *
 * POST /ai/finance/escalation/scan (HQ-only). Overdue installments become
 * DRAFTS in the approval queue; a human approves before anything is sent.
 * The agent must be enabled in AI Manager (policy gate inside the service).
 */
@Controller({ path: 'ai/finance/escalation', version: '1' })
export class FinanceAiController {
  constructor(private readonly financeAi: FinanceAiService) {}

  @Post('scan')
  @RequirePermission('ai', 'view')
  async scan(@Req() req: AuthedRequest, @Body() _body: unknown) {
    if (req.principal!.role !== 'hq') {
      throw new ForbiddenError('Finance AI escalation is restricted to HQ');
    }
    return this.financeAi.scanOverdue(req.principal!);
  }
}
