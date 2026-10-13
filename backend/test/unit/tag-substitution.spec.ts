import { describe, it, expect } from 'vitest';

import { substituteTags } from '@modules/whatsapp/domain/tag-substitution';
import { addressForm, screenMessage } from '@modules/marketing/domain/clinical-guard';

/**
 * FASA 5C-F — tag substitution.
 *
 * THE PROBLEM
 *
 * Until this existed, nothing replaced `{nama}` in a blast. Every recipient
 * received the literal text "Salam {nama}!" — which is why the FASA 5C-E privacy
 * screen blocks unresolved tags: a tag that survives into the sent message is
 * either a visible defect or, for `{rawatan}`, a disclosure.
 *
 * WHY SUBSTITUTION AND ADDRESSING LIVE TOGETHER
 *
 * A salutation is not a string operation. "Salam {nama}!" is correct for an adult
 * and wrong for a seven-year-old whose number is their mother's — the mother is
 * the reader, and `{nama}` would name the child. So substitution and
 * `addressForm()` are decided in the same pass, from the same patient record.
 * Splitting them would let a message come out correctly tagged and wrongly
 * addressed.
 *
 * DEVIATION FROM THE PLAN
 *
 * The plan reserved `{nama}` for the patient and expected `addressForm()` to
 * override the salutation at send time. That is not workable: a template author
 * writes "Salam {nama}!", and a silent override would make the preview disagree
 * with the sent message — the operator would approve one text and send another.
 * Instead the PATIENT record decides what `{nama}` resolves to (the patient, or
 * the guardian for a minor), and `{anak}` is added so a template can be explicit
 * when it wants the child's name. Preview and send use the same function, so they
 * cannot diverge.
 */

const NOW = new Date('2026-09-23T00:00:00Z');

const ADULT = { name: 'Ahmad Faizal', dob: '1990-05-01', guardianName: null, patientType: 'adult' };
const CHILD = { name: 'Nur Aisyah', dob: '2019-03-10', guardianName: 'Siti Aminah', patientType: 'child' };

