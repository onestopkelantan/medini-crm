/**
 * Assistant router — E6/A2. ONE front door, MANY registered agents.
 *
 * THE OWNER'S DIRECTION (8 Okt):
 * "AI Assistant connect dengan MiniMax, tapi scope AI jangan luas — dia
 *  panggil AI AGENT yang terdaftar untuk urus kerja masing-masing."
 *
 * So the assistant is a DISPATCHER, not a general oracle: it reads the
 * question's intent, picks the REGISTERED agent whose portfolio owns
 * that work, and hands the question over. Each agent keeps its own
 * policy gate, scope and refusal behaviour — the router only decides
 * WHO, never answers on an agent's behalf.
 *
 * ROUTES (deterministic, pure — no model call in the routing itself):
 *
 *   finance questions (kutipan/tertunggak/hutang/collections/balance)
 *     → finance-ai (scanOverdue drafts the chase, returns counts)
 *   data questions (revenue/rawatan/pesakit/temujanji/borang/doktor)
 *     → insights-ai (the grounded analyst)
 *   booking/whatsapp help
 *     → ai-receptionist portfolio — but that agent ACTS on WhatsApp,
 *       not in a staff chat, so the router returns an honest pointer
 *       instead of pretending to be Nur.
 *   anything else → the analyst's own capability reply (fail-closed).
 *
 * Pure: text in, route out. No I/O — the service layer enforces the
 * policy gates per agent.
 */

export type AssistantRoute =
  | { agent: 'finance-ai'; reason: 'collections' }
  | { agent: 'insights-ai'; reason: 'data' }
  | { agent: 'ai-receptionist'; reason: 'booking-help' };

export function routeAssistant(text: string): AssistantRoute {
  const t = text.toLowerCase();

  /* Collections/portfolio work first — it is the most specific intent,
   * and "kutipan" also collides with the analyst's revenue vocabulary
   * ("jumlah kutipan"). Collection QUESTIONS mention debt/chase/overdue
   * installments, not totals. */
  if (
    /\b(tertunggak|hutang|piutang|collections?|kutipan tertunggak|balik[ -]?late|chase|overdue|ansuran lewat|installment overdue|debt)\b/.test(t)
  ) {
    return { agent: 'finance-ai', reason: 'collections' };
  }

  /* Booking/reception help → the receptionist's portfolio. Pointer, not
   * impersonation — see the header note. STEMS (appointments?, temujanji)
   * + EN/BM campuran: "can you assign an appointment?" pernah jatuh ke
   * dinding kemampuan analyst kerana regex lama hanya tahu 'booking/tempah'. */
  if (
    /\b(bookings?|appointments?|apointments?|schedule\s+(an\s+)?app?ointments?|assign\s+(an\s+)?app?ointments?|tempah|temujanji|nur|whatsapp bot|receptionist)\b/.test(t) &&
    !/\b(revenue|jualan|kutipan|trend|statistik)\b/.test(t)
  ) {
    return { agent: 'ai-receptionist', reason: 'booking-help' };
  }

  /* Everything else goes to the grounded analyst — including its own
   * honest capability reply when the question matches nothing. */
  return { agent: 'insights-ai', reason: 'data' };
}
