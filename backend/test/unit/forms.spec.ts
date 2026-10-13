/**
 * forms.spec.ts — serial-number and form-family rules (Fasa 1G).
 *
 * These tests target the rules that are expensive to get wrong and cheap to test:
 * a serial that collides, a serial that silently shifts shape, and a placeholder body
 * that reaches a patient looking like a real notice.
 */
import { describe, it, expect } from 'vitest';
import {
  FORM_KINDS, FORM_SUBJECT, buildSerialNo, isFormKind, isPlaceholderBody,
  PLACEHOLDER_BODY, serialYearOf, serialMatches,
} from '../../src/modules/clinical/domain/forms';

describe('form families', () => {
  it('recognises exactly the four families', () => {
    expect(FORM_KINDS).toEqual(['consent', 'mc', 'pdpa', 'time_off']);
    for (const k of FORM_KINDS) expect(isFormKind(k)).toBe(true);
  });

  it('rejects anything that is not a family', () => {
    /* A typo in a query string must not become a new form family. */
    for (const bad of ['MC', 'invoice', '', null, undefined, 42, {}]) {
      expect(isFormKind(bad)).toBe(false);
    }
  });

  it('knows who each form is issued to', () => {
    /* An MC issued against a staff row has no patient to file it under. */
    expect(FORM_SUBJECT.mc).toBe('patient');
    expect(FORM_SUBJECT.consent).toBe('patient');
    expect(FORM_SUBJECT.pdpa).toBe('patient');
    expect(FORM_SUBJECT.time_off).toBe('staff');
  });
});

describe('buildSerialNo', () => {
  it('builds the documented shape', () => {
    expect(buildSerialNo('mc', 'STP', 2026, 1)).toBe('MC-STP-2026-00001');
    expect(buildSerialNo('pdpa', 'STP', 2026, 42)).toBe('PDPA-STP-2026-00042');
    expect(buildSerialNo('time_off', 'STP', 2026, 7)).toBe('TO-STP-2026-00007');
  });

  it('pads to five digits so serials sort as text', () => {
    /* "MC-...-10" sorting before "MC-...-9" is the bug this prevents. */
    const nine = buildSerialNo('mc', 'STP', 2026, 9);
    const ten = buildSerialNo('mc', 'STP', 2026, 10);
    expect(nine < ten).toBe(true);
  });

  it('keeps the branch code WHOLE — no truncation', () => {
    /* A sliced segment produced "BUKITIND" for "bukit-indah" — and "bukit-indah-2" would
     * have produced the same string, so two different clinics would share a serial that
     * looks unique. The longest real code in the database is 18 characters after
     * separators are stripped, so every code must survive intact. */
    const long = buildSerialNo('mc', 'klinik-pergigian-uda', 2026, 1);
    expect(long).toBe('MC-KLINIKPERGIGIANUDA-2026-00001');
    /* Two codes that share a prefix must not collapse to the same serial. */
    const a = buildSerialNo('mc', 'bukit-indah', 2026, 1);
    const b = buildSerialNo('mc', 'bukit-indah-2', 2026, 1);
    expect(a).not.toBe(b);
    expect(a).toContain('BUKITINDAH');
    expect(b).toContain('BUKITINDAH2');
    /* Every code present in the database, verbatim. */
    for (const [code, expected] of [
      ['setia-tropika', 'SETIATROPIKA'],
      ['taman-mutiara-mas', 'TAMANMUTIARAMAS'],
      ['metropoint-kajang', 'METROPOINTKAJANG'],
      ['uda-business-centre', 'UDABUSINESSCENTRE'],
      ['norfaizah', 'NORFAIZAH'],
      ['pearl', 'PEARL'],
    ] as const) {
      expect(buildSerialNo('mc', code, 2026, 1)).toBe(`MC-${expected}-2026-00001`);
    }
  });

  it('omits the branch segment instead of leaving a stray dash', () => {
    /* "MC--2026-00001" reads as a bug to whoever copies it onto a form by hand. */
    const s = buildSerialNo('mc', null, 2026, 1);
    expect(s).toBe('MC-2026-00001');
    expect(s).not.toContain('--');
    expect(buildSerialNo('mc', '', 2026, 1)).toBe('MC-2026-00001');
    expect(buildSerialNo('mc', '   ', 2026, 1)).toBe('MC-2026-00001');
  });

  it('strips characters that would break a filename or URL', () => {
    /* "Setia Tropika" is a DISPLAY name, not a branch code; the code in the database is
     * 'setia-tropika'. A space or a '/' must never reach a filename or a URL. */
    expect(buildSerialNo('mc', 'Setia Tropika', 2026, 1)).toBe('MC-SETIATROPIKA-2026-00001');
    expect(buildSerialNo('mc', 'stp-01', 2026, 1)).toBe('MC-STP01-2026-00001');
    expect(buildSerialNo('mc', 'S/P', 2026, 1)).toBe('MC-SP-2026-00001');
    expect(buildSerialNo('mc', 'setia/tropika', 2026, 1)).toBe('MC-SETIATROPIKA-2026-00001');
  });

  it('refuses a sequence below 1', () => {
    /* A serial with no number is not a serial. Failing loudly beats writing "MC-STP-2026-00000". */
    expect(() => buildSerialNo('mc', 'STP', 2026, 0)).toThrow(/positive integer/);
    expect(() => buildSerialNo('mc', 'STP', 2026, -3)).toThrow(/positive integer/);
    expect(() => buildSerialNo('mc', 'STP', 2026, 1.5)).toThrow(/positive integer/);
  });

  it('refuses a year that cannot be a year', () => {
    expect(() => buildSerialNo('mc', 'STP', 1999, 1)).toThrow(/Invalid serial year/);
    expect(() => buildSerialNo('mc', 'STP', 3000, 1)).toThrow(/Invalid serial year/);
    expect(() => buildSerialNo('mc', 'STP', NaN, 1)).toThrow(/Invalid serial year/);
  });

  it('gives different families different prefixes', () => {
    /* Two families sharing a prefix would make a serial ambiguous when only the string survives. */
    const prefixes = FORM_KINDS.map((k) => buildSerialNo(k, 'STP', 2026, 1).split('-')[0]);
    expect(new Set(prefixes).size).toBe(FORM_KINDS.length);
  });
});

