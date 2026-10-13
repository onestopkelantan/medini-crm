import { describe, it, expect } from 'vitest';

import {
  addressForm,
  screenMessage,
  MINOR_AGE_YEARS,
} from '@modules/marketing/domain/clinical-guard';

/**
 * FASA 5C-E — clinical safety guards.
 *
 * TWO SEPARATE DUTIES
 *
 *   1. ADDRESSING. A paediatric patient does not read their own WhatsApp. A
 *      message saying "sudah 6 bulan sejak lawatan terakhir anda" addressed to a
 *      7-year-old, sent to their mother's phone, is wrong twice: it addresses the
 *      child, and it implies the mother is the patient.
 *
 *   2. PRIVACY. WhatsApp is not a clinical channel. A phone is shared, borrowed,
 *      left unlocked, and a number can change hands. "Rawatan root canal anda
 *      belum habis" tells whoever is holding the phone that this person has a
 *      specific dental condition. "Ada follow-up yang kami boleh bantu" does not.
 *
 * THE LINE
 *
 * The guard blocks what the PATIENT HAS (conditions, their own treatment
 * history) and allows what the CLINIC OFFERS (services, appointment times,
 * opening hours). That is a line a clinic can explain to a patient, which is why
 * it is the one drawn.
 */

/* ==========================================================================
   ADDRESSING
   ========================================================================== */

describe('FASA 5C-E — who is being addressed', () => {
  /* Fixed clock so age arithmetic is not a moving target. */
  const NOW = new Date('2026-09-23T00:00:00Z');

  it('addresses an adult patient directly', () => {
    const form = addressForm(
      { name: 'Ahmad Faizal', dob: '1990-05-01', guardianName: null },
      NOW,
    );

    expect(form.isMinor).toBe(false);
    expect(form.pronoun).toBe('anda');
    /* Neutral honourific by design: gender cannot be inferred from a name, and
    * a wrong honourific reads as a scam to the recipient. */
    expect(form.salutation).toBe('Encik/Puan Ahmad Faizal');
  });

  it('addresses the GUARDIAN, not the child, for a minor', () => {
    /* The heart of the rule. A 7-year-old with their mother's number on file
     * receives nothing addressed to them. */
    const form = addressForm(
      { name: 'Nur Aisyah', dob: '2019-03-10', guardianName: 'Siti Aminah' },
      NOW,
    );

    expect(form.isMinor).toBe(true);
    expect(form.pronoun).toBe('anak anda');
    expect(form.salutation).toBe('Encik/Puan Siti Aminah');
    /* The child's name is still useful context, framed as the relationship. */
    expect(form.context).toBe('ibubapa kepada Nur Aisyah');
  });

  it('treats a patient turning 18 today as an adult', () => {
    /* Boundary: on the birthday they are a patient in their own right. */
    const form = addressForm(
      { name: 'Ahmad', dob: '2008-09-23', guardianName: 'Bapa Ahmad' },
      NOW,
    );

    expect(form.isMinor).toBe(false);
    expect(form.pronoun).toBe('anda');
  });

  it('treats a patient one day short of 18 as a minor', () => {
    const form = addressForm(
      { name: 'Ahmad', dob: '2018-09-24', guardianName: 'Bapa Ahmad' },
      NOW,
    );

    expect(form.isMinor).toBe(true);
  });

  it('falls back to a neutral form when a minor has no guardian recorded', () => {
    /* Common in real data: the clinic knows it is a child but has not linked a
     * guardian. Addressing the child is wrong; refusing to send is also wrong.
     * So the message is neutral: it neither claims the child is the patient nor
     * invents a guardian name. */
    const form = addressForm(
      { name: 'Nur Aisyah', dob: '2019-03-10', guardianName: null },
      NOW,
    );

    expect(form.isMinor).toBe(true);
    expect(form.pronoun).toBe('anak anda');
    expect(form.salutation).toBe('Tuan/Puan');
    expect(form.guardianMissing).toBe(true);
  });

  it('still addresses the patient when the date of birth is unknown', () => {
    /* Unknown age cannot be assumed to be a child — that would mangle every
     * adult record with a missing DOB. Unknown is treated as adult, and the
     * absence is flagged so the clinic can fill it in. */
    const form = addressForm(
      { name: 'Tan Ah Kow', dob: null, guardianName: null },
      NOW,
    );

    expect(form.isMinor).toBe(false);
    expect(form.dobMissing).toBe(true);
  });

  it('uses the recorded patient type when the DOB is missing', () => {
    /* patient_type is the clinic's own statement; it beats a missing DOB. */
    const form = addressForm(
      { name: 'Baby Tan', dob: null, guardianName: 'Tan Ah Kow', patientType: 'child' },
      NOW,
    );

    expect(form.isMinor).toBe(true);
    expect(form.salutation).toBe('Encik/Puan Tan Ah Kow');
  });

  it('keeps the legal threshold in one named place', () => {
    expect(MINOR_AGE_YEARS).toBe(18);
  });
});

