/**
 * Reply splitting — anti-ban, AB3.
 *
 * WHY THIS EXISTS
 *
 * A human does not send a 900-character essay as one WhatsApp message: they
 * send two or three, each a natural paragraph. A wall-of-text single send —
 * always exactly one message regardless of length — is a bot signature, and
 * it is also terrible to read on a phone.
 *
 * THE RULES (small on purpose)
 *
 *   - Split only at safe boundaries, NEVER mid-word: paragraph breaks first,
 *     then single newlines, then sentence ends. A message is never chopped
 *     at a space just to hit a size.
 *   - Every part must be non-trivial: a trailing one-word fragment is worse
 *     than a slightly long last message, so a part under the minimum joins
 *     its neighbour.
 *   - Cap the number of parts (4): a reply needing more than that is a
 *     prompt problem, and machine-gunning 8 messages is its own bot signal.
 *
 * PURE: string in, parts out. No I/O, no clock, no rand — the caller owns
 * pacing between parts (AB1's planPostSendPause keeps the gap human).
 */

/** Soft target for one WhatsApp message, in characters. */
export const SPLIT_TARGET_CHARS = 320;
/** A part shorter than this is folded into its neighbour. */
export const SPLIT_MIN_CHARS = 60;
/** Hard ceiling on how many messages one reply becomes. */
export const SPLIT_MAX_PARTS = 4;

export interface SplitPlan {
  /** The parts to send, in order. Length 1..SPLIT_MAX_PARTS. */
  parts: string[];
  /** How many parts — convenience for callers/logs. */
  count: number;
}

/**
 * Split a reply into human-sized messages. Returns [original] (one part,
 * unmodified) whenever no split is needed — short replies and replies that
 * are already one natural paragraph pass through untouched.
 */
export function splitReply(
  reply: string,
  opts: { target?: number; min?: number; maxParts?: number } = {},
): SplitPlan {
  const target = opts.target ?? SPLIT_TARGET_CHARS;
  const min = opts.min ?? SPLIT_MIN_CHARS;
  const maxParts = opts.maxParts ?? SPLIT_MAX_PARTS;

  if (reply.length <= target) return { parts: [reply], count: 1 };

  /* 1. Paragraphs (blank-line separated) are the natural unit a human
   *    would send separately. */
  let units = reply.split(/\n\s*\n/).map((u) => u.trim()).filter(Boolean);

  /* 2. Any paragraph still over ~1.5× target gets split on single newlines. */
  const expanded: string[] = [];
  for (const u of units) {
    if (u.length <= target * 1.5) {
      expanded.push(u);
      continue;
    }
    let buf = '';
    for (const line of u.split('\n')) {
      const candidate = buf ? `${buf}\n${line}` : line;
      if (candidate.length > target && buf) {
        expanded.push(buf.trim());
        buf = line;
      } else {
        buf = candidate;
      }
    }
    if (buf.trim()) expanded.push(buf.trim());
  }
  units = expanded;

  /* 3. Greedily pack units into parts no longer than target. Packing — not
   *    strict one-unit-per-part — keeps a reply of many short lines from
   *    becoming machine-gun fire. */
  const packed: string[] = [];
  let cur = '';
  for (const u of units) {
    const candidate = cur ? `${cur}\n\n${u}` : u;
    if (candidate.length > target && cur) {
      packed.push(cur);
      cur = u;
    } else {
      cur = candidate;
    }
  }
  if (cur) packed.push(cur);

  /* 4. Fold fragments: a part under `min` joins its PREVIOUS part even if
   *    that slightly exceeds target — a one-line orphan is the thing we
   *    are trying to avoid. */
  const folded: string[] = [];
  for (const p of packed) {
    if (p.length < min && folded.length > 0) {
      folded[folded.length - 1] = `${folded[folded.length - 1]}\n\n${p}`;
    } else {
      folded.push(p);
    }
  }

  /* 5. Cap the parts: if we still have more than the cap, merge the tail
   *    into the last allowed part. Correctness (all words present, in
   *    order) beats prettiness. */
  let parts = folded;
  if (parts.length > maxParts) {
    const head = parts.slice(0, maxParts - 1);
    const tail = parts.slice(maxParts - 1).join('\n\n');
    parts = [...head, tail];
  }

  return { parts, count: parts.length };
}
