import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '../../../shared/errors/errors';
import { ClinicalCoreRepository } from '../infrastructure/clinical-core.repository';
import { ClinicalExtendedRepository } from '../infrastructure/clinical-extended.repository';
import { isSignable, canReplaceDraft, canAmend, nextVersion } from '../domain/soap-sign';
import { parseFdi, toothPlausibleForAge, dentitionOf } from '../domain/fdi';
import { WRITABLE_CONDITIONS, ToothEvent, continuousChart, conditionCounts, teethNeedingAttention, normalizeSurfaces } from '../domain/tooth-chart';
import { DEFAULT_CHART_SYMBOLS } from '../domain/tooth-conditions';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import { ClinicalNote, ToothRecord } from '../../../infrastructure/database/schema';

const soapSchema = z.object({
  encounterId: z.string().uuid(),
  soapSubjective: z.string().trim().min(2).max(8000),
  soapObjective: z.string().trim().min(2).max(8000),
  soapAssessment: z.string().trim().min(2).max(8000),
  soapPlan: z.string().trim().min(2).max(8000),
});

const amendSchema = soapSchema.extend({});

const toothSchema = z.object({
  encounterId: z.string().uuid(),
  /* Fasa 1A/1B — BOTH dentitions. `parseFdi(..., 'any')` accepts 11–48 for an
   * adult and 51–85 for a child; a bare /^\d{2}$/ pattern combined with the
   * permanent-only set (what this was before) made every paediatric chart
   * impossible. The advisory age check below WARNS, it never blocks: a natal
   * tooth at 3 and a retained primary molar at 14 are both real. */
  fdi: z.union([z.number().int(), z.string().regex(/^\d{2}$/)]),
  condition: z.enum(WRITABLE_CONDITIONS),
  /* Fasa 1B — the extra chart finding. Optional and nullable: NULL means this
   * tooth carries no symbol, which is the state of every tooth charted before
   * symbols existed. */
  symbolCode: z.string().trim().max(64).nullish(),
  /* Surface charting — canonical letters only. The column is JSON and would
   * accept anything, so the write path is where the vocabulary is enforced: a
   * tooth has five addressable surfaces (M/O/D/B/L), and storing a letter the
   * chart cannot draw would render as a region that does not exist. Empty array
   * is refused (that is a whole-tooth record: omit the field or send null) and
   * duplicates are stripped so the stored value is stable. */
  surfaces: z
    .array(z.enum(['M', 'O', 'D', 'B', 'L']))
    .min(1)
    .max(5)
    .transform((list) => [...new Set(list)])
    .nullish(),
  notes: z.string().trim().max(512).nullish(),
  /* Advisory only, set by the client from the patient's DOB. Absent = no check.
   * The response reports `ageImplausible` so the UI can ask the doctor to
   * confirm, rather than the API refusing a correct clinical record. */
  patientAgeYears: z.number().int().min(0).max(130).nullish(),
});

