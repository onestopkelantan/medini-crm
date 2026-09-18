import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, eq, gte, isNull, lte, asc } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, ValidationError } from '../../../shared/errors/errors';
import { appointments } from '../../../infrastructure/database/schema';
import { CalendarEvent, toIcs, toCsv, parseLocalDateTime } from '../../../shared/export/calendar-export.util';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const querySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  branchId: z.string().uuid().optional(),
  format: z.enum(['ics', 'csv']).default('ics'),
});

export interface ExportPayload {
  content: string;
  mimeType: string;
  filename: string;
}

/**
 * AppointmentsExportService — export appointments as an iCalendar (.ics) feed
 * or CSV over a date range. Read-only, branch-scoped (hq = all, others = own).
 */
@Injectable()
export class AppointmentsExportService {
  constructor(private readonly dbCtx: DbContextService) {}

  private readBranch(p: Principal): string | null {
    if (p.role === 'hq') return null;
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  async export(principal: Principal, rawQuery: Record<string, unknown>): Promise<ExportPayload> {
    const parsed = querySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ValidationError(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])));
    }
    const q = parsed.data;
    const branchId = this.readBranch(principal);

    const rows = (await this.dbCtx.runAs(principal, (tx) => {
      const c = [eq(appointments.orgId, principal.orgId), isNull(appointments.deletedAt)];
      if (branchId) c.push(eq(appointments.branchId, branchId));
      if (q.from) c.push(gte(appointments.scheduledDate, q.from));
      if (q.to) c.push(lte(appointments.scheduledDate, q.to));
      return tx.select().from(appointments).where(and(...c))
        .orderBy(asc(appointments.scheduledDate), asc(appointments.scheduledTime));
    })) as Array<typeof appointments.$inferSelect>;

    if (q.format === 'csv') {
      const csvRows = rows.map((a) => ({
        code: a.code, date: a.scheduledDate, time: a.scheduledTime,
        durationMin: a.durationMin, patient: a.patientName,
        doctorId: a.doctorId ?? '', status: a.status, notes: a.notes ?? '',
      }));
      return {
        content: toCsv(csvRows, ['code', 'date', 'time', 'durationMin', 'patient', 'doctorId', 'status', 'notes']),
        mimeType: 'text/csv; charset=utf-8',
        filename: 'appointments.csv',
      };
    }

    const events: CalendarEvent[] = rows.map((a) => {
      const start = parseLocalDateTime(a.scheduledDate, a.scheduledTime);
      const end = new Date(start.getTime() + (a.durationMin ?? 30) * 60_000);
      return {
        uid: `appt-${a.id}@medini`,
        summary: a.treatmentRef ? `${a.patientName} — ${a.treatmentRef}` : a.patientName,
        description: `Ref ${a.code} · status ${a.status}${a.notes ? ` · ${a.notes}` : ''}`,
        start, end,
      };
    });
    return { content: toIcs(events, 'Medini Appointments'), mimeType: 'text/calendar; charset=utf-8', filename: 'appointments.ics' };
  }
}
