import { describe, it, expect } from 'vitest';
import { randomizedSendDelay } from '@modules/whatsapp/infrastructure/whatsapp-transport.worker';
import { WA_SEND_DELAY_MIN_MS, WA_SEND_DELAY_MAX_MS } from '@modules/whatsapp/domain/whatsapp-lifecycle';

describe('D18 — randomized 30–60s per-channel send cooldown', () => {
  it('rng=0 returns the floor (30s)', () => {
    expect(randomizedSendDelay(() => 0)).toBe(WA_SEND_DELAY_MIN_MS);
    expect(WA_SEND_DELAY_MIN_MS).toBe(30_000);
  });

  it('rng→1 returns the ceiling (60s)', () => {
    expect(randomizedSendDelay(() => 0.999999)).toBe(WA_SEND_DELAY_MAX_MS);
    expect(WA_SEND_DELAY_MAX_MS).toBe(60_000);
  });

  it('every sample stays within [30s, 60s]', () => {
    for (let i = 0; i < 1000; i += 1) {
      const d = randomizedSendDelay();
      expect(d).toBeGreaterThanOrEqual(WA_SEND_DELAY_MIN_MS);
      expect(d).toBeLessThanOrEqual(WA_SEND_DELAY_MAX_MS);
    }
  });

  it('is actually randomized (not a constant)', () => {
    const samples = new Set(Array.from({ length: 50 }, () => randomizedSendDelay()));
    expect(samples.size).toBeGreaterThan(10);
  });
});
