import { Injectable } from '@nestjs/common';
import { eq, and, isNull, or, like, desc, inArray } from 'drizzle-orm';
import { Database } from '../../../infrastructure/database/database';
import {
  patients, patientRelationships, patientTimelineEvents,
  Patient, PatientRelationship, PatientTimelineEvent,
} from '../../../infrastructure/database/schema';
import { normalizePhone } from '../domain/phone';
import { findDuplicates, DuplicateCandidate } from '../domain/duplicate';
import { toDomainError } from '../../../shared/errors/database-error';

/** Accepts either the pool client or a drizzle transaction (from runAs). */
export type DbClient = Database;

export interface CreatePatientInput {
  mrn: string;
  name: string;
  ic?: string | null;
  dob?: string | null;
  gender?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  patientType?: string;
  contactType?: string;
  guardianId?: string | null;
  registrationReason?: string | null;
  preferredContact?: string | null;
}

export interface PatientSearchQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * PatientsRepository — stateless data access for the patients domain.
 *
 * EVERY method takes a `tx` (transaction/client) as its first argument.
 * The caller (PatientsService) passes the transaction created by
 * DbContextService.runAs(), which already applied the trusted GUC context
 * (app.role / app.branch_ids / app.doctor_id). RLS therefore enforces the
 * branch boundary on every query; a forged branch can never reach the DB.
 */
