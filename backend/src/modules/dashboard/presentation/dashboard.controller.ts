import { Controller, Get, Req, Query } from '@nestjs/common';
import { DashboardService } from '../application/dashboard.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('context')
  @RequirePermission('dashboard', 'view')
  context(@Req() req: AuthedRequest, @Query('date') date: string) {
    /* date defaults to today (server-local) when omitted */
    const d = date ?? new Date().toISOString().slice(0, 10);
    return this.service.context(req.principal!, d);
  }
}
