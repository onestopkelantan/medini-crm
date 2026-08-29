/* Booking requests - admin reads WhatsApp booking intake (RLS-scoped). */
import { Body, Controller, Get, Param, Patch, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { DbContextService } from '../../../core/auth/db-context.service';

@Controller({ path: 'booking-requests', version: '1' })
export class BookingRequestsController {
  constructor(private readonly dbCtx: DbContextService) {}

  @Get()
  @RequirePermission('appointments', 'view')
  async list(@Req() req: AuthedRequest, @Query('status') status?: string) {
    const st = status && ['pending', 'confirmed', 'rejected'].includes(status) ? status : null;
    return this.dbCtx.runAs(req.principal!, async (tx) => {
      const rows = st
        ? await tx.execute(sql`
            SELECT id, contact_phone, patient_name, preferred_date, preferred_time, treatment, branch_name, raw_message, status, created_at
            FROM booking_requests WHERE status = ${st} ORDER BY created_at DESC LIMIT 100`)
        : await tx.execute(sql`
            SELECT id, contact_phone, patient_name, preferred_date, preferred_time, treatment, branch_name, raw_message, status, created_at
            FROM booking_requests ORDER BY created_at DESC LIMIT 100`);
      return (rows as unknown as { rows: unknown[] }).rows;
    });
  }

  @Patch(':id/status')
  @RequirePermission('appointments', 'edit')
  async changeStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: { status?: string }) {
    const status = body?.status;
    if (!status || !['pending', 'confirmed', 'rejected'].includes(status)) {
      return { error: 'invalid status' };
    }
    return this.dbCtx.runAs(req.principal!, async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE booking_requests SET status = ${status}, updated_at = now()
        WHERE id = ${id} RETURNING id, status`);
      return (rows as unknown as { rows: unknown[] }).rows[0] ?? { error: 'not found' };
    });
  }
}
