import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, ValidationError } from '../../../shared/errors/errors';
import { doctorSchedules, staff } from '../../../infrastructure/database/schema';

const scheduleSchema = z.object({
  doctorId: z.string().uuid().nullish(),
  doctorName: z.string().trim().min(2).max(256).nullish(),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notes: z.string().max(1000).nullish(),
});

@Injectable()
export class DoctorScheduleService {
  private readonly logger = new Logger(DoctorScheduleService.name);

  constructor(private readonly dbCtx: DbContextService) {}

  async list(principal: Principal) {
    const branchId = this.branch(principal);
    try {
      return await this.dbCtx.runAs(principal, async (tx) => tx
        .select({
          id: doctorSchedules.id,
          scheduleDate: doctorSchedules.scheduleDate,
          startTime: doctorSchedules.startTime,
          endTime: doctorSchedules.endTime,
          notes: doctorSchedules.notes,
          doctorName: staff.name,
        })
        .from(doctorSchedules)
        .innerJoin(staff, eq(doctorSchedules.doctorId, staff.id))
        .where(and(
          eq(doctorSchedules.orgId, principal.orgId),
          eq(doctorSchedules.branchId, branchId),
        ))
        .orderBy(asc(doctorSchedules.scheduleDate), asc(doctorSchedules.startTime)));
    } catch (error) {
      this.logger.error(`doctor schedule list failed: ${this.errorText(error)}`);
      throw error;
    }
  }

  async create(principal: Principal, raw: unknown) {
    const parsed = scheduleSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
    if (parsed.data.endTime <= parsed.data.startTime) {
      throw new ValidationError({ endTime: ['endTime must be after startTime'] });
    }
    const branchId = this.branch(principal);

    try {
      return await this.dbCtx.runAs(principal, async (tx) => {
        let doctorId = parsed.data.doctorId ?? null;
        if (!doctorId && parsed.data.doctorName) {
          const name = parsed.data.doctorName.toUpperCase();
          const doctors = await tx.select().from(staff).where(and(
            eq(staff.orgId, principal.orgId),
            eq(staff.role, 'doctor'),
          ));
          const doctor = doctors.find((row) => name === 'DR HANI'
            ? row.username === 'farhanimzln' || row.name.toUpperCase().includes('FARHANI')
            : row.name.toUpperCase().includes(name.replace(/^DR\s+/, '')));
          doctorId = doctor?.id ?? null;
        }
        if (!doctorId) throw new ValidationError({ doctorId: ['Doctor not found'] });
        const rows = await tx.insert(doctorSchedules).values({
          orgId: principal.orgId,
          branchId,
          doctorId,
          scheduleDate: parsed.data.scheduleDate,
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
          notes: parsed.data.notes ?? null,
        }).returning();
        return rows[0];
      });
    } catch (error) {
      this.logger.error(`doctor schedule create failed: ${this.errorText(error)}`);
      throw error;
    }
  }

  private errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private branch(principal: Principal): string {
    if (principal.role !== 'branch_manager') {
      throw new ForbiddenError('Only branch managers can manage doctor schedules');
    }
    if (!principal.branchId) throw new ForbiddenError('No branch context — access denied');
    return principal.branchId;
  }
}
