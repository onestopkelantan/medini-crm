import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { AppointmentsExportService } from '../application/appointments-export.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/** Minimal response shape — avoids an @types/express dependency. */
interface HttpRes {
  setHeader(name: string, value: string): void;
  send(body: string): unknown;
}

/**
 * AppointmentsExportController — GET /appointments/export (ics|csv).
 * Shares the `appointments` prefix with AppointmentsController (no overlap).
 */
@Controller({ path: 'appointments', version: '1' })
export class AppointmentsExportController {
  constructor(private readonly service: AppointmentsExportService) {}

  @Get('export')
  @RequirePermission('appointments', 'view')
  async export(@Req() req: AuthedRequest, @Res() res: HttpRes, @Query() query: Record<string, unknown>) {
    const out = await this.service.export(req.principal!, query);
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.content);
  }
}
