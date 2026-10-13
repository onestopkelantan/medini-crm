import { describe, it, expect } from 'vitest';

import { planTyping, planPostSendPause, TYPING_PACING } from '@modules/ai-manager/domain/typing-pacing';

/**
 * AB1 — typing duration must be PROPORTIONAL to the reply it precedes, and
 * never outside the human-plausible band. The anti-ban property under test:
 * message cadence must have a visible relationship to message size.
 */

describe('planTyping — proportional to length', () => {
  it('a short reply types for less time than a long one (same dice)', () => {
    const rand = () => 0.5; /* neutral jitter (×1.0) */
    const short = planTyping('Baik, sudah saya catat. Terima kasih!', rand);
    const long = planTyping('x'.repeat(400), rand);
    expect(short.typingMs).toBeLessThan(long.typingMs);
  });

  it('a two-line reply (~121 chars) lands around 7.6s', () => {
    const reply = 'Baik Puan. Tempahan hari Sabtu pukul 10 pagi sudah dicatatkan di cawangan UDA. Harap hadir 10 minit lebih awal ya.';
    expect([...reply].length).toBe(114); /* the expectation below is exact math */
    const plan = planTyping(reply, () => 0.5);
    /* 2500 + 114×45 = 7630 → jitter ×1.0 → round(7630) */
    expect(plan.typingMs).toBe(7_630);
  });

  it('a five-paragraph reply (~400 chars) lands around 20s', () => {
    const plan = planTyping('x'.repeat(400), () => 0.5);
    /* 2500 + 400×45 = 20500 ×1.0 */
    expect(plan.typingMs).toBe(20_500);
  });

  it('never below MIN_MS — even a 1-char reply waits', () => {
    const plan = planTyping('ok', () => 0); /* max negative jitter ×0.75 */
    expect(plan.typingMs).toBeGreaterThanOrEqual(TYPING_PACING.minMs);
  });

  it('never above MAX_MS — an essay still sends in a believable window', () => {
    const plan = planTyping('x'.repeat(2_000), () => 1); /* max positive jitter ×1.25 */
    expect(plan.typingMs).toBeLessThanOrEqual(TYPING_PACING.maxMs);
  });

  it('jitter changes the duration for identical replies', () => {
    const reply = 'x'.repeat(120);
    const a = planTyping(reply, () => 0.1);
    const b = planTyping(reply, () => 0.9);
    expect(a.typingMs).not.toBe(b.typingMs);
  });

  it('emoji are not double-counted (code points, not UTF-16 units)', () => {
    /* 1 emoji + 9 chars = 10 code points, 11 UTF-16 units. With rand 0.5:
     * code-point maths → 2500 + 10×45 = 2950 → clamped to min 4000. */
    const plan = planTyping('😀'.repeat(10), () => 0.5);
    expect(plan.chars).toBe(10);
  });
});

describe('planPostSendPause — the gap AFTER sending', () => {
  it('is inside the reading band 1.5–3.5s', () => {
    for (const dice of [0, 0.5, 1]) {
      const ms = planPostSendPause(() => dice);
      expect(ms).toBeGreaterThanOrEqual(1_500);
      expect(ms).toBeLessThanOrEqual(3_500);
    }
  });

  it('varies between calls', () => {
    expect(planPostSendPause(() => 0.1)).not.toBe(planPostSendPause(() => 0.9));
  });
});
