/**
 * Appointment status state machine — LOCKED transitions (Sprint 2 T3).
 *
 * Mirrors the frontend APPT_STATUS_FLOW:
 *   booked → confirmed → checked-in → waiting → called → in-progress → completed
 *   booked/confirmed → cancelled
 *   waiting/called → no-show
 *
 * Terminal states: completed | cancelled | no-show (no outgoing transitions).
 * Any other jump is ILLEGAL and must fail safely (ConflictError at service).
 */

export const APPOINTMENT_STATUS_FLOW: Record<string, string[]> = {
  booked: ['confirmed', 'cancelled'],
  confirmed: ['checked-in', 'cancelled'],
  'checked-in': ['waiting', 'cancelled'],
  waiting: ['called', 'no-show'],
  called: ['in-progress', 'no-show'],
  'in-progress': ['completed'],
  completed: [],
  cancelled: [],
  'no-show': [],
};

/** The canonical forward path (for queue/order determinism). */
export const FORWARD_PATH = [
  'booked', 'confirmed', 'checked-in', 'waiting', 'called', 'in-progress', 'completed',
] as const;

export function canTransition(from: string, to: string): boolean {
  return (APPOINTMENT_STATUS_FLOW[from] ?? []).includes(to);
}

export function allowedTransitions(from: string): string[] {
  return APPOINTMENT_STATUS_FLOW[from] ?? [];
}

/** States that keep an appointment in the "active day queue". */
export const QUEUE_ACTIVE_STATUSES = ['checked-in', 'waiting', 'called', 'in-progress'];

/** Rescheduling is only allowed while the appointment is not yet started. */
export function canReschedule(status: string): boolean {
  return status === 'booked' || status === 'confirmed';
}
