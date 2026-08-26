import { Injectable } from '@nestjs/common';
import { eq, and, isNull, or, ilike, desc } from 'drizzle-orm';
import { Database } from '../../../infrastructure/database/database';
import {
  patients, patientRelationships, patientTimelineEvents,
  Patient, PatientRelationship, PatientTimelineEvent,
} from '../../../infrastructure/database/schema';
import { normalizePhone } from '../domain/phone';
import { findDuplicates, DuplicateCandidate } from '../domain/duplicate';
import { toDomainError } from '../../../shared/errors/pg-error';

/** Accepts either the pool client or a drizzle transaction (from runAs). */
export type DbClient = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

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
          ilike(patients.name, q),
          ilike(patients.mrn, q),
          ilike(patients.phone, q),
          ilike(patients.ic, q),
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
