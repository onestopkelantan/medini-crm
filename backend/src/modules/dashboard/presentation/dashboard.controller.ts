import { Controller, Get, Req, Query } from '@nestjs/common';
import { DashboardService } from '../application/dashboard.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /**
   * Wajah BRANCH — hari ini, cawangan sendiri.
   * Dipanggil oleh semua peranan; skop ditentukan server dari principal.
   */
  @Get('context')
  @RequirePermission('dashboard', 'view')
  context(@Req() req: AuthedRequest, @Query('date') date: string) {
    /* date defaults to today (server-local) when omitted */
    const d = date ?? new Date().toISOString().slice(0, 10);
    return this.service.context(req.principal!, d);
  }

  /**
   * Wajah HQ — panorama semua cawangan.
   *
   * HQ sahaja. Peranan lain mendapat ForbiddenError dari service, bukan
   * data kosong — senyap-senyap pulangkan kosong akan menyembunyikan
   * salah konfigurasi aliran masuk.
   */
  /** FASA 1G — lima kad nadi bisnes. HQ sahaja. */
  @Get('pulse')
  @RequirePermission('dashboard', 'view')
  pulse(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.pulse(req.principal!, period);
  }

  /** FASA 1F — siri jualan harian untuk graf trend. HQ sahaja. */
  @Get('revenue-trend')
  @RequirePermission('dashboard', 'view')
  revenueTrend(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.revenueTrend(req.principal!, period);
  }

  /** FASA 1F — aktiviti masa-nyata di semua cawangan. HQ sahaja. */
  @Get('live')
  @RequirePermission('dashboard', 'view')
  live(@Req() req: AuthedRequest) {
    return this.service.live(req.principal!);
  }

  @Get('overview')
  @RequirePermission('dashboard', 'view')
  overview(@Req() req: AuthedRequest, @Query('period') period?: string) {
    return this.service.overview(req.principal!, period);
  }
}
