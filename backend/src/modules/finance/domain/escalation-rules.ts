/**
 * Fasa D — Finance AI collection escalation ladder (PURE domain).
 *
 * The dental-erp billing-agent's Day 3/7/14 escalation tiers, rebuilt with
 * this repo's discipline: deterministic code decides tier and drafts text
 * from a TEMPLATE; the model is never asked to invent tone or numbers.
 * Every draft is written to the APPROVAL QUEUE (ai_approval_requests) —
 * nothing sends automatically; a human approves before anything moves.
 *
 * No I/O, no clock: the caller supplies today's date and the overdue days.
 */

export type EscalationTier = 'friendly' | 'firm' | 'serious' | 'escalation';

/** The installment row as the scanner fetches it (strings stay strings —
 * DECIMAL arrives as text; format at render, never sum here). */
export interface OverdueInstallment {
  planId: string;
  installmentNo: number;
  daysOverdue: number;
  /** DECIMAL string like '300.0000'. */
  amount: string;
  dueDate: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  planCode: string;
  /** Patient has an active wa_opt_outs row — no message drafts, ever. */
  optedOut?: boolean;
}

export interface EscalationDraft {
  tier: EscalationTier;
  /** Message body: patient-facing text, OR a staff summary when toStaff. */
  body: string;
  /** True = this draft is an internal task, never a patient message. */
  toStaff: boolean;
}

/* ---------------------------------------------------------------------------
 * THE LADDER — boundaries are the contract (tests pin 3/4, 7/8, 14/15).
 *
 * 1–3   friendly  : gentle reminder, amount + due date
 * 4–7   firm      : outstanding total stated, arrangement requested
 * 8–14  serious   : restructuring proposed, staff takeover flagged
 * >14   escalation: manager summary — NO patient message
 * ------------------------------------------------------------------------- */
export function escalationTier(daysOverdue: number): EscalationTier | null {
  if (daysOverdue < 1) return null; /* not overdue — nothing to escalate */
  if (daysOverdue <= 3) return 'friendly';
  if (daysOverdue <= 7) return 'firm';
  if (daysOverdue <= 14) return 'serious';
  return 'escalation';
}

/**
 * Idempotency key: one draft per (installment × tier). A rescan of the same
 * overdue installment at the same tier hits the same key and is skipped; a
 * later tier is a DIFFERENT key, so the friendly draft and the firm draft can
 * coexist in the queue without confusion.
 */
export function escalationKey(row: OverdueInstallment): string {
  const tier = escalationTier(row.daysOverdue);
  return `finance.escalate:${row.planId}:${row.installmentNo}:${tier}`;
}

function rm(value: string): string {
  return `RM${Number(value).toFixed(2)}`;
}

/**
 * Draft the reminder text for a tier. Opted-out patients get a STAFF TASK at
 * every tier — the ladder's tone escalation still happens internally, but no
 * patient message is ever drafted (the anti-ban opt-out rule is absolute).
 */
export function draftReminder(row: OverdueInstallment): EscalationDraft | null {
  const tier = escalationTier(row.daysOverdue);
  if (!tier) return null;

  /* OPT-OUT: no patient-facing text, at any tier. Staff task instead. */
  if (row.optedOut) {
    return {
      tier,
      toStaff: true,
      body: staffSummary(row, 'Pesakit telah menarik diri daripada mesej WhatsApp — hubungi melalui telefon.'),
    };
  }

  switch (tier) {
    case 'friendly':
      return {
        tier,
        toStaff: false,
        body: `Salam ${row.patientName}, peringatan mesra daripada Medini Dental Clinic. Ansuran ${rm(row.amount)} bagi pelan ${row.planCode} telah matang pada ${row.dueDate}. Bayaran boleh dibuat di klinik atau melalui kaunter kami. Terima kasih! 🦷`,
      };
    case 'firm':
      return {
        tier,
        toStaff: false,
        body: `${row.patientName}, ansuran ${rm(row.amount)} bagi pelan ${row.planCode} (matang ${row.dueDate}) kini TERTUNGGAK. Sila hubungi klinik untuk aturan bayaran supaya pelan anda kekal aktif. Terima kasih.`,
      };
    case 'serious':
      return {
        tier,
        toStaff: false,
        body: `${row.patientName}, baki ansuran ${rm(row.amount)} bagi pelan ${row.planCode} telah lama tertunggak. Kami ingin membantu — sila hubungi klinik untuk membincangkan rancangan bayaran semula. Jika tiada tindakan, pelan mungkin ditanda gagal.`,
      };
    case 'escalation':
      return {
        tier,
        toStaff: true,
        body: staffSummary(row, 'Melebihi 14 hari — perlukan keputusan pengurus (rancangan semula / tanda gagal).'),
      };
  }
}

function staffSummary(row: OverdueInstallment, recommendation: string): string {
  return [
    `TUGAS KUTIPAN — ansuran tertunggak`,
    `Pesakit : ${row.patientName} (${row.patientPhone ?? 'tiada telefon'})`,
    `Pelan   : ${row.planCode} ansuran #${row.installmentNo}`,
    `Amaun   : ${rm(row.amount)} · matang ${row.dueDate} (${row.daysOverdue} hari tertunggak)`,
    `Tindakan: ${recommendation}`,
  ].join('\n');
}
