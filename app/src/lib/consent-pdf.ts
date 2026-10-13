/**
 * consent-pdf.ts — render a consent record to a printable PDF (Fasa 1E).
 *
 * WHY A REAL PDF AND NOT `window.print()`
 *
 * The user chose "add a library" over browser print. The reason that choice is the
 * right one here is consent-specific, not cosmetic:
 *
 *   - A consent form is SIGNED. Once the patient signs, the paper is evidence, and
 *     evidence needs a stable artifact that can be filed, emailed and archived
 *     unchanged. `window.print()` produces output whose pagination depends on the
 *     browser, the paper size and the user's margin settings — three things nobody
 *     at the clinic controls, on a document that may be reviewed years later.
 *   - A PDF can carry the exact text of the template VERSION that was agreed to.
 *     Consent is to a specific wording; a re-rendered HTML page cannot prove which
 *     wording the patient saw.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not embed a signature image or claim a signature exists. The record says
 * WHO consented, by WHICH method (verbal / written / electronic) and who witnessed
 * it — that is what the database stores, and inventing a visual signature the system
 * never captured would be a forged document.
 */

import { jsPDF } from "jspdf";

export interface ConsentPdfInput {
  /** Clinic / organisation line at the top of the form. */
  clinicName: string;
  templateTitle: string;
  templateVersion: number;
  templateBody: string;
  patientName: string;
  patientMrn: string;
  /** Free text: who agreed — "patient", "parent of minor", a name. */
  consentedBy: string;
  method: "verbal" | "written" | "electronic";
  /** ISO timestamp of `consentedAt`. */
  consentedAt: string;
  recordedByName: string | null;
  witnessedByName: string | null;
  notes: string | null;
  /** Labels passed in, so the PDF follows the UI language rather than being
   * hardcoded to one — the document is read by the patient, not the developer. */
  labels: {
    title: string; patient: string; mrn: string; consentedBy: string; method: string;
    date: string; recordedBy: string; witnessedBy: string; notes: string;
    statement: string; signature: string; version: string;
    methods: Record<string, string>;
  };
}

/** A4 is 210x297mm. Margins chosen so the form prints on any clinic printer
 * without scaling — a consent form that clips a signature line is useless. */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * Build the document and return it. Kept separate from the download so a test can
 * assert on the output without triggering a browser download.
 */
export function buildConsentPdf(input: ConsentPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  /* ---- header ---- */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(input.clinicName, MARGIN, y);
  y += 7;

  doc.setFontSize(13);
  doc.text(input.templateTitle, MARGIN, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(`${input.labels.version} ${input.templateVersion}`, MARGIN, y);
  doc.setTextColor(0);
  y += 4;

  doc.setDrawColor(180);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  /* ---- patient block ---- */
  doc.setFontSize(11);
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, MARGIN + 32, y, { maxWidth: CONTENT_W - 32 });
    y += 6;
  };

  row(input.labels.patient, input.patientName);
  row(input.labels.mrn, input.patientMrn);
  row(input.labels.consentedBy, input.consentedBy);
  row(input.labels.method, input.labels.methods[input.method] ?? input.method);
  row(input.labels.date, input.consentedAt);
  y += 2;

  /* ---- the agreed wording ---- */
  doc.setDrawColor(180);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  doc.setFontSize(10);
  const body = doc.splitTextToSize(input.templateBody, CONTENT_W);
  for (const line of body) {
    /* A4 has limited height and a long template must not silently lose its tail —
     * a consent form missing its last paragraph is worse than a page break. */
    if (y > PAGE_H - 40) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(line, MARGIN, y);
    y += 5;
  }
  y += 4;

  if (input.notes) {
    doc.setFontSize(9);
    const notes = doc.splitTextToSize(`${input.labels.notes}: ${input.notes}`, CONTENT_W);
    for (const line of notes) {
      if (y > PAGE_H - 45) { doc.addPage(); y = MARGIN; }
      doc.text(line, MARGIN, y);
      y += 4.5;
    }
    y += 4;
  }

  /* ---- attestation + signatures ---- */
  if (y > PAGE_H - 70) { doc.addPage(); y = MARGIN; }

  doc.setFontSize(9);
  const statement = doc.splitTextToSize(input.labels.statement, CONTENT_W);
  for (const line of statement) { doc.text(line, MARGIN, y); y += 4.5; }
  y += 12;

  /* The signature LINES are blank on purpose: this form is printed, signed by hand
   * and filed. The system stores the fact of consent, not a signature image, and a
   * pre-filled name in a signature box would misrepresent that. */
  const half = CONTENT_W / 2 - 5;
  doc.setDrawColor(120);
  doc.line(MARGIN, y, MARGIN + half, y);
  doc.line(MARGIN + half + 10, y, MARGIN + CONTENT_W, y);
  y += 5;

  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(input.consentedBy, MARGIN, y);
  const recorder = input.recordedByName ?? "";
  doc.text(recorder, MARGIN + half + 10, y);
  y += 4;
  doc.text(input.labels.signature, MARGIN, y);
  doc.text(`${input.labels.recordedBy}: ${recorder}`, MARGIN + half + 10, y);

  if (input.witnessedByName) {
    y += 10;
    doc.line(MARGIN, y, MARGIN + half, y);
    y += 5;
    doc.text(input.witnessedByName, MARGIN, y);
    y += 4;
    doc.text(input.labels.witnessedBy, MARGIN, y);
  }

  /* ---- footer: which version, and when it was produced ---- */
  doc.setTextColor(140);
  doc.setFontSize(7);
  doc.text(
    `${input.templateTitle} · v${input.templateVersion} · ${input.consentedAt}`,
    MARGIN, PAGE_H - 10,
  );

  return doc;
}

/** Build and trigger a download. Filename carries the patient and the date so a
 * folder of consents sorts usefully without being opened. */
export function downloadConsentPdf(input: ConsentPdfInput): void {
  const doc = buildConsentPdf(input);
  const safe = input.patientMrn.replace(/[^A-Za-z0-9-]/g, "_");
  const day = input.consentedAt.slice(0, 10);
  doc.save(`consent-${safe}-${day}.pdf`);
}
