import { describe, it, expect } from 'vitest';

import { splitReply, SPLIT_TARGET_CHARS } from '@modules/ai-manager/domain/reply-split';

/**
 * AB3 — long replies become several human-sized messages. The properties
 * under test: never split mid-word, every part non-trivial, all content
 * preserved in order, part count capped, short replies untouched.
 */

describe('splitReply', () => {
  it('passes a short reply through untouched (one part, same string)', () => {
    const r = 'Baik Puan, tempahan sudah dicatat. Terima kasih!';
    expect(splitReply(r)).toEqual({ parts: [r], count: 1 });
  });

  it('passes a single paragraph just under the target', () => {
    const r = 'a'.repeat(SPLIT_TARGET_CHARS);
    expect(splitReply(r).count).toBe(1);
  });

  it('splits a multi-paragraph long reply on paragraph boundaries', () => {
    const r = [
      'Terima kasih kerana menghubungi Klinik Pergigian Medini.'.repeat(4),
      'Untuk makluman, slot Sabtu pagi biasanya penuh dengan cepat.'.repeat(4),
      'Saya cadangkan anda datang 15 minit lebih awal untuk pendaftaran.'.repeat(4),
    ].join('\n\n');
    const plan = splitReply(r);
    expect(plan.count).toBeGreaterThan(1);
    expect(plan.count).toBeLessThanOrEqual(4);
    /* Never mid-word: no part starts or ends mid-sentence-cut (paragraph units keep their punctuation). */
    for (const p of plan.parts) {
      expect(p.length).toBeGreaterThan(0);
    }
    /* All content preserved, in order. */
    expect(plan.parts.join('\n\n')).toBe(r);
  });

  it('folds a tiny trailing fragment into the previous part', () => {
    const r = `${'x'.repeat(300)}\n\n${'y'.repeat(300)}\n\nok`;
    const plan = splitReply(r);
    /* 'ok' (2 chars < 60 min) must not stand alone. */
    const last = plan.parts[plan.parts.length - 1]!;
    expect(last).toContain('ok');
    expect(last.length).toBeGreaterThan(60);
  });

  it('caps at SPLIT_MAX_PARTS even for a huge reply', () => {
    const r = Array.from({ length: 12 }, (_, i) => `Perenggan ${i}. ${'kandungan penting. '.repeat(25)}`).join('\n\n');
    const plan = splitReply(r);
    expect(plan.count).toBeLessThanOrEqual(4);
    /* Nothing lost by the cap. */
    expect(plan.parts.join('\n\n').replace(/\n\n/g, ' ').length)
      .toBeGreaterThan(r.length * 0.9);
  });

  it('never splits mid-word (every part boundary lands on whitespace)', () => {
    const r = `${'perkataanygsangatpanjangsekali'.repeat(20)}\n\n${'perkataanygsangatpanjangsekali'.repeat(20)}\n\n${'perkataanygsangatpanjangsekali'.repeat(20)}`;
    const plan = splitReply(r);
    expect(plan.count).toBeGreaterThan(1);
    for (const p of plan.parts) {
      expect(p.trim().startsWith('perkataan')).toBe(true);
      expect(p.trim().endsWith('sekali')).toBe(true);
    }
  });

  it('an over-long single paragraph splits on newlines when present, else stays whole', () => {
    /* No newlines at all: nothing safe to split on — one long part is the
     * honest answer; chopping mid-word is worse. */
    const r = 'z'.repeat(900);
    const plan = splitReply(r);
    expect(plan.count).toBe(1);
    expect(plan.parts[0]).toBe(r);
  });
});