describe('serialYearOf', () => {
  it('takes the year from the issue date, not from today', () => {
    /* A form issued on 31 Dec but recorded on 1 Jan belongs to the OLD year — the counter
     * is keyed by the year the form was issued. */
    expect(serialYearOf(new Date('2026-12-31T23:59:00Z'))).toBe(2026);
    expect(serialYearOf(new Date('2027-01-01T00:01:00Z'))).toBe(2027);
  });
});

describe('serialMatches', () => {
  it('accepts a serial from its own family and year', () => {
    expect(serialMatches('mc', 'MC-STP-2026-00001', 2026)).toBe(true);
    expect(serialMatches('pdpa', 'PDPA-2026-00042', 2026)).toBe(true);
  });

  it('rejects a serial from another family', () => {
    expect(serialMatches('mc', 'PDPA-STP-2026-00001', 2026)).toBe(false);
  });

  it('rejects a serial from another year', () => {
    expect(serialMatches('mc', 'MC-STP-2025-00001', 2026)).toBe(false);
  });
});

describe('placeholder bodies', () => {
  it('marks every non-consent family as a placeholder', () => {
    /* The clinic has to supply MC and PDPA wording. Until then the printed page says so. */
    expect(isPlaceholderBody('mc', PLACEHOLDER_BODY.mc)).toBe(true);
    expect(isPlaceholderBody('pdpa', PLACEHOLDER_BODY.pdpa)).toBe(true);
    expect(isPlaceholderBody('time_off', PLACEHOLDER_BODY.time_off)).toBe(true);
  });

  it('stops calling a body a placeholder once it is replaced', () => {
    expect(isPlaceholderBody('mc', 'Surat akuan sakit. Pesakit disyorkan berehat 2 hari.')).toBe(false);
  });

  it('never flags a consent body — consent templates pre-date this module', () => {
    expect(isPlaceholderBody('consent', '[TEKS BELUM DIISI')).toBe(false);
  });

  it('warns loudly in the PDPA placeholder that it must not be distributed', () => {
    /* A wrong privacy notice is worse than a missing one: it gets handed to patients. */
    expect(PLACEHOLDER_BODY.pdpa).toContain('JANGAN diedarkan');
    expect(PLACEHOLDER_BODY.pdpa).toContain('2010');
  });

  it('leaves consent templates out of the placeholder map', () => {
    expect(PLACEHOLDER_BODY.consent).toBe('');
  });
});