@Injectable()
export class PatientsRepository {
  async createPatient(
    tx: DbClient, orgId: string, branchId: string, input: CreatePatientInput,
  ): Promise<Patient> {
    const phoneNorm = normalizePhone(input.phone);
    const waNorm = normalizePhone(input.whatsapp);
    try {
      const rows = await tx
        .insert(patients)
        .values({
          orgId,
          branchId,
          mrn: input.mrn,
          name: input.name.trim(),
          ic: input.ic?.trim() || null,
          dob: input.dob || null,
          gender: input.gender || null,
          phone: phoneNorm,
          whatsapp: waNorm,
          email: input.email?.trim() || null,
          patientType: input.patientType ?? 'adult',
          contactType: input.contactType ?? 'own',
          guardianId: input.guardianId ?? null,
          registrationReason: input.registrationReason ?? null,
          preferredContact: input.preferredContact ?? null,
        })
        .returning();
      return rows[0]!;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async findById(tx: DbClient, orgId: string, id: string): Promise<Patient | null> {
    const rows = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.orgId, orgId), eq(patients.id, id), isNull(patients.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** S10 T1: partial update. Only supplied fields are set. */
  async updatePatient(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<Patient | null> {
    const rows = await tx.update(patients)
      .set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(patients.orgId, orgId), eq(patients.id, id), isNull(patients.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  async search(
    tx: DbClient, orgId: string, branchId: string | null, query: PatientSearchQuery,
  ): Promise<Patient[]> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const conditions = [
      eq(patients.orgId, orgId),
      isNull(patients.deletedAt),
    ];
    /* HQ (branchId null) searches org-wide — RLS admits all branches. */
    if (branchId) conditions.push(eq(patients.branchId, branchId));
    if (query.q && query.q.trim().length >= 2) {
      const q = `%${query.q.trim()}%`;
      conditions.push(
        or(
          like(patients.name, q),
          like(patients.mrn, q),
          like(patients.phone, q),
          like(patients.ic, q),
        )!,
      );
    }
    return tx
      .select()
      .from(patients)
      .where(and(...conditions))
      .orderBy(desc(patients.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /* nextMrn removed — use OrgAllocator (org-safe, concurrency-safe). */

  async findDuplicateCandidates(
    tx: DbClient,
    orgId: string,
    branchId: string,
    input: { ic?: string | null; phone?: string | null; contactType?: string | null },
  ): Promise<DuplicateCandidate[]> {
    const phone = normalizePhone(input.phone);
    const ic = input.ic?.trim() || null;
    if (!ic && !phone) return [];
    const conds = [eq(patients.orgId, orgId), eq(patients.branchId, branchId), isNull(patients.deletedAt)];
    if (ic) conds.push(eq(patients.ic, ic));
    if (phone) conds.push(eq(patients.phone, phone));
    const rows = await tx
      .select({ id: patients.id, name: patients.name, ic: patients.ic, phone: patients.phone })
      .from(patients)
      .where(and(conds[0], conds[1], conds[2], or(...conds.slice(3))!));
    return findDuplicates({ ic, phone, contactType: input.contactType, existing: rows });
  }

  async addRelationship(
    tx: DbClient,
    orgId: string,
    input: { patientId: string; relatedPatientId?: string | null; relatedName?: string | null; type: string },
  ): Promise<PatientRelationship> {
    const rows = await tx
      .insert(patientRelationships)
      .values({
        orgId,
        patientId: input.patientId,
        relatedPatientId: input.relatedPatientId ?? null,
        relatedName: input.relatedName ?? null,
        type: input.type,
      })
      .returning();
    return rows[0]!;
  }

  /**
   * Write the typed relationship AND its inverse, in the caller's transaction.
   *
   * Both rows or neither: a half-written pair leaves one screen claiming a bond the
   * other screen denies, which is worse than no entry at all — the person reading it
   * cannot tell which side is wrong.
   *
   * The inverse is written only when `inverseType` is supplied. Custom labels have no
   * inverse we can state truthfully, so they write one row (see domain/relationships.ts).
   */
  async addRelationshipWithInverse(
    tx: DbClient,
    orgId: string,
    input: {
      patientId: string;
      relatedPatientId: string | null;
      relatedName: string | null;
      type: string;
      inverseType: string | null;
    },
  ): Promise<{ forward: PatientRelationship; inverse: PatientRelationship | null }> {
    const forward = await this.addRelationship(tx, orgId, {
      patientId: input.patientId,
      relatedPatientId: input.relatedPatientId,
      relatedName: input.relatedName,
      type: input.type,
    });

    /* No linked record = nobody to write the other side onto. A name-only entry (an NGO
     * representative who is not a patient) is a note about a person, not a bond between
     * two records, so it stays one-sided by definition. */
    if (!input.inverseType || !input.relatedPatientId) {
      return { forward, inverse: null };
    }

    /* The other side names THIS patient. `relatedName` is deliberately not set: the
     * linked patient already has a record, and copying a name risks it drifting from
     * the one the front desk later corrects. */
    const rel = await this.addRelationship(tx, orgId, {
      patientId: input.relatedPatientId,
      relatedPatientId: input.patientId,
      relatedName: null,
      type: input.inverseType,
    });

    return { forward, inverse: rel };
  }

  /**
   * Set the patient's guardian (`patients.guardian_id`).
   *
   * Kept in step with the relationship rows because two different readers depend on each:
   * the family tab reads relationships, while the forms engine and the counter read this
   * column when asking who may consent for a child. Letting them disagree means the
   * screen shows a guardian the consent form does not recognise.
   *
   * Not a FK change — the column already exists; this is the writer it never had.
   */
  async setGuardian(tx: DbClient, orgId: string, patientId: string, guardianId: string): Promise<void> {
    await tx.update(patients)
      .set({ guardianId, updatedAt: new Date() })
      .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId), isNull(patients.deletedAt)));
  }

  /** Names and MRNs for a set of ids — one query, so a family list does not become N. */
  async namesFor(tx: DbClient, orgId: string, ids: string[]): Promise<Map<string, { name: string; mrn: string; gender: string | null; dob: string | null }>> {
    const out = new Map<string, { name: string; mrn: string; gender: string | null; dob: string | null }>();
    if (!ids.length) return out;
    const rows = await tx.select({
      id: patients.id, name: patients.name, mrn: patients.mrn,
      gender: patients.gender, dob: patients.dob,
    }).from(patients)
      .where(and(eq(patients.orgId, orgId), inArray(patients.id, ids), isNull(patients.deletedAt)));
    for (const r of rows) out.set(r.id, { name: r.name, mrn: r.mrn, gender: r.gender, dob: r.dob });
    return out;
  }

  async findRelationshipById(tx: DbClient, orgId: string, id: string): Promise<PatientRelationship | null> {
    const rows = await tx.select().from(patientRelationships)
      .where(and(eq(patientRelationships.orgId, orgId), eq(patientRelationships.id, id))).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Remove a relationship AND the row it created on the other person.
   *
   * Removing only one side would leave the other patient's screen still claiming a bond
   * that no longer exists — and nobody would ever find it, because they would have no
   * reason to look. `ON DELETE SET NULL` on `related_patient_id` makes this a real delete
   * rather than a soft one: the pair is deleted by id, not orphaned.
   */
  async deleteRelationshipPair(
    tx: DbClient, orgId: string, patientId: string, relationshipId: string, inverseType: string | null,
  ): Promise<number> {
    const row = await this.findRelationshipById(tx, orgId, relationshipId);
    if (!row || row.patientId !== patientId) return 0;

    /* Delete the mirror, not every row between these two people.
     *
     * The first version of this removed ALL rows naming this patient on the other
     * record — so removing a SPOUSE also silently deleted that person's GUARDIAN row,
     * a different relationship that nobody asked to touch. A live test caught it: two
     * rows on the other patient before, zero after, with only the marriage removed.
     *
     * The mirror carries the INVERSE label, so that is the filter. It must match exactly:
     * an unrelated bond between the same two people is a separate fact and stays. */
    if (row.relatedPatientId && inverseType) {
      await tx.delete(patientRelationships).where(and(
        eq(patientRelationships.orgId, orgId),
        eq(patientRelationships.patientId, row.relatedPatientId),
        eq(patientRelationships.relatedPatientId, patientId),
        eq(patientRelationships.type, inverseType),
      ));
    }

    await tx.delete(patientRelationships).where(eq(patientRelationships.id, relationshipId));
    return 1;
  }

  async listRelationships(tx: DbClient, orgId: string, patientId: string): Promise<PatientRelationship[]> {
    return tx
      .select()
      .from(patientRelationships)
      .where(and(eq(patientRelationships.orgId, orgId), eq(patientRelationships.patientId, patientId)));
  }

  async appendTimeline(
    tx: DbClient,
    orgId: string,
    input: {
      patientId: string; type: string; summary: string;
      payload?: Record<string, unknown> | null;
      actorId?: string | null; actorRole?: string | null;
      correlationId?: string | null; source?: string;
    },
  ): Promise<PatientTimelineEvent> {
    const rows = await tx
      .insert(patientTimelineEvents)
      .values({
        orgId,
        patientId: input.patientId,
        type: input.type,
        summary: input.summary,
        payload: input.payload ?? null,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        source: input.source ?? 'api',
        correlationId: input.correlationId ?? null,
      })
      .returning();
    return rows[0]!;
  }

  async listTimeline(
    tx: DbClient, orgId: string, patientId: string, limit = 50,
  ): Promise<PatientTimelineEvent[]> {
    return tx
      .select()
      .from(patientTimelineEvents)
      .where(and(eq(patientTimelineEvents.orgId, orgId), eq(patientTimelineEvents.patientId, patientId)))
      .orderBy(desc(patientTimelineEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }
}
