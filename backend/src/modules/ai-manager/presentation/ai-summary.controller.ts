import { Controller, Param, Post, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { AiSummaryService } from '../application/ai-summary.service';

/**
 * AiSummaryController — POST /ai/conversations/:id/summarize.
 * Gated by `ai:view` (HQ + branch_manager; doctors have no AI/wa access).
 * Shares the `ai` path prefix with AiManagerController (no route overlap).
 */
@Controller({ path: 'ai', version: '1' })
export class AiSummaryController {
  constructor(private readonly service: AiSummaryService) {}

  @Post('conversations/:id/summarize')
  @RequirePermission('ai', 'view')
  summarize(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.summarize(req.principal!, id);
  }
}
