import { Controller, Get, Query, Req } from '@nestjs/common';
import { ReportsService } from '../application/reports.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/** S9 — Reports read endpoints. GET only (read-only domain contract).
 * Scope is server-derived from the authenticated principal — there is NO
 * branchId query parameter by design (AD-6). */
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('kpis')
  @RequirePermission('reports', 'view')
  kpis(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.kpis(req.principal!, period);
  }

  @Get('revenue-by-branch')
  @RequirePermission('reports', 'view')
  revenueByBranch(
    @Req() req: AuthedRequest,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.revenueByBranch(req.principal!, period, limit);
  }

  @Get('treatment-mix')
  @RequirePermission('reports', 'view')
  treatmentMix(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.treatmentMix(req.principal!, period);
  }

  @Get('appointment-trends')
  @RequirePermission('reports', 'view')
  appointmentTrends(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.appointmentTrends(req.principal!, period);
  }

  @Get('doctor-production')
  @RequirePermission('reports', 'view')
  doctorProduction(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.doctorProduction(req.principal!, period);
  }

  @Get('kpi-registry')
  @RequirePermission('reports', 'view')
  kpiRegistry(@Req() req: AuthedRequest) {
    return this.service.kpiRegistry(req.principal!);
  }
}
