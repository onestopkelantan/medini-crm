/* Booking requests - admin reads + acts on WhatsApp booking intake (RLS-scoped).
   On confirm/reject, auto-notifies the patient via WhatsApp (WAHA sendText). */

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  ParseUUIDPipe,
  Logger,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { RequirePermission } from "../../../core/auth/decorators";
import { AuthedRequest } from "../../../core/auth/auth.guard";
import { DbContextService } from "../../../core/auth/db-context.service";

interface BookingRow {
  id: string;
  contact_phone: string;
  patient_name: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  treatment: string | null;
  branch_name: string | null;
  status: string;
}

@Controller({ path: "booking-requests", version: "1" })
export class BookingRequestsController {
  private readonly logger = new Logger("BookingRequests");

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
        : sql`branch_id = ${req.principal!.branchId}`;

    return this.dbCtx.runAs(req.principal!, async (tx) => {
      const rows = st
        ? await tx.execute(sql`
            SELECT
              id,
              contact_phone,
              patient_name,
              preferred_date,
              preferred_time,
              treatment,
              branch_name,
              raw_message,
              status,
              created_at
            FROM booking_requests
            WHERE status = ${st}
              AND ${branchCondition}
            ORDER BY created_at DESC
            LIMIT 100
          `)
        : await tx.execute(sql`
            SELECT
              id,
              contact_phone,
              patient_name,
              preferred_date,
              preferred_time,
              treatment,
              branch_name,
              raw_message,
              status,
              created_at
            FROM booking_requests
            WHERE ${branchCondition}
            ORDER BY created_at DESC
            LIMIT 100
          `);

      return (rows as unknown as { rows: unknown[] }).rows;
    });
  }

  @Patch(":id/status")
  @RequirePermission("appointments", "edit")
  async changeStatus(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { status?: string },
  ) {
    const status = body?.status;

    if (!status || !["pending", "confirmed", "rejected"].includes(status)) {
      return { error: "invalid status" };
    }

    const branchCondition =
      req.principal!.role === "hq"
        ? sql`TRUE`
        : sql`branch_id = ${req.principal!.branchId}`;

    const booking = await this.dbCtx.runAs(req.principal!, async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE booking_requests
        SET status = ${status},
            updated_at = now()
        WHERE id = ${id}
          AND ${branchCondition}
        RETURNING
          id,
          contact_phone,
          patient_name,
          preferred_date,
          preferred_time,
          treatment,
          branch_name,
          status
      `);

      return (rows as unknown as { rows: BookingRow[] }).rows[0] ?? null;
    });

    if (!booking) {
      return { error: "not found" };
    }

    if (status === "confirmed" || status === "rejected") {
      try {
        await this.notifyPatient(booking, status);
      } catch (e) {
        this.logger.error(
          "Gagal hantar notifikasi WhatsApp: " +
            (e as Error).message,
        );
      }
    }

    return {
      id: booking.id,
      status: booking.status,
    };
  }

  private async notifyPatient(
    booking: BookingRow,
    status: string,
  ) {
    const phone = (booking.contact_phone || "")
      .replace("@c.us", "")
      .replace("@lid", "");

    if (!phone || phone.includes("@")) {
      this.logger.warn("No valid phone, skip notify");
      return;
    }

    const chatId = `${phone}@c.us`;
    const name = booking.patient_name || "Cik/Tuan/Puan";
    const treatment = booking.treatment || "rawatan";
    const date = booking.preferred_date || "-";
    const time = booking.preferred_time || "-";
    const branch = booking.branch_name || "-";

    const text =
      status === "confirmed"
        ? `Salam ${name} 😊 Booking untuk ${treatment} pada ${date} ${time} di cawangan ${branch} telah DISAHKAN ✅. Sila hadir 10 minit awal ya. Terima kasih, jumpa nanti!`
        : `Salam ${name} 🙏 Maaf, slot untuk ${date} ${time} telah penuh. Boleh Cik/Tuan/Puan pilih tarikh atau masa lain? Kami akan bantu cari slot yang sesuai. Terima kasih!`;

    const url =
      process.env.WAHA_URL ??
      "https://waha-production-f5bc.up.railway.app";

    const res = await fetch(`${url}/api/sendText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.WAHA_API_KEY ?? "",
      },
      body: JSON.stringify({
        session: process.env.WAHA_SESSION ?? "default",
        chatId,
        text,
      }),
    });

    if (!res.ok) {
      this.logger.error(
        `sendText notify gagal ${res.status}: ${await res.text()}`,
      );
    } else {
      this.logger.warn(`Notify ${status} sent to ${phone}`);
    }
  }
}