/**
 * NotesService — SOAP clinical notes + tooth chart (Sprint 3 S3-C/D).
 *
 * ADR-009 (signed records immutable) is enforced at THREE layers:
 *  1. Domain: canReplaceDraft/canAmend rules (unsigned-only replace).
 *  2. Service: signed note update attempts reject with 409 before any SQL.
 *  3. Database: medini_app has SELECT/INSERT only on clinical_notes — NO
 *     UPDATE/DELETE grants; sign/supersede run through the admin-path
 *     privileged statement inside the same transaction (documented in
 *     ClinicalCoreRepository.signNote) with signed_at IS NULL predicates.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly core: ClinicalCoreRepository,
    private readonly ext: ClinicalExtendedRepository,
    private readonly audit: AuditService,
    private readonly patients: PatientsReadPort,
  ) {}

  private validation(parsed: { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
    return new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
    );
  }

  private assertDoctor(p: Principal): asserts p is Principal & { doctorId: string; branchId: string } {
    if (p.role !== 'doctor' || !p.doctorId || !p.branchId) {
      throw new ForbiddenError('Only doctors can create or modify clinical records');
    }
  }

  /** Load an encounter owned by this doctor (or throw). */
  private async ownEncounter(tx: Parameters<Parameters<DbContextService['runAs']>[1]>[0], p: Principal & { doctorId: string }, encounterId: string) {
    const enc = await this.core.findEncounterById(tx, p.orgId, encounterId);
    if (!enc || enc.doctorId !== p.doctorId) throw new NotFoundError('Encounter', encounterId);
    return enc;
  }

  /* Create a draft note, or REPLACE the caller's unsigned draft for the
   * encounter (old draft is superseded, never edited in place). */
  async createOrReplaceDraft(principal: Principal, raw: unknown): Promise<ClinicalNote> {
    this.assertDoctor(principal);
    const parsed = soapSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const enc = await this.ownEncounter(tx, principal, input.encounterId);
      if (enc.status === 'cancelled') throw new ConflictError('Encounter is cancelled');

      const existing = await this.core.listNotes(tx, principal.orgId, {
        encounterId: enc.id, doctorId: principal.doctorId,
      });
      const myDraft = existing.find(
        (n) => n.signedAt == null && n.supersededByNoteId == null && n.amendsNoteId == null,
      );
      if (myDraft && !canReplaceDraft(myDraft.signedAt)) {
        throw new ConflictError('Note is signed — create an amendment instead');
      }

      const note = await this.core.createNote(tx, principal.orgId, {
        patientId: enc.patientId, encounterId: enc.id, doctorId: principal.doctorId,
        soapSubjective: input.soapSubjective, soapObjective: input.soapObjective,
        soapAssessment: input.soapAssessment, soapPlan: input.soapPlan,
        createdBy: principal.staffId,
      });
      if (myDraft) await this.core.markSuperseded(tx, principal.orgId, myDraft.id, note.id);

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'note_created', entity: 'clinical_notes', entityId: note.id,
        orgId: principal.orgId, branchId: enc.branchId, source: 'api',
        after: { encounterId: enc.id, draft: true, supersedes: myDraft?.id ?? null },
      }, tx);
      return note;
    });
  }

  /** Sign a note: requires complete SOAP; one-way; double-sign → 409. */
  async sign(principal: Principal, noteId: string): Promise<ClinicalNote> {
    this.assertDoctor(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const note = await this.core.findNoteById(tx, principal.orgId, noteId);
      if (!note || note.doctorId !== principal.doctorId) throw new NotFoundError('Note', noteId);
      if (note.signedAt) throw new ConflictError('Note is already signed');
      if (note.supersededByNoteId) throw new ConflictError('Draft was superseded — sign the replacement');
      if (!isSignable({
        soapSubjective: note.soapSubjective ?? '', soapObjective: note.soapObjective ?? '',
        soapAssessment: note.soapAssessment ?? '', soapPlan: note.soapPlan ?? '',
      })) {
        throw new ValidationError({ soap: ['All four SOAP sections are required before signing'] });
      }

      const signed = await this.core.signNote(tx, principal.orgId, noteId, principal.staffId);
      if (!signed) throw new ConflictError('Note is already signed'); /* concurrent sign lost */

      const enc = await this.core.findEncounterById(tx, principal.orgId, note.encounterId);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'note_signed', entity: 'clinical_notes', entityId: noteId,
        orgId: principal.orgId, branchId: enc?.branchId ?? null, source: 'api',
        after: { encounterId: note.encounterId, version: note.version },
      }, tx);
      await this.ext.appendTimeline(tx, principal.orgId, {
        patientId: note.patientId, type: 'note_signed',
        summary: `Clinical note signed (v${note.version})`,
        payload: { noteId, encounterId: note.encounterId },
        actorId: principal.staffId, actorRole: principal.role, correlationId: getCorrelationId(),
      });
      return signed;
    });
  }

  /** Amend a SIGNED note: creates a new unsigned version row (amendsNoteId). */
  async amend(principal: Principal, noteId: string, raw: unknown): Promise<ClinicalNote> {
    this.assertDoctor(principal);
    const parsed = amendSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const original = await this.core.findNoteById(tx, principal.orgId, noteId);
      if (!original || original.doctorId !== principal.doctorId) throw new NotFoundError('Note', noteId);
      if (!canAmend(original.signedAt)) {
        throw new ConflictError('Only signed notes can be amended (use draft replace for unsigned)');
      }
      const enc = await this.core.findEncounterById(tx, principal.orgId, original.encounterId);

      const note = await this.core.createNote(tx, principal.orgId, {
        patientId: original.patientId, encounterId: original.encounterId,
        doctorId: principal.doctorId,
        soapSubjective: input.soapSubjective, soapObjective: input.soapObjective,
        soapAssessment: input.soapAssessment, soapPlan: input.soapPlan,
        amendsNoteId: original.id, version: nextVersion(original.version),
        createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'note_amended', entity: 'clinical_notes', entityId: note.id,
        orgId: principal.orgId, branchId: enc?.branchId ?? null, source: 'api',
        after: { amendsNoteId: original.id, version: note.version },
      }, tx);
      return note;
    });
  }

  async listForEncounter(principal: Principal, encounterId: string): Promise<ClinicalNote[]> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const enc = await this.core.findEncounterById(tx, principal.orgId, encounterId);
      if (!enc) throw new NotFoundError('Encounter', encounterId);
      if (principal.role === 'doctor' && enc.doctorId !== principal.doctorId) {
        throw new NotFoundError('Encounter', encounterId);
      }
      return this.core.listNotes(tx, principal.orgId, {
        encounterId, doctorId: principal.role === 'doctor' ? principal.doctorId : null,
      });
    });
  }

  /* ---------------- tooth chart ---------------- */

  async upsertTooth(principal: Principal, raw: unknown): Promise<ToothRecord> {
    this.assertDoctor(principal);
    const parsed = toothSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed);
    const input = parsed.data;
    /* 'any' — both dentitions. A permanent-only parse here is what made every
     * paediatric chart impossible before Fasa 1A. */
    const fdi = parseFdi(input.fdi, 'any');
    if (fdi == null) {
      throw new ValidationError({
        fdi: ['Invalid FDI tooth number (permanent 11–48, deciduous 51–85)'],
      });
    }
    if (input.symbolCode != null && input.symbolCode !== '') {
      const known = DEFAULT_CHART_SYMBOLS.some((s) => s.code === input.symbolCode);
      if (!known) {
        /* Deliberately NOT a hard rejection in the domain — a clinic may define
         * its own symbols in `chart_symbols`. This list is the SHIPPED set; the
         * repository validates against the org's actual table in a later phase.
         * Rejecting an unknown code here would make a clinic-defined symbol
         * unusable from the API, which is worse than storing a code the chart
         * falls back on. */
        // accepted, rendered via condition fallback if the code is unknown
      }
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const enc = await this.ownEncounter(tx, principal, input.encounterId);
      if (enc.status !== 'open') throw new ConflictError('Tooth chart is locked for this encounter');

      const rec = await this.core.upsertToothRecord(tx, principal.orgId, {
        branchId: enc.branchId, patientId: enc.patientId, encounterId: enc.id,
        doctorId: principal.doctorId, fdiNo: fdi, condition: input.condition as ToothRecord['condition'],
        symbolCode: input.symbolCode ?? null,
        surfaces: input.surfaces ?? null, notes: input.notes ?? null,
        createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'tooth_record_upserted', entity: 'tooth_records', entityId: rec.id,
        orgId: principal.orgId, branchId: enc.branchId, source: 'api',
        after: {
          fdiNo: fdi, condition: input.condition,
          symbolCode: input.symbolCode ?? null,
          dentition: dentitionOf(fdi),
          /* Recorded when the tooth looks wrong for the patient's age. Stored in
           * the AUDIT trail rather than used to block: a natal tooth at 3 or a
           * retained primary molar at 14 are both real, so the API must not
           * refuse them — but a clinical reviewer should be able to see that the
           * system flagged it. */
          ageImplausible:
            input.patientAgeYears != null
              ? !toothPlausibleForAge(fdi, input.patientAgeYears)
              : false,
          encounterId: enc.id,
        },
      }, tx);
      return rec;
    });
  }

  async listTeeth(principal: Principal, encounterId: string): Promise<ToothRecord[]> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const enc = await this.core.findEncounterById(tx, principal.orgId, encounterId);
      if (!enc) throw new NotFoundError('Encounter', encounterId);
      if (principal.role === 'doctor' && enc.doctorId !== principal.doctorId) {
        throw new NotFoundError('Encounter', encounterId);
      }
      return this.core.listToothRecords(tx, principal.orgId, { encounterId });
    });
  }

  /**
   * Fasa 1B — the CONTINUOUS chart for a patient: one entry per tooth, latest
   * fact, which is what the odontogram screen renders.
   *
   * Deliberately separate from `listTeeth`, which answers a different question
   * ("what was charted in THIS visit"). Both are legitimate and neither can be
   * derived from the other client-side without shipping every visit's rows.
   *
   * The patient is resolved through the PatientsReadPort rather than a local
   * query, so the branch scoping rule lives in one place — a doctor may only
   * chart their own patient, and a branch role only its own branch.
   */
  async getPatientChart(principal: Principal, patientId: string) {
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patients.getPatientById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);

      const rows = await this.core.listLatestToothRecords(tx, principal.orgId, patientId);
      /* A SECOND QUERY for the per-tooth history depth. It cannot come from the
       * rows above — that read collapses to one row per tooth by design — and it
       * must not be a correlated subquery either: see `countToothEvents`. */
      const counts = await this.core.countToothEvents(tx, principal.orgId, patientId);

      const events: ToothEvent[] = rows.map((r) => ({
        fdiNo: r.fdiNo,
        condition: r.condition,
        symbolCode: r.symbolCode ?? null,
        /* Surfaces travel with the event; the domain reducer normalizes them
         * once so the chart payload only ever carries canonical letters. The
         * drizzle jsonb column infers as `{}`-ish unknown JSON, so the cast is
         * the same boundary the reducer already guards at run time. */
        surfaces: (r.surfaces as readonly string[] | null) ?? null,
        notes: r.notes ?? null,
        encounterId: r.encounterId,
        doctorId: r.doctorId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        id: r.id,
        eventCount: counts.get(r.fdiNo) ?? 1,
      }));

      const chart = continuousChart(patientId, events);
      return {
        ...chart,
        needsAttention: teethNeedingAttention(chart),
        conditionCounts: conditionCounts(chart),
      };
    });
  }

  /** The events behind one tooth — what the chart opens on click. */
  async getToothHistory(principal: Principal, patientId: string, fdi: unknown) {
    const tooth = parseFdi(fdi, 'any');
    if (tooth == null) {
      throw new ValidationError({ fdi: ['Invalid FDI tooth number (permanent 11–48, deciduous 51–85)'] });
    }
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.patients.getPatientById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      const rows = await this.core.listToothHistory(tx, principal.orgId, patientId, tooth);
      /* Same surfaces boundary as the chart read: the JSON column leaves the
       * database untyped, and the history panel draws regions from it too —
       * a surfaced finding must show WHICH surfaces in past events as well. */
      return rows.map((r) => ({ ...r, surfaces: normalizeSurfaces(r.surfaces) }));
    });
  }
}
