import { describe, it, expect } from 'vitest';

import {
  planReminder, dueWindow, reminderMessage,
  H8_HOURS_MS, LATE_BOOKING_GRACE_MS, BATCH_LIMIT,
} from '@modules/appointments/domain/h8-reminder';

/**
 * E6 — the H-8 policy. One reminder, eight hours before, in the clinic's
 * voice. Late bookings get grace, dead appointments get nothing, a tick
 * claims a bounded batch.
 */

const NOW = new Date('2026-10-10T08:00:00+08:00').getTime();
const appt = (over: Partial<{ status: string; start: number | null }> = {}) => ({
  status: 'booked', start: NOW + 24 * 60 * 60 * 1000, ...over,
});

describe('planReminder', () => {
  it('schedules a reminder exactly 8 hours before the appointment', () => {
    const v = planReminder(appt(), NOW);
    expect(v.kind).toBe('schedule');
    if (v.kind === 'schedule') {
      expect(v.scheduledFor.getTime()).toBe(NOW + 24 * 60 * 60 * 1000 - H8_HOURS_MS);
    }
  });

  it('a booking made INSIDE the 8h window is reminded at now+15min, never in the past', () => {
    const v = planReminder(appt({ start: NOW + 2 * 60 * 60 * 1000 }), NOW);
    expect(v.kind).toBe('schedule');
    if (v.kind === 'schedule') {
      expect(v.scheduledFor.getTime()).toBe(NOW + LATE_BOOKING_GRACE_MS);
    }
  });

  it('cancelled / no-show / completed appointments never remind', () => {
    expect(planReminder(appt({ status: 'cancelled' }), NOW)).toEqual({ kind: 'skip', reason: 'cancelled' });
    expect(planReminder(appt({ status: 'no-show' }), NOW)).toEqual({ kind: 'skip', reason: 'cancelled' });
    expect(planReminder(appt({ status: 'completed' }), NOW)).toEqual({ kind: 'skip', reason: 'completed' });
  });

  it('an appointment without a start cannot be planned', () => {
    expect(planReminder(appt({ start: null }), NOW)).toEqual({ kind: 'skip', reason: 'no_start' });
  });
});

describe('dueWindow', () => {
  const rows = (times: number[]) => times.map((t, i) => ({
    id: `r${i}`, scheduledFor: new Date(t),
  }));

  it('claims only rows whose time has come, oldest first', () => {
    const due = dueWindow(rows([NOW - 50, NOW + 100, NOW - 10, NOW + 999]), NOW);
    expect(due.map((r) => r.id)).toEqual(['r0', 'r2']);
  });

  it('caps the batch at BATCH_LIMIT', () => {
    const many = rows(Array.from({ length: 100 }, (_, i) => NOW - (100 - i)));
    expect(dueWindow(many, NOW)).toHaveLength(BATCH_LIMIT);
  });

  it('nothing pending → empty batch', () => {
    expect(dueWindow([], NOW)).toEqual([]);
  });
});

describe('reminderMessage', () => {
  it('names the patient, the clinic, the time, and asks for a reply', () => {
    const msg = reminderMessage({
      patientName: 'Ahmad Faizal',
      clinicName: 'Klinik Pergigian Medini',
      startsAt: new Date('2026-10-11T10:30:00+08:00'),
    });
    expect(msg).toContain('Ahmad Faizal');
    expect(msg).toContain('Klinik Pergigian Medini');
    expect(msg).toContain('8 jam');
    expect(msg).toMatch(/YA/i);
  });
});
