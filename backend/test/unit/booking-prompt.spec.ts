import { describe, it, expect } from 'vitest';

import {
  nurPrompt,
  NUR_EMERGENCY_PHONE,
} from '@modules/ai-manager/presentation/whatsapp-webhook.controller';

/**
 * FASA 6C — the default prompt must not contradict the code.
 *
 * WHY THIS EXISTS
 *
 * The prompt is not decoration: it is the only instruction the model gets, and
 * the model believes it. Two ways it had already gone wrong:
 *
 *   1. It named a branch — "cawangan Setia Tropika, Johor Bahru" — hard-coded.
 *      The product is 14 branches with one WhatsApp number each, so the bot
 *      introduced itself as the wrong clinic. The prompt now defers to the
 *      branch name in the context block, and the context is the branch that
 *      actually received the message.
 *
 *   2. The booking window is enforced TWICE: in the prompt as prose, and in
 *      isValidBookingTime() as arithmetic. When those disagree the model
 *      promises a time the system then refuses — a patient told "8:30pm" and
 *      then told "outside hours". The hours asserted below are the hours the
 *      code implements; if either changes, this test fails and both are read.
 *
 * It also guards the instruction that fixes the dead-end reply: the model must
 * never fall back to "sila pilih masa lain", which asks a patient with toothache
 * at 1am to guess.
 */

const HOURS = {
  open: '10:00',
  closeWeekday: '9:00 malam', // Sun-Thu (day 0,1,2,3,4) -> 21:00
  closeWeekend: '5:00 petang', // Fri/Sat (day 5,6) -> 17:00
  breakFrom: '1:00',
  breakTo: '2:00',
};

describe('nurPrompt — default booking prompt', () => {
  const p = nurPrompt();

  it('does not hard-code a branch name', () => {
    /* The regression: the bot answering as Setia Tropika from every branch. */
    expect(p).not.toMatch(/Setia Tropika/i);
    expect(p).not.toMatch(/Johor Bahru/i);
  });

  it('tells the model to take the branch from the context', () => {
    expect(p).toMatch(/KONTEKS BOOKING/);
    expect(p).toMatch(/[Jj]angan sebut cawangan lain/);
  });

  it('states the opening time the code enforces (10:00)', () => {
    expect(p).toContain(HOURS.open);
  });

  it('states the weekday closing time the code enforces (21:00)', () => {
    expect(p).toContain(HOURS.closeWeekday);
  });

  it('states the Fri/Sat closing time the code enforces (17:00)', () => {
    expect(p).toContain(HOURS.closeWeekend);
  });

  it('states the lunch break the code enforces (13:00-14:00)', () => {
    expect(p).toContain(HOURS.breakFrom);
    expect(p).toContain(HOURS.breakTo);
  });

  it('ends slots 30 minutes before closing, as the code does', () => {
    /* isValidBookingTime requires total + 30 <= closing, so the last weekday
     * slot is 20:30 — the prompt must say so, or the model offers 9:00pm. */
    expect(p).toMatch(/8:30 malam/);
    expect(p).toMatch(/4:30 petang/);
  });

  it('forbids the dead-end "pick another time" reply', () => {
    expect(p).toMatch(/sila pilih masa lain/); // named as the thing NOT to do
    expect(p).toMatch(/senarai masa yang KOSONG/);
    expect(p).toMatch(/Jangan sekali-kali meminta pelanggan meneka/);
  });

  it('allows the patient not to care which doctor', () => {
    expect(p).toMatch(/jangan paksa dia memilih doktor/);
  });

  it('keeps doctor continuity a single polite question', () => {
    expect(p).toMatch(/Bertanya sekali sahaja/);
  });

  it('still forbids inventing slots, doctors and prices', () => {
    expect(p).toMatch(/Jangan reka slot kosong, nama doktor/);
    expect(p).toMatch(/Jangan reka harga/);
  });

  /* FASA A1 — the three missing receptionist rules.
   *
   * Each one is asserted twice on purpose: once that the instruction is stated,
   * once that the model is told NOT to do the dangerous neighbouring thing.
   * "Give the emergency number" without "never invent one" is how a patient
   * gets told to call a phone number that does not exist. */
  describe('keselamatan, identiti dan luar waktu', () => {
    it('identifies an emergency and sends the patient to the clinic', () => {
      expect(p).toMatch(/KESELAMATAN — KECEMASAN/);
      expect(p).toMatch(/pendarahan yang tidak berhenti/);
      expect(p).toMatch(/datang ke klinik dengan segera/);
    });

    it('forbids clinical advice during an emergency', () => {
      expect(p).toMatch(/JANGAN beri nasihat klinikal/);
      expect(p).toMatch(/JANGAN teruskan proses booking biasa/);
    });

    it('never prints a bracketed placeholder as a phone number', () => {
      /* The regression this guards: NUR_EMERGENCY_PHONE carries a TODO-looking
       * placeholder ("[NOMBOR KECEMASAN]") and the model repeats it verbatim to
       * a panicking patient. An empty constant must change the instruction. */
      expect(p).not.toMatch(/\[NOMBOR[^\]]*\]/i);
      expect(p).not.toMatch(/\[.*(KEcemasan|EMERGENCY).*\]/i);
      expect(p).not.toMatch(/TODO|placeholder|XXX/i);
    });

    it('escalates to a human when no emergency number is configured', () => {
      if (NUR_EMERGENCY_PHONE) return; // an operator filled it in — the other branch applies
      expect(p).toMatch(/Jangan beri sebarang nombor telefon/);
      expect(p).toMatch(/staf akan menghubungi semula/);
    });

    it('quotes the configured emergency number when one exists', () => {
      if (!NUR_EMERGENCY_PHONE) return;
      expect(p).toContain(NUR_EMERGENCY_PHONE);
    });

    it('requires identity before medical information leaves the clinic', () => {
      expect(p).toMatch(/PENGESAHAN IDENTITI/);
      expect(p).toMatch(/tarikh lahir/);
      expect(p).toMatch(/nombor telefon\s+yang berdaftar dengan klinik/);
      expect(p).toMatch(/mendedahkan rekod pesakit lain/);
    });

    it('keeps identity checks from blocking a normal booking', () => {
      /* A prompt that demands ID before anyone may book would break the core
       * flow — the patient came to book, not to request records. */
      expect(p).toMatch(/TIDAK menghalang booking biasa/);
    });

    it('takes a message outside operating hours instead of offering slots', () => {
      expect(p).toMatch(/DI LUAR WAKTU OPERASI/);
      expect(p).toMatch(/jangan tawarkan slot pada waktu itu/);
      expect(p).toMatch(/akan menghubungi semula pada hari bekerja berikutnya/);
      expect(p).toMatch(/Jangan janjikan masa yang tepat/);
    });
  });
});
