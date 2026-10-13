/**
 * Scrubbing rules controller — boss #4. Manager-facing endpoints:
 *
 *   GET  /marketing/scrubbing-rules?branchId=   — list (manager screen)
 *   PUT  /marketing/scrubbing-rules             — upsert one rule
 *   GET  /marketing/scrubbing-rules/due?branchId= — the scrubbing LIST
 *
 * HQ sees any branch; a manager is pinned to their own (service rule).
 */
import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';

import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { ScrubbingRulesService } from '../application/scrubbing-rules.service';

@Controller({ path: 'marketing/scrubbing-rules', version: '1' })
export class ScrubbingRulesController {
  constructor(private readonly service: ScrubbingRulesService) {}

  @Get()
  @RequirePermission('marketing', 'view')
  list(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.list(req.principal!, branchId);
  }

  @Put()
  @RequirePermission('marketing', 'edit')
  upsert(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.upsert(req.principal!, body);
  }

  /** The list boss asked for: patients due for scrubbing, by treatment. */
  @Get('due')
  @RequirePermission('marketing', 'view')
  due(@Req() req: AuthedRequest, @Query('branchId') branchId?: string, @Query('limit') limit?: string) {
    return this.service.due(req.principal!, branchId, Number(limit ?? 100));
  }
}
