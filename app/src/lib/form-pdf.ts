/**
 * form-pdf.ts — render any issued form to a printable PDF (Fasa 1G-d).
 *
 * WHY THIS GENERALISES `consent-pdf.ts` RATHER THAN DUPLICATING IT
 *
 * An MC, a PDPA notice and a consent form are the same object with different words — the
 * server stores all of them in `issued_forms` with a frozen `body_snapshot`. Two PDF
 * builders would drift: a fix to pagination or a margin in one would silently miss the
 * other, and a clinic printing an MC would get a different layout from one printing a
 * consent form for no reason anyone could explain.
 *
 * WHAT MAKES THIS DIFFERENT FROM A CONSENT FORM
 *
 * An issued form carries a SERIAL NUMBER, and that number is what makes it auditable. It
 * is therefore printed prominently and repeated in the footer, so a photocopy can be
 * traced back to its row without opening the system.
 *
 * IT DOES NOT INVENT A SIGNATURE
 *
 * The signature lines are blank. The system stores who issued a form and when, not a
 * signature image — and a pre-filled name inside a signature box would misrepresent that.
 */

import { jsPDF } from "jspdf";

export type FormKind = "consent" | "mc" | "pdpa" | "time_off";

export interface FormPdfInput {
  clinicName: string;
  branchName: string;
  kind: FormKind;
  serialNo: string;
  title: string;
  templateVersion: number;
  /** The FROZEN body from `issued_forms`, not the live template. */
  body: string;
  /** Recipient. One of these is set — an MC goes to a patient, a time-off form to staff. */
  patientName: string | null;
  patientMrn: string | null;
  staffName: string | null;
  subject: string | null;
  details: string | null;
  issuedAt: string;
  issuedByName: string | null;
  /** Set when the form was cancelled — it must print as void, not as valid. */
  cancelledReason: string | null;
  labels: {
    heading: Record<FormKind, string>;
    patient: string; mrn: string; staff: string; subject: string; details: string;
    serial: string; issuedBy: string; date: string; version: string;
    signature: string; patientSignature: string; issuerSignature: string;
    voidMark: string; voidReason: string;
  };
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;

export function buildFormPdf(input: FormPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  /* ---- header: clinic + branch ---- */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(input.clinicName, MARGIN, y);
  y += 5.5;
  if (input.branchName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(90);
    doc.text(input.branchName, MARGIN, y);
    doc.setTextColor(0);
    y += 5;
  }

  /* ---- the serial, boxed: this is the auditable identity of the document ---- */
  doc.setFontSize(9);
  doc.setDrawColor(120);
  doc.roundedRect(PAGE_W - MARGIN - 62, MARGIN - 4.5, 62, 9, 1.5, 1.5);
  doc.text(`${input.labels.serial}: ${input.serialNo}`, PAGE_W - MARGIN - 59, MARGIN + 1.3);
  y += 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  doc.text(input.title, MARGIN, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(`${input.labels.version} ${input.templateVersion}`, MARGIN, y);
  doc.setTextColor(0);
  y += 3.5;

  doc.setDrawColor(180);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  /* ---- VOID watermark text, before the recipient block ----
   * A cancelled MC in a file is worse than a missing one: someone could act on it. The mark
   * goes at the TOP so it survives a photocopy of the top half. */
  if (input.cancelledReason) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(190, 20, 20);
    doc.text(input.labels.voidMark, MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const r = doc.splitTextToSize(`${input.labels.voidReason}: ${input.cancelledReason}`, CONTENT_W);
    for (const line of r) { doc.text(line, MARGIN, y); y += 4.5; }
    doc.setTextColor(0);
    y += 3;
  }

  /* ---- recipient ---- */
  doc.setFontSize(10.5);
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, MARGIN + 34, y, { maxWidth: CONTENT_W - 34 });
    y += 5.8;
  };
  if (input.patientName) {
    row(input.labels.patient, input.patientName);
    if (input.patientMrn) row(input.labels.mrn, input.patientMrn);
  }
  if (input.staffName) row(input.labels.staff, input.staffName);
  if (input.subject) row(input.labels.subject, input.subject);
  y += 1.5;

  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  /* ---- the frozen wording ---- */
  doc.setFontSize(10);
  const body = doc.splitTextToSize(input.body, CONTENT_W);
  for (const line of body) {
    if (y > PAGE_H - 46) { doc.addPage(); y = MARGIN; }
    doc.text(line, MARGIN, y);
    y += 5;
  }
  y += 3;

  /* ---- free-text specifics (rest days, leave dates, reason) ---- */
  if (input.details) {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.text(`${input.labels.details}:`, MARGIN, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    const d = doc.splitTextToSize(input.details, CONTENT_W);
    for (const line of d) {
      if (y > PAGE_H - 44) { doc.addPage(); y = MARGIN; }
      doc.text(line, MARGIN, y);
      y += 4.6;
    }
    y += 3;
  }

  /* ---- signatures ---- */
  if (y > PAGE_H - 58) { doc.addPage(); y = MARGIN; }
  y += 10;
  const half = CONTENT_W / 2 - 5;
  doc.setDrawColor(120);
  doc.line(MARGIN, y, MARGIN + half, y);
  doc.line(MARGIN + half + 10, y, MARGIN + CONTENT_W, y);
  y += 4.5;
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(input.labels.patientSignature, MARGIN, y);
  doc.text(input.labels.issuerSignature, MARGIN + half + 10, y);
  y += 4;
  doc.text(`${input.labels.issuedBy}: ${input.issuedByName ?? "—"}`, MARGIN + half + 10, y);
  doc.text(`${input.labels.date}: ${input.issuedAt}`, MARGIN, y);

  /* ---- footer: serial repeated, so a detached page is still traceable ---- */
  doc.setTextColor(140);
  doc.setFontSize(7);
  doc.text(`${input.serialNo} · ${input.title} · v${input.templateVersion}`, MARGIN, PAGE_H - 10);

  return doc;
}

/** Filenames carry the serial: a folder of MCs sorts into issue order without being opened,
 * and a printed copy can be matched to its file by eye. */
export function downloadFormPdf(input: FormPdfInput): void {
  const doc = buildFormPdf(input);
  const safe = input.serialNo.replace(/[^A-Za-z0-9-]/g, "_");
  doc.save(`${safe}.pdf`);
}