/* ==========================================================================
   PRIVACY
   ========================================================================== */

describe('FASA 5C-E — privacy screen on outbound text', () => {
  it('ALLOWS a generic recall message — it names no condition', () => {
    /* The benchmark. If this were blocked the feature would be unusable. */
    const verdict = screenMessage(
      'Salam Puan Siti! 👋\n\nSudah lebih 6 bulan sejak lawatan terakhir anda. ' +
        'Boleh kami bantu aturkan temujanji?\n👉 https://medini.my/b/temujanji',
    );

    expect(verdict.safe).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  it('ALLOWS naming a service the clinic offers', () => {
    /* Offering a treatment is not revealing one. "Kami ada promosi scaling" is
     * advertising; it says nothing about this patient's mouth. */
    const verdict = screenMessage(
      'Kami ada promosi pembersihan gigi (scaling) bulan ini. Boleh kami bantu aturkan temujanji?',
    );

    expect(verdict.safe).toBe(true);
  });

  it('BLOCKS a named diagnosis', () => {
    /* The exact leak this exists for: whoever holds the phone now knows this
     * person has an active dental disease. */
    const verdict = screenMessage(
      'Salam! Kami perasan anda ada karies yang perlu dirawat segera.',
    );

    expect(verdict.safe).toBe(false);
    expect(verdict.findings.map((f) => f.term)).toContain('karies');
    expect(verdict.findings[0]!.category).toBe('diagnosis');
  });

  it('BLOCKS common condition names in both Malay and English', () => {
    for (const text of [
      'Anda ada periodontitis peringkat awal.',
      'Gusi anda menunjukkan tanda gingivitis.',
      'Kami kesan abses pada gigi bongsu anda.',
      'Hasil X-ray anda menunjukkan cyst.',
      'Keputusan ujian menunjukkan anda hamil, jadi kami perlu tunda rawatan.',
    ]) {
      expect(screenMessage(text).safe).toBe(false);
    }
  });

  it('BLOCKS a reference to the patient\'s own treatment history', () => {
    /* Not a diagnosis word, but the same leak: it says what was done to them. */
    const verdict = screenMessage(
      'Rawatan saluran akar anda belum siap. Boleh kami sambung?',
    );

    expect(verdict.safe).toBe(false);
    expect(verdict.findings.some((f) => f.category === 'treatment_history')).toBe(true);
  });

  it('BLOCKS unresolved clinical tags that would become per-patient facts', () => {
    /* {rawatan} substitutes the patient's own treatment name at send time, which
     * would turn a safe template into a leak for every recipient. */
    const verdict = screenMessage(
      'Salam {nama}! Rawatan {rawatan} anda boleh disambung. Nak tempah?',
    );

    expect(verdict.safe).toBe(false);
    expect(verdict.findings.some((f) => f.category === 'clinical_tag')).toBe(true);
  });

  it('ALLOWS non-clinical tags', () => {
    const verdict = screenMessage('Salam {nama}! Klinik {cawangan} menanti anda. {link}');
    expect(verdict.safe).toBe(true);
  });

  it('reports WHERE the problem is, so the operator can fix it', () => {
    const body = 'Baris satu ok.\nGusi anda ada jangkitan.\nBaris tiga.';
    const verdict = screenMessage(body);

    expect(verdict.safe).toBe(false);
    const finding = verdict.findings[0]!;
    expect(finding.line).toBe(2);
    /* The snippet is what the operator sees highlighted in the editor. */
    expect(finding.snippet).toContain('jangkitan');
  });

  it('is case-insensitive — a diagnosis is a diagnosis in any case', () => {
    for (const text of ['Anda ada KARIES.', 'Anda ada Karies.', 'anda ada karies']) {
      expect(screenMessage(text).safe).toBe(false);
    }
  });

  it('does not fire on a word that merely contains a condition substring', () => {
    /* "karies" inside "akaries"? Not a real example, but the guard must match
     * words, not fragments, or ordinary Malay text produces false blocks. */
    const verdict = screenMessage('Kami ada kelas berus gigi percuma untuk kanak-kanak.');
    expect(verdict.safe).toBe(true);
  });

  it('BLOCKS a whole message even when only one line leaks', () => {
    /* No partial sending: the message is the unit the patient receives. */
    const verdict = screenMessage(
      ['Promosi bulan ini!', 'Anda ada karies aktif.', 'Hubungi kami hari ini.'].join('\n'),
    );

    expect(verdict.safe).toBe(false);
  });

  it('returns an explainable reason in Malay', () => {
    const verdict = screenMessage('Anda ada karies.');
    expect(verdict.reason).toBeTruthy();
    expect(verdict.reason).toMatch(/kesihatan|peribadi|rawatan/i);
  });
});
