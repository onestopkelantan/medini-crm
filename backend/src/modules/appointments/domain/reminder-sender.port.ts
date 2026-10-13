/**
 * ReminderSenderPort — E6. The seam between the reminder SCHEDULER and
 * whatever actually delivers a WhatsApp message.
 *
 * WHY A PORT
 *
 * The WhatsApp transport is in flux: WAHA today (unofficial, currently
 * without a live number), possibly the official Cloud API tomorrow. The
 * scheduling policy — one confirmation 8 hours out — must not depend on
 * which wire it travels. Swapping transports means implementing this
 * interface, nothing else.
 *
 * The mock implementation exists so E6 is testable end-to-end (and
 * demo-able to the boss) WITHOUT a paired phone: it logs what would have
 * been sent and reports success, so the appointment_reminders ledger
 * fills up honestly and the pipeline can be watched live.
 */

export interface ReminderSend {
  orgId: string;
  branchId: string;
  appointmentId: string;
  /** Patient's WhatsApp JID (e.g. 60123456789@s.whatsapp.net). */
  to: string;
  body: string;
}

export interface ReminderSendResult {
  ok: boolean;
  /** Transport reference (message id) or failure reason. */
  ref?: string;
  error?: string;
}

export interface ReminderSenderPort {
  send(reminder: ReminderSend): Promise<ReminderSendResult>;
}

/** Nest injection token — an interface cannot be a provider key by itself. */
export const REMINDER_SENDER = Symbol('REMINDER_SENDER');

/** Development/demo sender: no phone, honest ledger. */
export class MockReminderSender implements ReminderSenderPort {
  private readonly sent: ReminderSend[] = [];

  async send(reminder: ReminderSend): Promise<ReminderSendResult> {
    this.sent.push(reminder);
    /* Timestamped one-line log so a demo shows the pipeline breathing. */
    process.stdout.write(
      `[reminder:mock] ${new Date().toISOString()} → ${reminder.to} :: ${reminder.body.slice(0, 60)}…\n`,
    );
    return { ok: true, ref: `mock-${Math.random().toString(36).slice(2, 10)}` };
  }

  /** Test seam: what was "sent". */
  getSent(): readonly ReminderSend[] {
    return this.sent;
  }
}
