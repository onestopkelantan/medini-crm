/**
 * H-8 reminder policy — E6. Pure decisions for the reminder scheduler.
 *
 * THE CLINIC'S RULE (owner decision, 6 Okt 2026)
 *
 * ONE WhatsApp confirmation, 8 hours before the visit. Not a ladder, not
 * risk-based (the risk feature was removed by the same owner decision) —
 * a single polite "datang tak?" per appointment, because the point is to
 * give the PATIENT a chance to say "tak jadi" while the clinic can still
 * refill the slot.
 *
 * WHAT THE SCHEDULER DOES WITH THIS
 *
 *   planReminder()   — when a booking is created/confirmed, compute the
 *                      scheduled_for instant (start - 8h) and whether a
 *                      reminder is worth queueing at all (booked less
 *                      than 8h out → still worth it, but at +15 min so
 *                      the patient is not reminded while still at the
 *                      counter; already cancelled/completed → never).
 *   dueWindow()      — which pending rows a tick may claim: scheduled_for
 *                      in the past, capped by BATCH_LIMIT, oldest first.
 *
 * SENDING IS NOT HERE. The transport (WAHA today, mock in dev, official
 * API maybe tomorrow) lives behind the sender port; this module only
 * decides WHAT and WHEN — which also keeps both testable without a
 * phone.
 */

/** Hours before the visit the reminder fires. */
export const H8_HOURS_MS = 8 * 60 * 60 * 1000;
/** A booking made inside the 8h window still gets a reminder, but not
 * instantly — 15 minutes of grace beats reminding someone standing at
 * the reception desk. */
export const LATE_BOOKING_GRACE_MS = 15 * 60 * 1000;
/** One tick claims at most this many due reminders — a spike (bulk import,
 * DST shift) must not fire 200 WhatsApps in one loop. */
export const BATCH_LIMIT = 25;

export type PlanOutcome =
  | { kind: 'schedule'; scheduledFor: Date }
  | { kind: 'skip'; reason: 'cancelled' | 'completed' | 'no_start' };

export interface AppointmentLike {
  status: string;
  /** Appointment start, epoch ms. */
  start: number | null;
}

/** Should this appointment get an H-8 reminder, and for when? */
export function planReminder(
  appt: AppointmentLike,
  now: number = Date.now(),
): PlanOutcome {
  if (appt.status === 'cancelled' || appt.status === 'no-show') {
    return { kind: 'skip', reason: 'cancelled' };
  }
  if (appt.status === 'completed') {
    return { kind: 'skip', reason: 'completed' };
  }
  if (appt.start == null) {
    return { kind: 'skip', reason: 'no_start' };
  }

  const ideal = appt.start - H8_HOURS_MS;
  /* Booked inside the window: the ideal time is already past. Send at
   * now + grace instead — never in the past (a reminder for a time that
   * already went by reads broken), never instantly (grace). */
  const scheduledFor = ideal > now ? new Date(ideal) : new Date(now + LATE_BOOKING_GRACE_MS);

  return { kind: 'schedule', scheduledFor };
}

export interface DueRow {
  id: string;
  scheduledFor: Date;
}

/** Which pending reminders may this tick claim? Oldest first, capped. */
export function dueWindow<T extends DueRow>(
  pending: readonly T[],
  now: number = Date.now(),
): T[] {
  return pending
    .filter((r) => r.scheduledFor.getTime() <= now)
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
    .slice(0, BATCH_LIMIT);
}

/** The message body for an H-8 confirmation, in the clinic's voice. */
export function reminderMessage(input: {
  patientName: string;
  clinicName: string;
  startsAt: Date;
}): string {
  const time = input.startsAt.toLocaleString('ms-MY', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  });
  return (
    `Selamat sejahtera ${input.patientName}, peringatan daripada ${input.clinicName}. ` +
    `Temujanji anda pada ${time} (dalam masa ~8 jam). ` +
    `Sila balas YA untuk sahkan kedatangan, atau TUKAR/BATAL jika perlu. Terima kasih.`
  );
}
