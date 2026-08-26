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
import { parseFdi } from '../domain/fdi';
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
  fdi: z.union([z.number().int(), z.string().regex(/^\d{2}$/)]),
  condition: z.enum(['healthy', 'decayed', 'filled', 'missing', 'crowned', 'root_canal', 'implant']),
  surfaces: z.array(z.string().trim().min(1).max(8)).max(8).nullish(),
  notes: z.string().trim().max(512).nullish(),
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
    const fdi = parseFdi(input.fdi);
    if (fdi == null) throw new ValidationError({ fdi: ['Invalid FDI tooth number (permanent 11–48)'] });

    return this.dbCtx.runAs(principal, async (tx) => {
      const enc = await this.ownEncounter(tx, principal, input.encounterId);
      if (enc.status !== 'open') throw new ConflictError('Tooth chart is locked for this encounter');

      const rec = await this.core.upsertToothRecord(tx, principal.orgId, {
        branchId: enc.branchId, patientId: enc.patientId, encounterId: enc.id,
        doctorId: principal.doctorId, fdiNo: fdi, condition: input.condition,
        surfaces: input.surfaces ?? null, notes: input.notes ?? null,
        createdBy: principal.staffId,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'tooth_record_upserted', entity: 'tooth_records', entityId: rec.id,
        orgId: principal.orgId, branchId: enc.branchId, source: 'api',
        after: { fdiNo: fdi, condition: input.condition, encounterId: enc.id },
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
}
