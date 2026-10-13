/* Booking requests — READ-ONLY record of what the WhatsApp AI booked.
 *
 * WHAT THIS BECAME, AND WHY
 *
 * This started as a work queue: bookings arrived as `pending`, a staff member
 * pressed Confirm, and the patient was told. That flow no longer exists. The AI
 * now books end to end — patient, appointment, confirmation — so every row
 * arrives `confirmed` and nobody approves anything. The buttons were approving a
 * decision already made, and on the confirm path they sent the patient
 * "DISAHKAN" WITHOUT creating the appointment, which is worse than useless: a
 * patient arriving to a chair that was never booked.
 *
 * So the write path is gone. What remains is the RECORD — and it earns its place
 * for three reasons the clinic gave:
 *
 *   1. It is the only place that shows WHAT THE PATIENT SAID and WHEN they said
 *      it. A booking taken at 1:47am is the clinic's whole advantage over a
 *      clinic that opens at 9; that fact is invisible in an appointment row.
 *   2. It is the audit trail. If a patient rings up saying "the WhatsApp told me
 *      3pm", this is where that is checked.
 *   3. The AI still uses the table to refuse a duplicate booking, so the data has
 *      to be right whether or not anyone reads the screen.
 *
 * The doctor and the appointment code come from `linked_appointment_id`, so the
 * receipt shows what was actually booked rather than what was requested. */

import {
  Controller,
  Get,
  Query,
  Req,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { RequirePermission } from "../../../core/auth/decorators";
import { AuthedRequest } from "../../../core/auth/auth.guard";
import { DbContextService } from "../../../core/auth/db-context.service";

@Controller({ path: "booking-requests", version: "1" })
export class BookingRequestsController {
  constructor(private readonly dbCtx: DbContextService) {}

  @Get()
  @RequirePermission("appointments", "view")
  async list(
    @Req() req: AuthedRequest,
    @Query("status") status?: string,
  ) {
    const st =
      status && ["pending", "confirmed", "rejected"].includes(status)
        ? status
        : null;

    const branchCondition =
      req.principal!.role === "hq"
        ? sql`TRUE`
        : sql`br.branch_id = ${req.principal!.branchId}`;

    /* Status filter stays available — it costs nothing and a clinic may want to
     * see only the bookings that failed to get an appointment. `TRUE` when no
     * filter is given, so the query has one shape rather than two. */
    const statusCondition = st ? sql`br.status = ${st}` : sql`TRUE`;

    return this.dbCtx.runAs(req.principal!, async (tx) => {
      /* One query, not two. The previous version repeated the whole SELECT once
       * per status filter — the same columns and joins written twice, which is
       * how a column added to one copy silently goes missing from the other.
       *
       * The LEFT JOINs bring back what was ACTUALLY booked: the doctor's name and
       * the appointment code. `linked_appointment_id` is nullable because a
       * booking that failed to create an appointment has no link, and the row
       * must still appear — that is exactly the case worth seeing.
       *
       * NOTHING SECRET IS RETURNED. The raw message is included because it is the
       * point of the screen; it is patient-authored text about their own booking. */
      const rows = await tx.execute(sql`
        SELECT
          br.id,
          br.contact_phone,
          br.patient_name,
          br.preferred_date,
          br.preferred_time,
          br.treatment,
          br.branch_name,
          br.raw_message,
          br.status,
          br.created_at,
          br.linked_appointment_id AS linkedAppointmentId,
          a.code AS appointmentCode,
          s.name AS doctor_name
        FROM booking_requests br
        LEFT JOIN appointments a ON a.id = br.linked_appointment_id
        LEFT JOIN staff s ON s.id = a.doctor_id
        WHERE ${statusCondition}
          AND ${branchCondition}
        ORDER BY br.created_at DESC
        LIMIT 100
      `);

      return (rows as unknown as { rows: unknown[] }).rows;
    });
  }
}
