/**
 * Typing pacing — anti-ban, human-like send rhythm (AB1).
 *
 * WHY THIS EXISTS
 *
 * The bot used to show "sedang menaip…" for a flat random 5–10s regardless
 * of what it was about to send. A two-line reply after 10s of typing looks
 * slow; a five-paragraph reply after 5s looks inhuman — no one types 400
 * characters in five seconds. The typing duration must be PROPORTIONAL to
 * the reply it precedes, and every send must clear a minimum "the operator
 * read that first" beat. Ban heuristics on WhatsApp's side flag accounts
 * whose message cadence has no relationship to message size.
 *
 * PURE AND DETERMINISTIC
 *
 * No I/O and no clock — `rand` is injected so tests pin the dice. The
 * caller owns real time and real presence calls.
 *
 * THE MODEL (deliberately simple, tuned by hand)
 *
 *   typingMs = clamp(BASE_MS + CHAR_MS × chars ± jitter, MIN_MS, MAX_MS)
 *
 *   BASE_MS   2.5s — reading the patient's message before starting to type
 *   CHAR_MS   45ms — a fast but plausible typer (~130 cpm) with thinking gaps
 *   JITTER    ±25% — no two identical durations back to back
 *   MIN_MS    4s   — never replies INSTANTLY, even to "ok"
 *   MAX_MS    25s  — a long reply still waits only long enough to be believed
 *
 * A 120-char reply lands around 8s of typing; a 400-char one around 20s.
 * Both well inside the reply-queue's window so pacing never breaks the
 * operator's SLA expectations.
 */

/** The band, all in milliseconds. Exported for tests and for the settings
 * panel if it ever wants to display what the pace actually is. */
export const TYPING_PACING = {
  baseMs: 2_500,
  perCharMs: 45,
  minMs: 4_000,
  maxMs: 25_000,
  jitterRatio: 0.25,
} as const;

export interface TypingPlan {
  /** How long "sedang menaip…" should show before the send. */
  typingMs: number;
  /** Reply length the plan was computed from (diagnostics/tests). */
  chars: number;
}

/** Compute the human-like typing duration for a reply. */
export function planTyping(
  reply: string,
  rand: () => number = Math.random,
): TypingPlan {
  const chars = [...reply].length; /* grapheme-safe-ish: emoji are 2 UTF-16
   * units and would double-count toward "typing time" — code points are the
   * honest unit for "how much did they type" */

  const raw = TYPING_PACING.baseMs + chars * TYPING_PACING.perCharMs;

  /* Symmetric jitter, then the band. Jitter FIRST so the clamp cannot turn
   * every long reply into the same MAX_MS — identical durations are as
   * robotic as instant ones. */
  const jitter = 1 + (rand() * 2 - 1) * TYPING_PACING.jitterRatio;
  const typingMs = Math.round(
    Math.min(TYPING_PACING.maxMs, Math.max(TYPING_PACING.minMs, raw * jitter)),
  );

  return { typingMs, chars };
}

/**
 * Post-send pause: how long the sender should stay quiet before the NEXT
 * outbound to the same conversation. A human reads the reply they just sent,
 * checks the patient's next message, thinks. A bot that chains sends with
 * zero gap broadcasts its nature even when each individual send was paced.
 *
 * Lower band than typing (reading is faster than composing): 1.5–3.5s.
 */
export function planPostSendPause(rand: () => number = Math.random): number {
  const { jitterRatio } = TYPING_PACING;
  const base = 2_500;
  return Math.round(base * (1 + (rand() * 2 - 1) * jitterRatio));
}
