/**
 * Assistant actions — the SAFE action menu the assistant may trigger.
 *
 * OWNER DIRECTION (Okt 2026, "Option B"): the assistant should FEEL like an
 * executor — one door for talk AND action — but it must NEVER change code and
 * never invent capabilities. This module is the hard boundary of that promise:
 *
 *   1. ONLY the actions listed here exist. The model cannot add to this list;
 *      it only picks from it. A new action requires a code change + review.
 *   2. Every entry maps 1:1 to an EXISTING service method that is already
 *      policy-gated. The assistant calls the same functions the UI calls —
 *      no new power, no shortcuts, no raw SQL, no code evaluation.
 *   3. Read-only peeks (queue counts) and reversible agent switches
 *      (enable/pause) only. No writes to clinical or money records, no
 *      message sending — those stay with their owning agents and screens.
 *
 * The keyword matchers are deterministic (stems, BM+EN) — an action fires
 * only on an explicit phrase, and every action reply reports exactly what
 * happened, with numbers.
 */

export interface AssistantAction {
  /** Stable id for the reply badge. */
  id: string;
  /** BM + EN phrases that trigger it. Stems, not exact matches. */
  patterns: RegExp;
  /** What this action does, one line — shown to the user BEFORE they rely on it. */
  summary: string;
}

export const ASSISTANT_ACTIONS: readonly AssistantAction[] = [
  {
    id: 'finance.scan_collections',
    patterns: /\b(imbas\s+kutipan|imbas\s+tertunggak|scan\s+collection?s?|collect\s+overdue|imbas\s+baki|chase\s+overdue)\b/i,
    summary: 'Jalankan Imbas Kutipan Finance AI (draf masuk baris kelulusan)',
  },
  {
    id: 'agents.pause',
    patterns: /\b(jeda|pause|hentikan)\b[^.]*\b(nur|receptionist|agen|agent)\b/i,
    summary: 'Jeda agen AI (boleh diaktifkan semula)',
  },
  {
    id: 'agents.enable',
    patterns: /\b(aktifkan?|aktif\s+semula|activate|hidupkan|nyalakan)\b[^.]*\b(nur|receptionist|agen|agent)\b/i,
    summary: 'Aktifkan semula agen AI',
  },
  {
    id: 'queue.peek',
    patterns: /\b(antrean|baris\s+kelulusan|approval\s+queue|queue|semaak?\s+kelulusan|semak\s+draf)\b/i,
    summary: 'Intip baris kelulusan (berapa menunggu)',
  },
];

/** Match a message to at most one action; deterministic, first hit wins. */
export function matchAssistantAction(text: string): AssistantAction | null {
  for (const a of ASSISTANT_ACTIONS) {
    if (a.patterns.test(text)) return a;
  }
  return null;
}

/** Is this message just a greeting / smalltalk? (sapaan → model menjawab natural) */
export function isGreeting(text: string): boolean {
  return /^\s*(hi|hai|halo|hello|hey|salam|assalamualaikum|pagi|tengahari|petang|malam|selamat\s+(pagi|tengahari|petang|malam))[\s!.,?]*$/i.test(text);
}