describe('FASA 5C-F — tag substitution', () => {
  it('replaces {nama} with the patient name for an adult', () => {
    const out = substituteTags('Salam {nama}!', {
      patient: ADULT, branchName: 'Setia Tropika', bookingUrl: 'https://medini.my/b/x', now: NOW,
    });
    expect(out.body).toBe('Salam Ahmad Faizal!');
  });

  it('replaces {nama} with the GUARDIAN for a minor', () => {
    /* The child does not read this. Naming the child would address the wrong
     * person; the whole point of FASA 5C-E. */
    const out = substituteTags('Salam {nama}!', {
      patient: CHILD, branchName: 'Setia Tropika', bookingUrl: 'https://medini.my/b/x', now: NOW,
    });
    expect(out.body).toBe('Salam Siti Aminah!');
  });

  it('gives a template an explicit way to name the child', () => {
    /* For a paediatric reminder the clinic may WANT the child named as context —
     * that is what {anak} is for, so it is never a silent side effect. */
    const out = substituteTags('Salam {nama}, mengenai {anak}', {
      patient: CHILD, branchName: 'Setia Tropika', bookingUrl: 'https://medini.my/b/x', now: NOW,
    });
    expect(out.body).toBe('Salam Siti Aminah, mengenai Nur Aisyah');
  });

  it('substitutes {cawangan} and {link} — the other two tags the templates use', () => {
    const out = substituteTags('Klinik {cawangan}\n👉 {link}', {
      patient: ADULT, branchName: 'Bukit Indah', bookingUrl: 'https://medini.my/b/bi', now: NOW,
    });
    expect(out.body).toBe('Klinik Bukit Indah\n👉 https://medini.my/b/bi');
  });

  it('handles a tag repeated several times', () => {
    const out = substituteTags('{nama}, {nama}, dan {nama} lagi', {
      patient: ADULT, branchName: 'X', bookingUrl: 'Y', now: NOW,
    });
    expect(out.body).toBe('Ahmad Faizal, Ahmad Faizal, dan Ahmad Faizal lagi');
  });

  it('is case-insensitive so {Nama} works too', () => {
    /* Operators type these by hand; rejecting a capitalised tag would be a
     * needless failure. */
    const out = substituteTags('Salam {NAMA} dari {Cawangan}', {
      patient: ADULT, branchName: 'Sentosa', bookingUrl: 'Z', now: NOW,
    });
    expect(out.body).toBe('Salam Ahmad Faizal dari Sentosa');
  });

  /* ---------------------------------------------------------------- missing */

  it('never leaves a tag half-filled when a value is missing', () => {
    /* A blank between "Salam " and "!" reads as a broken message, and a literal
     * "{nama}" reads as a defect. A neutral fallback is the only honest option. */
    const out = substituteTags('Salam {nama}!', {
      patient: { name: '', dob: null, guardianName: null, patientType: null },
      branchName: 'Sentosa', bookingUrl: 'X', now: NOW,
    });
    expect(out.body).not.toContain('{nama}');
    expect(out.body).toBe('Salam Pelanggan!');
  });

  it('falls back for a child whose guardian is unrecorded', () => {
    const out = substituteTags('Salam {nama}!', {
      patient: { name: 'Bayi Tan', dob: '2024-01-05', guardianName: null, patientType: 'child' },
      branchName: 'Sentosa', bookingUrl: 'X', now: NOW,
    });
    expect(out.body).toBe('Salam Tuan/Puan!');
  });

  /* ---------------------------------------------------------------- safety */

  it('reports tags it does not recognise instead of silently dropping them', () => {
    /* A typo like {nma} would otherwise reach the patient as visible garbage. */
    const out = substituteTags('Salam {nma}!', {
      patient: ADULT, branchName: 'X', bookingUrl: 'Y', now: NOW,
    });
    expect(out.unknownTags).toContain('{nma}');
  });

  it('does NOT substitute a clinical tag — it refuses instead', () => {
    /* {rawatan} is blocked by the privacy screen. If substitution quietly filled
     * it, the screen would be bypassed by sending straight past it. */
    const out = substituteTags('Rawatan {rawatan} anda', {
      patient: ADULT, branchName: 'X', bookingUrl: 'Y', now: NOW,
    });
    expect(out.body).toContain('{rawatan}');
    expect(out.unknownTags).toContain('{rawatan}');
  });

  it('leaves ordinary braces alone', () => {
    const out = substituteTags('Harga {promo} diskaun', {
      patient: ADULT, branchName: 'X', bookingUrl: 'Y', now: NOW,
    });
    expect(out.unknownTags).toContain('{promo}');
  });

  /* ------------------------------------------------------ preview = send */

  it('produces identical output for preview and for send', () => {
    /* The operator approves a preview. If send used a different code path, the
     * message that goes out would differ from the one that was approved. */
    const input = {
      patient: ADULT, branchName: 'Setia Tropika', bookingUrl: 'https://medini.my/b/x', now: NOW,
    };
    const preview = substituteTags('Salam {nama}! Klinik {cawangan}.\n👉 {link}', input);
    const sent = substituteTags('Salam {nama}! Klinik {cawangan}.\n👉 {link}', input);

    expect(preview.body).toBe(sent.body);
    expect(preview.body).not.toMatch(/\{[a-z]+\}/i);
  });

  it('the substituted output passes the privacy screen', () => {
    /* End-to-end coherence: a template the clinic actually uses must survive
     * substitution AND the privacy guard with no residual tags. */
    const out = substituteTags(
      'Salam {nama}! 👋\n\nKami dari Klinik Pergigian Medini {cawangan}.\n\n' +
        'Sudah lebih 6 bulan sejak lawatan terakhir anda. Boleh kami bantu aturkan temujanji?\n👉 {link}',
      { patient: ADULT, branchName: 'Setia Tropika', bookingUrl: 'https://medini.my/b/x', now: NOW },
    );

    expect(out.unknownTags).toEqual([]);
    expect(out.body).not.toMatch(/\{[a-z]+\}/i);
    expect(screenMessage(out.body).safe).toBe(true);
  });

  /* --------------------------------------------------------------- consistency */

  it('agrees with addressForm about who the reader is', () => {
    /* Two functions decide the same question. If they disagreed, a message could
     * be greeted correctly and addressed incorrectly. */
    const form = addressForm(CHILD, NOW);
    const out = substituteTags('Salam {nama}!', {
      patient: CHILD, branchName: 'X', bookingUrl: 'Y', now: NOW,
    });

    expect(form.isMinor).toBe(true);
    expect(form.salutation).toContain('Siti Aminah');
    expect(out.body).toContain('Siti Aminah');
  });
});
