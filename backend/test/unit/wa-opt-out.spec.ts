import { describe, it, expect } from 'vitest';

import {
  detectStopRequest,
  STOP_KEYWORDS,
} from '@modules/whatsapp/application/wa-opt-out.service';

/**
 * FASA 5E — recognising a STOP request.
 *
 * WHY THE MATCHING IS DELIBERATELY NARROW
 *
 * A false positive here is worse than a miss. If a patient asking
 * "boleh saya stop rawatan ini?" or "doctor cakap kena stop makan ubat ni"
 * is silently added to the STOP list, they stop receiving appointment reminders
 * and recalls — a clinical harm, and nobody notices. A missed opt-out is merely
 * inconvenient: the patient repeats themselves, or blocks the number.
 *
 * So: short, command-like messages only, matched as whole words rather than
 * substrings. These tests pin both directions — the opt-outs that MUST be
 * caught, and the treatment conversations that must NOT be.
 */

describe('FASA 5E — STOP detection', () => {
  /* ------------------------------------------------------------ must catch */

  it('catches the plain commands, any case', () => {
    for (const text of [
      'STOP', 'stop', 'Stop', 'STOP!', 'stop.', 'berhenti', 'BERHENTI',
      'unsubscribe', 'UNSUB', 'opt out', 'optout',
    ]) {
      expect(detectStopRequest(text), `should catch: ${text}`).not.toBeNull();
    }
  });

  it('catches a short instruction that starts with a stop word', () => {
    for (const text of [
      'stop hantar mesej',
      'STOP whatsapp saya',
      'jangan hantar mesej lagi',
      'jangan mesej saya',
      'tak nak terima mesej',
      'jangan ganggu saya',
    ]) {
      expect(detectStopRequest(text), `should catch: ${text}`).not.toBeNull();
    }
  });

  it('returns WHICH keyword matched, for the audit trail', () => {
    expect(detectStopRequest('STOP')).toBe('stop');
    expect(detectStopRequest('Berhenti')).toBe('berhenti');
    expect(detectStopRequest('unsubscribe')).toBe('unsubscribe');
  });

  /* -------------------------------------------------- must NOT false-positive */

  it('does NOT treat a treatment question as an opt-out', () => {
    /* THE POINT: these are patients discussing care, not asking to be left
     * alone. Removing them from reminders would be a clinical harm. */
    for (const text of [
      'boleh saya stop rawatan ini?',
      'doctor cakap kena stop makan ubat ni',
      'saya nak tanya pasal stop bleeding gigi',
      'berapa lama kena stop makan sebelum cabut gigi',
      'sakit tak berhenti sejak semalam',
      'gusi saya berhenti berdarah dah',
    ]) {
      expect(detectStopRequest(text), `must NOT catch: ${text}`).toBeNull();
    }
  });

  it('does NOT catch ordinary booking messages', () => {
    for (const text of [
      'saya nak booking',
      'harga cabut gigi berapa',
      'boleh buat temujanji hari sabtu?',
      'terima kasih',
      'ok',
      'Salam',
    ]) {
      expect(detectStopRequest(text), `must NOT catch: ${text}`).toBeNull();
    }
  });

  it('ignores a long message even if it contains a stop word', () => {
    /* A paragraph is a conversation. Only short commands are treated as
     * instructions, which keeps a stray "stop" inside a longer question from
     * unmasking a patient out of their reminders. */
    const long = 'salam doktor saya nak tanya tentang rawatan root canal yang lepas tu ' +
      'sebab doktor kata kena stop dulu sebelum buat tampalan dan sekarang saya rasa ok';
    expect(long.length).toBeGreaterThan(60);
    expect(detectStopRequest(long)).toBeNull();
  });

  /* -------------------------------------------------------------- edge cases */

  it('handles empty, whitespace and non-string input', () => {
    expect(detectStopRequest('')).toBeNull();
    expect(detectStopRequest('   ')).toBeNull();
    expect(detectStopRequest('\n\t')).toBeNull();
    expect(detectStopRequest(undefined as unknown as string)).toBeNull();
    expect(detectStopRequest(null as unknown as string)).toBeNull();
  });

  it('tolerates surrounding punctuation and extra spaces', () => {
    expect(detectStopRequest('  STOP!!!  ')).not.toBeNull();
    expect(detectStopRequest('stop  hantar  mesej')).not.toBeNull();
    expect(detectStopRequest('"stop"')).not.toBeNull();
  });

  it('a stop word in the MIDDLE of a sentence is not an instruction', () => {
    /* Only a leading stop word (or the word standing alone) counts. */
    expect(detectStopRequest('tolong stop kan sakit ni')).toBeNull();
    expect(detectStopRequest('bila nak stop ni doktor')).toBeNull();
  });

  it('every advertised keyword is actually reachable', () => {
    /* Guards against a keyword being added to the list but never matched. */
    for (const kw of STOP_KEYWORDS) {
      expect(detectStopRequest(kw), `keyword unreachable: ${kw}`).not.toBeNull();
      /* And in upper case, which is how people actually shout it. */
      expect(detectStopRequest(kw.toUpperCase()), `uppercase unreachable: ${kw}`).not.toBeNull();
    }
  });
});
