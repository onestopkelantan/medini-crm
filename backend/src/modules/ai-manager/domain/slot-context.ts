import type { FreeSlot } from './slot-finder';

/**
 * Format verified free slots as FACT lines for the AI prompt.
 *
 * The line shape ('• date label — doctorName') is IDENTICAL to the one
 * findAlternatives() already puts in patient-facing messages, so the model
 * sees one consistent slot shape wherever slots appear — the design spec
 * picked this deliberately (§4.2 step 5).
 *
 * Empty is a FACT, not silence: the model must tell the patient there is
 * nothing and propose another date, never improvise a time. The prompt rule
 * at the call site already says "jangan reka keputusan semakan slot"; this
 * line gives that rule something concrete to be honest about.
 */
export function formatSlotContext(slots: readonly FreeSlot[]): string {
  if (slots.length === 0) {
    return (
      '\nSLOT KOSONG: tiada slot ditemui untuk tarikh ini. ' +
      'Cadangkan tarikh lain; JANGAN mereka masa.'
    );
  }

  const lines = slots.map((s) => `• ${s.date} ${s.label} — ${s.doctorName}`);
  return ['\nSLOT KOSONG (disahkan sistem, tawarkan maksimum 2):', ...lines].join(
    '\n',
  );
}
