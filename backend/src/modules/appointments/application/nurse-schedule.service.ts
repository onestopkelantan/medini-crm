import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ValidationError } from '../../../shared/errors/errors';
import { branches as branchesTable, nurseSchedules, staff } from '../../../infrastructure/database/schema';

const nurseScheduleSchema = z.object({
  nurseId: z.string().uuid(),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notes: z.string().max(1000).nullish(),
});

/**
 * Nurse Schedule — permintaan pemilik 10 Okt: "Buatkan Nurse Schedule
 * dibawah navigationya Doctor Schedule dengan konsep yang sama".
 *
 * Konsep SAMA seperti DoctorScheduleService (skop baca HQ semua cawangan /
 * manager cawangan sendiri; tulis oleh role cawangan; slot unik per
 * org+cawangan+perawat+tarikh+masa), tetapi:
 *   - staf sasaran mesti berperanan 'nurse' (bukan 'doctor'), dan
 *   - 'atas nama' tidak diperlukan: slot perawat tidak membawa maksud
 *     klinikal seperti sesi doktor, jadi HQ pun boleh mencipta slot
 *     operasi terus untuk mana-mana cawangan.
 */
@Injectable()
export class NurseScheduleService {
  private readonly logger = new Logger(NurseScheduleService.name);

  constructor(private readonly dbCtx: DbContextService) {}

  private readBranches(principal: Principal, requested?: string): string[] | null {
    if (principal.role === 'hq') {
      return requested ? [requested] : null;
    }
    return [this.branch(principal)];
  }

  /** Cabang operasi untuk tulisan: HQ mesti nyatakan cabang sasaran. */
  private writeBranch(principal: Principal, requested?: string): string {
    if (principal.role === 'hq') {
      if (!requested) {
        throw new ValidationError({
          branchId: ['HQ mesti memilih cawangan (branchId) untuk jadual ini'],
        });
      }
      return requested;
    }
    return this.branch(principal);
  }

  private branch(principal: Principal): string {
    if (!principal.branchId) {
      throw new ValidationError({ branchId: ['No branch context - access denied'] });
    }
    return principal.branchId;
  }

  async list(principal: Principal, requestedBranchId?: string) {
    const branches = this.readBranches(principal, requestedBranchId);
    return this.dbCtx.runAs(principal, async (tx) =>
      tx
        .select({
          id: nurseSchedules.id,
          nurseId: nurseSchedules.nurseId,
          branchId: nurseSchedules.branchId,
          branchName: branchesTable.shortName,
          scheduleDate: nurseSchedules.scheduleDate,
          startTime: nurseSchedules.startTime,
          endTime: nurseSchedules.endTime,
          notes: nurseSchedules.notes,
          nurseName: staff.name,
        })
        .from(nurseSchedules)
        .innerJoin(staff, eq(nurseSchedules.nurseId, staff.id))
        .leftJoin(branchesTable, eq(nurseSchedules.branchId, branchesTable.id))
        .where(
          and(
            eq(nurseSchedules.orgId, principal.orgId),
            branches ? inArray(nurseSchedules.branchId, branches) : undefined,
          ),
        )
        .orderBy(asc(nurseSchedules.scheduleDate), asc(nurseSchedules.startTime)),
    );
  }

  /** Senarai staf perawat utk pemilih UI (skop sama seperti list). */
  async listNurses(principal: Principal, requestedBranchId?: string) {
    const branches = this.readBranches(principal, requestedBranchId);
    return this.dbCtx.runAs(principal, async (tx) =>
      tx
        .select({ id: staff.id, name: staff.name, branchId: staff.branchId })
        .from(staff)
        .where(
          and(
            eq(staff.orgId, principal.orgId),
            eq(staff.role, 'nurse'),
            branches ? inArray(staff.branchId, branches) : undefined,
          ),
        )
        .orderBy(asc(staff.name)),
    );
  }

  async create(principal: Principal, raw: unknown) {
    const parsed = nurseScheduleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.flatten().fieldErrors);
    }
    if (parsed.data.endTime <= parsed.data.startTime) {
      throw new ValidationError({ endTime: ['endTime must be after startTime'] });
    }

    const branchId = this.writeBranch(principal, (raw as { branchId?: string })?.branchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Staf mesti benar-benar perawat cawangan itu - slot untuk doktor
       * tidak berfungsi di sini dan sebaliknya. */
      const nurse = await tx
        .select({ id: staff.id, branchId: staff.branchId, role: staff.role })
        .from(staff)
        .where(and(eq(staff.id, parsed.data.nurseId), eq(staff.orgId, principal.orgId)))
        .limit(1);
      if (!nurse[0] || nurse[0].role !== 'nurse') {
        throw new ValidationError({ nurseId: ['Staf ini bukan perawat (role nurse)'] });
      }

      /* Slot duplikasi = diam-diam idempoten, seperti jadual doktor. */
      const existing = await tx
        .select({ id: nurseSchedules.id })
        .from(nurseSchedules)
        .where(
          and(
            eq(nurseSchedules.orgId, principal.orgId),
            eq(nurseSchedules.branchId, branchId),
            eq(nurseSchedules.nurseId, parsed.data.nurseId),
            eq(nurseSchedules.scheduleDate, parsed.data.scheduleDate),
            eq(nurseSchedules.startTime, parsed.data.startTime),
            eq(nurseSchedules.endTime, parsed.data.endTime),
          ),
        )
        .limit(1);
      if (existing[0]) return existing[0];

      const rows = await tx
        .insert(nurseSchedules)
        .values({
          orgId: principal.orgId,
          branchId,
          nurseId: parsed.data.nurseId,
          scheduleDate: parsed.data.scheduleDate,
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
          notes: parsed.data.notes ?? null,
        })
        .$returningId();
      const id = rows[0]?.id;
      if (!id) return null;
      const created = await tx
        .select()
        .from(nurseSchedules)
        .where(eq(nurseSchedules.id, id))
        .limit(1);
      return created[0] ?? null;
    });
  }

  async remove(principal: Principal, id: string) {
    if (!z.string().uuid().safeParse(id).success) {
      throw new ValidationError({ id: ['Invalid schedule id'] });
    }
    return this.dbCtx.runAs(principal, async (tx) => {
      const row = await tx
        .select()
        .from(nurseSchedules)
        .where(and(eq(nurseSchedules.id, id), eq(nurseSchedules.orgId, principal.orgId)))
        .limit(1);
      if (!row[0]) return null;
      if (principal.role !== 'hq') {
        this.branch(principal);
        if (row[0].branchId !== principal.branchId) return null;
      }
      await tx.delete(nurseSchedules).where(eq(nurseSchedules.id, id));
      return row[0];
    });
  }
}
