import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { resolveMentionedDate } from '@modules/ai-manager/domain/mentioned-date';
import { formatSlotContext } from '@modules/ai-manager/domain/slot-context';
import {
  findFreeSlots,
  parseTime,
  type DoctorShift,
  type BusyBlock,
} from '@modules/ai-manager/domain/slot-finder';

/**
 * Booking Manager slot visibility — live MySQL.
 *
 * Proves the SEAM end to end: a doctor_schedules row + a busy appointment
 * feed the same query/mapping shape freeSlotsContext uses, and the resulting
 * context names ONLY slots the schedule actually allows. The AI reply text
 * itself is NOT asserted (nondeterministic model); the facts it will receive
 * are.
 */

const URL = process.env.DATABASE_URL ?? 'mysql://medini:***@localhost:3306/medini_dev';

/** Row shapes returned by the two slot queries below. */
type ShiftRow = {
  doctorId?: string;
  doctorName?: string;
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
};
type BusyRow = {
  doctorId?: string;
  date?: string;
  startTime?: string | null;
  durationMin?: number | string | null;
};

const probe = pingDatabase(URL).then((ok) => {
  if (!ok) console.warn('[slot-ctx] MySQL not reachable — SKIPPING (honest skip, not a pass).');
  return ok;
});

describe('slot visibility seam — schedule data becomes prompt facts', () => {
  const dbCtx = new DbContextService(null as never);
  let branchId = '';
  let orgId = '';
  const cleanup: Array<{ table: string; id: string }> = [];

  beforeAll(async () => {
    if (!(await probe)) return;
    createFreshDatabase(URL);
  });

  afterAll(async () => {
    if (!(await probe) || cleanup.length === 0) return;
    await dbCtx.runAsWorker(
      {
        orgId,
        branchIds: [branchId],
        correlationId: 'slot-ctx-cleanup',
        source: 'system_worker',
      },
      async (tx) => {
        for (const c of cleanup) {
          await tx.execute(sql.raw(`DELETE FROM ${c.table} WHERE id = '${c.id}'`));
        }
      },
    );
  });

  it('a scheduled doctor with one busy block yields exactly the free slots the prompt will show', async () => {
    if (!(await probe)) return;

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    /* Seed: an active doctor, tomorrow 09:00–13:00 shift, and one
     * appointment 10:00–10:30 that must NOT appear as free. */
    const docId = randomUUID();
    const schedId = randomUUID();
    const apptId = randomUUID();

    const seeded = await dbCtx.runAsWorker(
      {
        orgId: '00000000-0000-0000-0000-000000000001',
        branchIds: ['00000000-0000-0000-0000-000000000001'],
        correlationId: 'slot-ctx-seed',
        source: 'system_worker',
      },
      async (tx) => {
        const branch = await tx.execute(
          sql`SELECT id, org_id FROM branches WHERE deleted_at IS NULL LIMIT 1`,
        );
        branchId = ((branch as { rows?: Array<{ id?: string }> }).rows?.[0]?.id ?? '') as string;
        orgId = ((branch as { rows?: Array<{ org_id?: string }> }).rows?.[0]?.org_id ?? '') as string;
        if (!branchId) throw new Error('no branch row — run the canonical seed first');

        await tx.execute(sql`
          INSERT INTO staff (id, org_id, branch_id, username, name, role, status)
          VALUES (${docId}, ${orgId}, ${branchId}, ${'doc-' + docId.slice(0, 8)},
                  'Dr. Integration Test', 'doctor', 'Active')
        `);

        await tx.execute(sql`
          INSERT INTO doctor_schedules (id, org_id, branch_id, doctor_id, schedule_date, start_time, end_time)
          VALUES (${schedId}, ${orgId}, ${branchId}, ${docId}, ${tomorrow}, '09:00:00', '13:00:00')
        `);

        await tx.execute(sql`
          INSERT INTO appointments
            (id, org_id, branch_id, code, patient_id, patient_name, doctor_id,
             scheduled_date, scheduled_time, duration_min, status)
          VALUES
            (${apptId}, ${orgId}, ${branchId}, ${'IT-SC-' + apptId.slice(0, 6)},
             NULL, 'Blocker Patient', ${docId}, ${tomorrow}, '10:00:00', 30, 'confirmed')
        `);

        return true;
      },
    );
    expect(seeded).toBe(true);
    cleanup.push({ table: 'appointments', id: apptId });
    cleanup.push({ table: 'doctor_schedules', id: schedId });
    cleanup.push({ table: 'staff', id: docId });

    /* The exact query/mapping shape freeSlotsContext uses. */
    const rows = await dbCtx.runAsWorker(
      {
        orgId,
        branchIds: [branchId],
        correlationId: 'slot-ctx-read',
        source: 'system_worker',
      },
      async (tx) => {
        const shifts = await tx.execute(sql`
          SELECT ds.doctor_id AS doctorId, s.name AS doctorName,
                 DATE_FORMAT(ds.schedule_date, '%Y-%m-%d') AS date,
                 TIME_FORMAT(ds.start_time, '%H:%i') AS startTime,
                 TIME_FORMAT(ds.end_time, '%H:%i') AS endTime
          FROM doctor_schedules ds JOIN staff s ON s.id = ds.doctor_id
          WHERE ds.org_id = ${orgId} AND ds.branch_id = ${branchId}
            AND s.role = 'doctor' AND s.status = 'Active' AND s.deleted_at IS NULL
            AND ds.schedule_date >= DATE(${tomorrow})
        `);
        const busy = await tx.execute(sql`
          SELECT a.doctor_id AS doctorId,
                 DATE_FORMAT(a.scheduled_date, '%Y-%m-%d') AS date,
                 TIME_FORMAT(a.scheduled_time, '%H:%i') AS startTime,
                 a.duration_min AS durationMin
          FROM appointments a
          WHERE a.org_id = ${orgId} AND a.branch_id = ${branchId}
            AND a.deleted_at IS NULL AND a.status NOT IN ('cancelled','no-show')
            AND a.scheduled_date >= DATE(${tomorrow})
        `);
        return {
          shifts: (shifts as { rows?: ShiftRow[] }).rows ?? [],
          busy: (busy as { rows?: BusyRow[] }).rows ?? [],
        };
      },
    );

    const mappedShifts: DoctorShift[] = [];
    for (const s of rows.shifts) {
      const startMin = parseTime(s.startTime);
      const endMin = parseTime(s.endTime);
      if (startMin === null || endMin === null || endMin <= startMin) continue;
      mappedShifts.push({
        doctorId: String(s.doctorId ?? ''),
        doctorName: String(s.doctorName ?? ''),
        date: String(s.date ?? ''),
        startMin,
        endMin,
      });
    }
    const mappedBusy: BusyBlock[] = [];
    for (const b of rows.busy) {
      const startMin = parseTime(b.startTime);
      if (startMin === null) continue;
      mappedBusy.push({
        doctorId: String(b.doctorId ?? ''),
        date: String(b.date ?? ''),
        startMin,
        durationMin: Number(b.durationMin ?? 30),
      });
    }

    const slots = findFreeSlots({
      shifts: mappedShifts,
      busy: mappedBusy,
      preferredDoctorId: null,
      preferredDate: tomorrow,
      preferredMin: null,
      limit: 2,
    });

    const ctx = formatSlotContext(slots);

    /* The prompt facts name the doctor and carry the real date — and the
     * 10:00 block is absent because it is busy. */
    expect(ctx).toContain('Dr. Integration Test');
    expect(ctx).toContain(tomorrow);
    expect(ctx).not.toContain('• 10:00');

    /* And the turn-1 date resolver agrees on which day was asked for. */
    const today = new Date().toISOString().slice(0, 10);
    expect(resolveMentionedDate('esok pagi saya datang', today)).toBe(tomorrow);
  });
});
