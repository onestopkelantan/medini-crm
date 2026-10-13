/**
 * forms.ts — Fasa 1G domain: serial numbers and form families.
 *
 * WHY THIS IS A DOMAIN MODULE AND NOT SERVICE CODE
 *
 * The serial format is a rule, not a query. `MC-STP-2026-0001` is how a clinic locates a
 * certificate years later, and the rule that makes it work — never reuse, never skip,
 * always five digits — has to hold no matter which screen or script issues the form. So
 * it lives here, where it can be tested without a database or an HTTP request.
 */

/* --------------------------------------------------------------- form families */

/** The four printable form families. `consent` is the pre-existing one. */
export const FORM_KINDS = ['consent', 'mc', 'pdpa', 'time_off'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export function isFormKind(v: unknown): v is FormKind {
  return typeof v === 'string' && (FORM_KINDS as readonly string[]).includes(v);
}

/** Which subject a form is issued TO. An MC and a consent go to a patient; a time-off
 * form goes to a staff member. Encoding this stops an MC being issued against a staff
 * row, which would leave the certificate with no patient to file it under. */
export const FORM_SUBJECT: Record<FormKind, 'patient' | 'staff' | 'both'> = {
  consent: 'patient',
  mc: 'patient',
  pdpa: 'patient',
  time_off: 'staff',
};

/* ------------------------------------------------------------------- serials */

/** Five digits is what makes the sequence sortable as text in a filename or a ledger.
 * Wider only if the clinic ever exceeds 99,999 forms of one kind in a year. */
const SERIAL_PAD = 5;

/**
 * Build a serial from its parts.
 *
 * The branch segment is uppercased and stripped to A-Z0-9 so a branch named
 * "Setia Tropika" cannot put a space into a filename or a URL. An empty branch segment
 * is dropped rather than left as a stray dash: `MC--2026-0001` looks like a bug at the
 * exact moment someone is copying it onto a form by hand.
 */
export function buildSerialNo(
  kind: FormKind,
  branchCode: string | null | undefined,
  year: number,
  sequence: number,
): string {
  const prefix = serialPrefix(kind);
  /* The branch segment is used WHOLE — no truncation.
   *
   * An earlier version sliced this to 8 characters, and "bukit-indah" then rendered as
   * "BUKITIND" while "bukit-indah-2" would also render as "BUKITIND": two different
   * clinics, one indistinguishable serial. The longest real code in the database is 18
   * characters after separators are stripped ("klinik-pergigian-uda"), so the column is
   * sized at 24 and every code fits without loss.
   *
   * Stripping separators is still done — a '/' or a space would break a filename or URL —
   * but no part of the code is dropped. */
  const seg = (branchCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error(`Invalid serial year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Serial sequence must be a positive integer, got ${sequence}`);
  }

  const n = String(sequence).padStart(SERIAL_PAD, '0');
  return seg ? `${prefix}-${seg}-${year}-${n}` : `${prefix}-${year}-${n}`;
}

/**
 * The year a serial belongs to.
 *
 * UTC, NOT LOCAL TIME. A form issued at 23:59 on 31 December in Kuala Lumpur is
 * 15:59 UTC on 31 December — fine. But the reverse case is what matters: this server
 * runs in Asia/Kuala_Lumpur, so a UTC timestamp of 31 Dec 16:30 is 1 Jan 00:30 locally.
 * Taking the local year there would file a December form under the next year's counter,
 * and in January the clinic would find its serial sequence starting at a number it never
 * issued.
 *
 * The column is `DATETIME(6)` written with `CURRENT_TIMESTAMP(6)` and read back as UTC
 * by the driver, so UTC is the single consistent frame for both the counter key and this
 * function. When the two disagree, the sequence corrupts.
 */
export function serialYearOf(issuedAt: Date): number {
  return issuedAt.getUTCFullYear();
}

/** The serial prefix for each family. One place, so `buildSerialNo` and `serialMatches`
 * can never disagree about what "MC" means. */
export function serialPrefix(kind: FormKind): string {
  return kind === 'mc' ? 'MC' : kind === 'pdpa' ? 'PDPA' : kind === 'time_off' ? 'TO' : 'CONSENT';
}

/**
 * Does this serial belong to this family and year?
 *
 * The prefix is matched as a WHOLE segment (`MC-...`, not `MC` occurring anywhere):
 * a bare `startsWith(prefix)` would accept `PDPA-...` for kind `pdpa` but also, if the
 * kinds were ever renamed, match a longer prefix's tail. Matching the segment boundary
 * keeps the check honest.
 */
export function serialMatches(kind: FormKind, serialNo: string, year: number): boolean {
  return serialNo.startsWith(`${serialPrefix(kind)}-`) && serialNo.includes(`-${year}-`);
}

/* ------------------------------------------------------------- placeholder text */

/**
 * The starter template body for each family.
 *
 * THESE ARE DELIBERATELY PLACEHOLDERS, NOT LEGAL TEXT.
 *
 * An MC has consequences with an employer, and a PDPA notice has to satisfy the Personal
 * Data Protection Act 2010. Inventing that wording would be worse than shipping an empty
 * field, because a plausible-looking but wrong notice gets USED. Each body therefore
 * states plainly that it is a placeholder and lists what the clinic still has to supply,
 * so the gap is visible on the printed page rather than discoverable after a complaint.
 */
export const PLACEHOLDER_BODY: Record<FormKind, string> = {
  consent: '', /* consent templates pre-date this module and are unaffected */
  mc: [
    '[TEKS BELUM DIISI — draf tempat letak]',
    '',
    'Surat akuan sakit ini memerlukan butiran berikut sebelum boleh dikeluarkan:',
    '  1. Nama dan alamat klinik berdaftar',
    '  2. Nama dan no. pendaftaran doktor (MMC)',
    '  3. Diagnosis dan tempoh rehat yang disyorkan',
    '  4. Ruang tandatangan dan cop doktor',
    '',
    'Format akhir hendaklah disemak dengan keperluan majikan/pihak berkuasa.',
  ].join('\n'),
  pdpa: [
    '[NOTIS BELUM DIISI — draf tempat letak]',
    '',
    'Notis Perlindungan Data Peribadi ini perlu disediakan mengikut Akta Perlindungan',
    'Data Peribadi 2010. Kandungan berikut perlu disahkan oleh penasihat undang-undang:',
    '  1. Jenis data peribadi yang dikumpul',
    '  2. Tujuan pemprosesan',
    '  3. Pihak ketiga yang menerima data',
    '  4. Hak pesakit untuk mengakses dan membetulkan',
    '  5. Hubungan pegawai perlindungan data',
    '',
    'JANGAN diedarkan kepada pesakit sebelum disemak.',
  ].join('\n'),
  time_off: [
    '[BORANG BELUM DIISI — draf tempat letak]',
    '',
    'Borang permohonan cuti ini memerlukan butiran berikut:',
    '  1. Jenis cuti (tahunan / sakit / kecemasan / tanpa gaji)',
    '  2. Tarikh mula dan tamat',
    '  3. Kelulusan penyelia',
    '  4. Kuota cuti tahunan mengikut Akta Kerja 1955',
    '',
    'Rujuk dasar HR klinik sebelum digunakan.',
  ].join('\n'),
};

/** True when the body is still an unedited placeholder. The screen uses this to show a
 * warning badge so a placeholder is never issued to a patient without someone noticing. */
export function isPlaceholderBody(kind: FormKind, body: string): boolean {
  if (kind === 'consent') return false;
  return body.trim().startsWith('[TEKS BELUM DIISI')
    || body.trim().startsWith('[NOTIS BELUM DIISI')
    || body.trim().startsWith('[BORANG BELUM DIISI');
}
