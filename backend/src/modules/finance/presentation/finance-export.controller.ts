import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { FinanceExportService } from '../application/finance-export.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/** Minimal response shape — avoids an @types/express dependency. */
interface HttpRes {
  setHeader(name: string, value: string): void;
  send(body: string): unknown;
}

/**
 * FinanceExportController — GET /finance/calendar/export (ics|csv).
 * Shares the `finance` prefix with the other finance controllers (no overlap).
 */
@Controller({ path: 'finance', version: '1' })
export class FinanceExportController {
  constructor(private readonly service: FinanceExportService) {}

  @Get('calendar/export')
  @RequirePermission('finance', 'view')
  async export(@Req() req: AuthedRequest, @Res() res: HttpRes, @Query() query: Record<string, unknown>) {
    const out = await this.service.export(req.principal!, query);
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.content);
  }
}
