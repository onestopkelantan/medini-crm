import { Injectable } from '@nestjs/common';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import {
  appointments, Appointment,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';

export interface CreateAppointmentInput {
  code: string;
  patientId: string | null;
  patientName: string;
  doctorId?: string | null;
  treatmentRef?: string | null;
  scheduledDate: string;
  scheduledTime: string;
  durationMin?: number;
  notes?: string | null;
}

/**
 * AppointmentsRepository — stateless data access (tx-first, same discipline as
 * PatientsRepository). The caller passes the runAs() transaction so RLS scope
 * applies to every query.
 */
@Injectable()
export class AppointmentsRepository {
  async create(tx: DbClient, orgId: string, branchId: string, input: CreateAppointmentInput): Promise<Appointment> {
    try {
      const rows = await tx
        .insert(appointments)
        .values({
          orgId,
          branchId,
          code: input.code,
          patientId: input.patientId ?? null,
          patientName: input.patientName.trim(),
          doctorId: input.doctorId ?? null,
          treatmentRef: input.treatmentRef ?? null,
          scheduledDate: input.scheduledDate,
          scheduledTime: input.scheduledTime,
          durationMin: input.durationMin ?? 30,
          notes: input.notes ?? null,
          status: 'booked',
          version: 1,
        })
        .returning();
      return rows[0]!;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async findById(tx: DbClient, orgId: string, id: string): Promise<Appointment | null> {
    const rows = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.orgId, orgId), eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** S10 T1: paginated list with optional filters. branchId=null → org-wide (HQ). */
  async list(
    tx: DbClient, orgId: string, branchId: string | null,
    filters: { branchId?: string | null; dateFrom?: string | null; dateTo?: string | null; status?: string | null; limit: number; offset: number },
  ): Promise<Appointment[]> {
    const conds = [eq(appointments.orgId, orgId), isNull(appointments.deletedAt)];
    if (branchId) conds.push(eq(appointments.branchId, branchId));
    if (filters.branchId) conds.push(eq(appointments.branchId, filters.branchId));
    if (filters.dateFrom) conds.push(sql`${appointments.scheduledDate} >= ${filters.dateFrom}`);
    if (filters.dateTo) conds.push(sql`${appointments.scheduledDate} <= ${filters.dateTo}`);
    if (filters.status) conds.push(eq(appointments.status, filters.status as never));
    return tx.select().from(appointments)
      .where(and(...conds))
      .orderBy(appointments.scheduledDate, appointments.scheduledTime)
      .limit(filters.limit).offset(filters.offset);
  }

  /* nextCode removed — use OrgAllocator (org-safe, concurrency-safe). */

  /**
   * Double-booking protection: another appointment for the SAME doctor with
   * OVERLAPPING time on the SAME date → conflict (409). Time strings 'HH:MM'
   * compare lexicographically (zero-padded) so overlap = start < otherEnd &&
   * end > otherStart. Only non-terminal rows count.
   */
  async findDoctorOverlap(
    tx: DbClient,
    orgId: string,
    branchId: string,
    doctorId: string,
    date: string,
    start: string,
    durationMin: number,
    excludeId?: string,
  ): Promise<Appointment | null> {
    const end = endTime(start, durationMin);
    const rows = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.orgId, orgId),
          eq(appointments.branchId, branchId),
          eq(appointments.doctorId, doctorId),
          eq(appointments.scheduledDate, date),
          isNull(appointments.deletedAt),
          sql`${appointments.scheduledTime}::time < ${end}::time`,
          sql`${endTimeExpr(appointments.scheduledTime, appointments.durationMin)} > ${start}::time`,
          sql`${appointments.status} NOT IN ('completed','cancelled','no-show')`,
          excludeId ? sql`${appointments.id} <> ${excludeId}` : sql`true`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async updateStatus(
    tx: DbClient, orgId: string, id: string, status: string, expectedVersion: number,
  ): Promise<Appointment | null> {
    const rows = await tx
      .update(appointments)
      .set({ status: status as Appointment['status'], version: expectedVersion + 1 })
      .where(
        and(
          eq(appointments.orgId, orgId),
          eq(appointments.id, id),
          eq(appointments.version, expectedVersion),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async reschedule(
    tx: DbClient,
    orgId: string,
    id: string,
    input: { scheduledDate: string; scheduledTime: string; durationMin: number },
    expectedVersion: number,
  ): Promise<Appointment | null> {
    const rows = await tx
      .update(appointments)
      .set({
        scheduledDate: input.scheduledDate,
        scheduledTime: input.scheduledTime,
        durationMin: input.durationMin,
        version: expectedVersion + 1,
      })
      .where(
        and(
          eq(appointments.orgId, orgId),
          eq(appointments.id, id),
          eq(appointments.version, expectedVersion),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Day queue: active statuses ordered by scheduled time then creation. */
  async dayQueue(
    tx: DbClient, orgId: string, branchId: string, date: string,
  ): Promise<Appointment[]> {
    return tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.orgId, orgId),
          eq(appointments.branchId, branchId),
          eq(appointments.scheduledDate, date),
          isNull(appointments.deletedAt),
          inArray(appointments.status, QUEUE_ACTIVE),
        ),
      )
      .orderBy(sql`${appointments.scheduledTime}::time ASC`, appointments.createdAt);
  }
}

const QUEUE_ACTIVE: Appointment['status'][] = ['checked-in', 'waiting', 'called', 'in-progress'];

function endTime(start: string, durationMin: number): string {
  const [hh, mm] = start.split(':').map(Number);
  const h = hh ?? 0;
  const m = mm ?? 0;
  const total = h * 60 + m + durationMin;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

/** SQL expression for start + duration of a row. */
function endTimeExpr(colStart: unknown, colDuration: unknown) {
  return sql`((${colStart})::time + (${colDuration})::int * interval '1 minute')`;
}
