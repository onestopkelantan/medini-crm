import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../shared/errors/errors';
import {
  PatientsRepository, CreatePatientInput,
} from '../infrastructure/patients.repository';
import { DuplicateCandidate } from '../domain/duplicate';
import {
  inverseRelationship, establishesGuardianship, normaliseRelationshipType,
} from '../domain/relationships';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { ClinicalReadPort } from '../../../shared/ports/clinical.read-port';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import {
  Patient, PatientRelationship, PatientTimelineEvent,
} from '../../../infrastructure/database/schema';

const createPatientSchema = z.object({
  name: z.string().trim().min(2).max(256),
  ic: z.string().trim().max(64).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  gender: z.string().max(8).nullish(),
  phone: z.string().max(64).nullish(),
  whatsapp: z.string().max(64).nullish(),
  email: z.string().email().max(256).nullish(),
  patientType: z.string().max(32).optional(),
  contactType: z.string().max(32).optional(),
  guardianId: z.string().uuid().nullish(),
  registrationReason: z.string().max(128).nullish(),
  preferredContact: z.string().max(32).nullish(),
  /* Fasa 2B — menjawab soalan KLINIKAL dan OPERASI, bukan demografi:
   *   pregnant        mesti diketahui sebelum X-ray dan sebelum memberi ubat.
   *                   NULL = tidak ditanya, dan itu BUKAN 0 (tidak hamil).
   *   patientSource   dari mana pesakit datang. Tanpa ini, belanja pemasaran tidak
   *                   boleh dikaitkan dengan pesakit yang benar-benar muncul.
   *   nextOfKin       orang dihubungi KECEMASAN — bukan penjaga (lihat guardianId).
   *   panelCompanyId  panel/NGO/majikan yang menanggung kos. */
  pregnant: z.boolean().nullish(),
  patientSource: z.string().max(32).nullish(),
  nextOfKinName: z.string().trim().max(256).nullish(),
  nextOfKinPhone: z.string().trim().max(64).nullish(),
  panelCompanyId: z.string().uuid().nullish(),
  panelMemberNo: z.string().trim().max(64).nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

const relationshipSchema = z.object({
  relatedPatientId: z.string().uuid().nullish(),
  relatedName: z.string().trim().min(1).max(256).nullish(),
  /* ANY short label, not a fixed seven.
   *
   * A clinic meets relatives no preset list predicted — an adopted child, an NGO
   * representative, an aunt who brings the patient. Refusing them at the API is how
   * staff end up writing "other" and losing the information entirely. The column is
   * `varchar(32)`; this accepts what the column can already hold.
   *
   * Bounded and normalised so a typo cannot become a 32-character essay, and so
   * "Anak Angkat" and "anak angkat" do not become two different relationships. */
  type: z.string().trim().min(2).max(32).transform(normaliseRelationshipType),
});

const updatePatientSchema = z.object({
  name: z.string().trim().min(2).max(256).optional(),
  ic: z.string().trim().max(64).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  gender: z.string().max(8).nullish(),
  phone: z.string().max(64).nullish(),
  whatsapp: z.string().max(64).nullish(),
  email: z.string().email().max(256).nullish(),
  patientType: z.string().max(32).optional(),
  contactType: z.string().max(32).optional(),
  preferredContact: z.string().max(32).nullish(),
  /* Fasa 2B — menjawab soalan KLINIKAL dan OPERASI, bukan demografi:
   *   pregnant        mesti diketahui sebelum X-ray dan sebelum memberi ubat.
   *                   NULL = tidak ditanya, dan itu BUKAN 0 (tidak hamil).
   *   patientSource   dari mana pesakit datang. Tanpa ini, belanja pemasaran tidak
   *                   boleh dikaitkan dengan pesakit yang benar-benar muncul.
   *   nextOfKin       orang dihubungi KECEMASAN — bukan penjaga (lihat guardianId).
   *   panelCompanyId  panel/NGO/majikan yang menanggung kos. */
  pregnant: z.boolean().nullish(),
  patientSource: z.string().max(32).nullish(),
  nextOfKinName: z.string().trim().max(256).nullish(),
  nextOfKinPhone: z.string().trim().max(64).nullish(),
  panelCompanyId: z.string().uuid().nullish(),
  panelMemberNo: z.string().trim().max(64).nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

export interface RegisterPatientResult {
  patient: Patient;
  duplicates: DuplicateCandidate[];
}

/**
 * PatientsService — Sprint 2 remediation #3 (HQ access).
 * Branch resolution contract:
 *  - non-HQ (branch_manager/branch_admin/doctor): branch ALWAYS = principal.branchId;
 *    explicit target branch must equal own branch (PermissionGuard enforces);
 *    missing principal branch → DENY (fail-closed, unchanged).
 *  - HQ (branchId=null): reads are org-wide (branchId=null → RLS sees all);
 *    mutations REQUIRE an explicit target branchId in the payload (422 if absent).
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: PatientsRepository,
    private readonly audit: AuditService,
    private readonly readPort: PatientsReadPort,
    /* The CLINICAL feed, injected for patient 360 (Fasa 2A).
     *
     * Two timeline tables exist and BOTH have writers — they simply never met:
     *   `patient_timeline_events`  ← registration, relationships   (this module)
     *   `clinical_timeline_events` ← encounters, notes, plans, prescriptions,
     *                                adverse events, consent        (clinical module)
     *
     * /patients/:id/timeline read ONLY the first, so a patient's history showed
     * registration and nothing else: no visits, no treatment, no prescriptions. The
     * 386 clinical events were sitting in the database with nobody reading them.
     *
     * `ClinicalReadPort.listTimeline()` already existed, commented "Clinical timeline
     * feed for patient 360" — the intent was correct and the wire was never run. */
    private readonly clinical: ClinicalReadPort,
  ) {}

  /** Branch for reads: non-HQ = own branch; HQ = null (org-wide). */
  private readBranch(p: Principal): string | null {
    if (p.role === 'hq') return null;
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  /** Branch for mutations: non-HQ = own branch; HQ = explicit target (validated). */
  private mutateBranch(p: Principal, explicit: string | null | undefined): string {
    if (p.role === 'hq') {
      if (!explicit) throw new ValidationError({ branchId: ['branchId is required for HQ mutation'] });
      return explicit;
    }
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  /**
   * Which patients a role may reach, by branch. `null` = whole organisation.
   *
   * This REPLACES the old rule, which scoped patient-by-id access to the READER'S
   * own branch. That rule had two defects the clinic rejected:
   *
   *   1. A manager who oversees every branch could not open a patient from
   *      another branch — he saw the row in his list, clicked it, and got
   *      "Patient not found".
   *   2. A doctor was confined to the branch he sits in, so a patient he had
   *      actually treated elsewhere became unreadable to him.
   *
   * The rule now:
   *
   *   hq            — every patient in the organisation.
   *   branch_manager— every patient in the organisation, full detail (oversight).
   *   branch_admin  — same as manager: counter and admin staff work across the
   *                   clinic's records.
   *   doctor        — ONLY the patients he treats, at ANY branch. The branch is
   *                   deliberately NOT the constraint here; `assertDoctorCanSee`
   *                   narrows it to his own patients. A patient he has never
   *                   treated stays closed even inside his own branch.
   *   developer     — own branch (system role; the conservative default).
   *
   * To put manager/admin back on branch scope, return `principal.branchId` in
   * their case below — that single edit reverts this decision.
   */
  private patientScopeBranch(principal: Principal): string | null {
    switch (principal.role) {
      case 'hq':
      case 'branch_manager':
      case 'branch_admin':
      case 'doctor':
        return null; /* organisation-wide; doctors narrowed by patient link */
      default:
        return principal.branchId ?? null;
    }
  }

  /**
   * Branch filter for patient LIST reads.
   *
   * Doctors stay organisation-wide here too and are filtered by their patient
   * link afterwards — filtering by branch first would hide a patient they treat
   * at another branch, which is the same defect as above.
   */
  private listBranch(p: Principal, selected?: string): string | null {
    if (p.role === 'hq' || p.role === 'branch_manager' || p.role === 'branch_admin' || p.role === 'doctor') {
      return selected ?? null;
    }
    return this.readBranch(p);
  }

  /**
   * MySQL has no legacy database RLS backstop. Patient-by-id access must enforce
   * scope explicitly at the application layer.
   */
  private assertPatientBranch(principal: Principal, patient: Patient): void {
    const scope = this.patientScopeBranch(principal);
    if (scope !== null && patient.branchId !== scope) {
      throw new NotFoundError('Patient', patient.id);
    }
  }

  /**
   * Record when a record is opened from OUTSIDE the reader's own branch.
   *
   * WHY ONLY CROSS-BRANCH, AND NOT EVERY READ
   *
   * Counter and admin staff see the whole clinic by decision (a patient who
   * registers at one branch and walks into another must be found, and — more
   * seriously — their allergies must be visible). That breadth is right, but it
   * left no trace: nobody could answer "who opened this record" after the fact.
   *
   * Logging every read would be useless: an audit trail where 99% of rows are
   * ordinary same-branch lookups is a trail nobody reads, and it would grow with
   * every page view. The sensitive case is the rare one — a reader in one branch
   * opening a patient registered elsewhere — so that, and only that, is written.
   *
   * HQ has no home branch (`branchId` is null), so an HQ read is never flagged: HQ
   * supervises everything by design and flagging it would flag every read.
   *
   * This is appended, never updated — see `audit_log` (append-only, no UPDATE or
   * DELETE anywhere in the codebase).
   */
  private async recordCrossBranchRead(
    principal: Principal,
    patient: Patient,
    tx: unknown,
    action: string,
  ): Promise<void> {
    /* No home branch = no "other" branch to cross. */
    const home = principal.branchId;
    if (!home || home === patient.branchId) return;
    await this.audit.record({
      actorId: principal.staffId,
      actorRole: principal.role,
      action,
      entity: 'patients',
      entityId: patient.id,
      orgId: principal.orgId,
      branchId: patient.branchId,
      source: 'api',
      after: {
        readFromBranch: home,
        patientBranch: patient.branchId,
        patientMrn: patient.mrn,
        crossBranch: true,
      },
    }, tx);
  }

  async register(principal: Principal, raw: unknown): Promise<RegisterPatientResult> {
    const parsed = createPatientSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    const branchId = this.mutateBranch(principal, parsed.data.branchId);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const duplicates = await this.repo.findDuplicateCandidates(tx, principal.orgId, branchId, {
        ic: input.ic, phone: input.phone, contactType: input.contactType,
      });
      const mrn = await new OrgAllocator(tx).nextMrn(principal.orgId);
      const patient = await this.repo.createPatient(tx, principal.orgId, branchId, {
        ...input,
        mrn,
        branchId: undefined,
      } as CreatePatientInput);
      await this.repo.appendTimeline(tx, principal.orgId, {
        patientId: patient.id,
        type: 'registration',
        summary: `Patient registered (${patient.mrn})`,
        actorId: principal.staffId, actorRole: principal.role,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_created', entity: 'patients', entityId: patient.id,
        orgId: principal.orgId, branchId, source: 'api',
      }, tx);
      return { patient, duplicates };
    });
  }

  async getById(principal: Principal, id: string): Promise<Patient> {
    this.patientScopeBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, id);
      if (!patient) throw new NotFoundError('Patient', id);
      this.assertPatientBranch(principal, patient);
      await this.assertDoctorCanSee(principal, patient.id, tx);
      await this.recordCrossBranchRead(principal, patient, tx, 'patient_opened');
      return patient;
    });
  }

  /** S10 T1: update patient (partial). HQ may target any branch via branchId;
   *  non-HQ are pinned to their own branch by the guard + readBranch. */
  async update(principal: Principal, id: string, raw: unknown): Promise<Patient> {
    const parsed = updatePatientSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    this.patientScopeBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Patient', id);
      this.assertPatientBranch(principal, before);
      await this.assertDoctorCanSee(principal, id, tx);

      const set: Record<string, unknown> = {};
      const input = parsed.data;

      if (
        principal.role !== 'hq' &&
        input.branchId !== undefined &&
        input.branchId !== principal.branchId
      ) {
        throw new ForbiddenError('Cannot move a patient to another branch');
      }
      if (input.name !== undefined) set['name'] = input.name;
      if (input.ic !== undefined) set['ic'] = input.ic;
      if (input.dob !== undefined) set['dob'] = input.dob;
      if (input.gender !== undefined) set['gender'] = input.gender;
      if (input.phone !== undefined) set['phone'] = input.phone;
      if (input.whatsapp !== undefined) set['whatsapp'] = input.whatsapp;
      if (input.email !== undefined) set['email'] = input.email;
      if (input.patientType !== undefined) set['patientType'] = input.patientType;
      if (input.contactType !== undefined) set['contactType'] = input.contactType;
      if (input.preferredContact !== undefined) set['preferredContact'] = input.preferredContact;
      /* Fasa 2B. Setiap medan mesti disalin SATU-SATU: `updatePatient` menerima objek
       * `set` yang sudah dibina, jadi medan yang tiada di sini DITERIMA skema, LULUS
       * guard, dan hilang tanpa jejak — API pulangkan 200 sementara tiada apa disimpan.
       * Itu lebih buruk daripada 422: pengguna fikir ia berjaya. */
      if (input.pregnant !== undefined) set['pregnant'] = input.pregnant;
      if (input.patientSource !== undefined) set['patientSource'] = input.patientSource;
      if (input.nextOfKinName !== undefined) set['nextOfKinName'] = input.nextOfKinName;
      if (input.nextOfKinPhone !== undefined) set['nextOfKinPhone'] = input.nextOfKinPhone;
      if (input.panelCompanyId !== undefined) set['panelCompanyId'] = input.panelCompanyId;
      if (input.panelMemberNo !== undefined) set['panelMemberNo'] = input.panelMemberNo;
      if (input.branchId !== undefined) set['branchId'] = input.branchId;

      const updated = await this.repo.updatePatient(tx, principal.orgId, id, set);
      if (!updated) throw new NotFoundError('Patient', id);
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_updated', entity: 'patients', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { name: before.name, phone: before.phone, email: before.email },
        after: set,
      }, tx);
      return updated;
    });
  }

  async search(
    principal: Principal, q: string | undefined, limit?: number, offset?: number, selectedBranchId?: string,
  ): Promise<Patient[]> {
    const branchId = this.listBranch(principal, selectedBranchId);
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.repo.search(tx, principal.orgId, branchId, { q, limit, offset });
      if (principal.role === 'doctor') {
        const visible: Patient[] = [];
        for (const p of rows) {
          if (await this.doctorLinked(principal, p.id, tx)) visible.push(p);
        }
        return visible;
      }
      return rows;
    });
  }

  async addRelationship(principal: Principal, patientId: string, raw: unknown): Promise<PatientRelationship> {
    const parsed = relationshipSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    if (!parsed.data.relatedPatientId && !parsed.data.relatedName) {
      throw new ValidationError({ related: ['relatedPatientId or relatedName is required'] });
    }
    this.patientScopeBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      this.assertPatientBranch(principal, patient);
      await this.assertDoctorCanSee(principal, patientId, tx);
      /* The inverse label. `null` for a custom type — we cannot state a reverse we do
       * not understand, and a wrong bond on a medical record is worse than a second
       * step. See domain/relationships.ts. */
      const inverseType = inverseRelationship(parsed.data.type);

      const { forward: rel, inverse } = await this.repo.addRelationshipWithInverse(
        tx, principal.orgId, {
          patientId,
          relatedPatientId: parsed.data.relatedPatientId ?? null,
          relatedName: parsed.data.relatedName ?? null,
          type: parsed.data.type,
          inverseType,
        },
      );

      /* If this entry says the OTHER person is the guardian, record it on the patient
       * too. `patients.guardian_id` is what the forms engine and the counter read when
       * asking "who may consent for this child" — a relationship row alone would leave
       * that column empty and the question unanswered. */
      if (establishesGuardianship(parsed.data.type) && parsed.data.relatedPatientId && inverse) {
        await this.repo.setGuardian(tx, principal.orgId, patientId, parsed.data.relatedPatientId);
      }

      await this.repo.appendTimeline(tx, principal.orgId, {
        patientId,
        type: 'relationship_added',
        summary: `Relationship added (${parsed.data.type})`,
        actorId: principal.staffId, actorRole: principal.role,
      });

      /* The other person's history records it too. Their screen would otherwise show a
       * family that thinks about them without them. */
      if (inverse && parsed.data.relatedPatientId) {
        await this.repo.appendTimeline(tx, principal.orgId, {
          patientId: parsed.data.relatedPatientId,
          type: 'relationship_added',
          summary: `Relationship added (${inverse.type})`,
          actorId: principal.staffId, actorRole: principal.role,
        });
      }
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_relationship_added', entity: 'patient_relationships',
        entityId: rel.id, orgId: principal.orgId, branchId: principal.branchId, source: 'api',
      }, tx);
      return rel;
    });
  }

  /**
   * The patient's family, with NAMES resolved.
   *
   * A relationship row stores an id; a person reading the screen needs a name. Resolving
   * here rather than in the UI means one query for the whole family instead of one per
   * row, and the screen never renders a bare UUID.
   *
   * `relatedName` covers the other case: a relative who is NOT a patient (an NGO
   * representative, a parent who has not registered). There is no record to look up, so
   * the name typed at entry is the name shown.
   */
  /**
   * Remove a family link — both directions.
   *
   * A relationship entered by mistake is common (wrong sibling, a duplicate entry), and
   * leaving the user no way to undo it means the error stays on a clinical record
   * forever. The pair is removed together; see the repository for why.
   */
  async removeRelationship(principal: Principal, patientId: string, relationshipId: string): Promise<{ removed: boolean }> {
    this.patientScopeBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      this.assertPatientBranch(principal, patient);
      await this.assertDoctorCanSee(principal, patientId, tx);

      /* The inverse label is needed to identify the mirror row precisely. For a custom
       * label there is no inverse, so only the one row is removed — which is correct,
       * because a custom entry never wrote a second row in the first place. */
      const existing = await this.repo.findRelationshipById(tx, principal.orgId, relationshipId);
      const removed = await this.repo.deleteRelationshipPair(
        tx, principal.orgId, patientId, relationshipId,
        existing ? inverseRelationship(existing.type) : null,
      );

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'patient_relationship_removed', entity: 'patient_relationships',
        entityId: relationshipId, orgId: principal.orgId, branchId: principal.branchId, source: 'api',
      }, tx);

      return { removed: removed > 0 };
    });
  }

  async listRelationships(principal: Principal, patientId: string) {
    this.patientScopeBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      this.assertPatientBranch(principal, patient);
      await this.assertDoctorCanSee(principal, patientId, tx);

      const rels = await this.repo.listRelationships(tx, principal.orgId, patientId);
      const ids = [...new Set(rels.map((r) => r.relatedPatientId).filter((x): x is string => !!x))];
      const people = await this.repo.namesFor(tx, principal.orgId, ids);

      return rels.map((r) => {
        const p = r.relatedPatientId ? people.get(r.relatedPatientId) : undefined;
        return {
          ...r,
          /* `displayName` is what the UI renders. Falls back to the typed name, then to a
           * neutral label — never to an id, and never to `undefined` rendered as blank. */
          displayName: p?.name ?? r.relatedName ?? null,
          mrn: p?.mrn ?? null,
          /* The related person's gender decides whether a `parent` row reads "bapa" or
           * "ibu" on screen. Resolved here so every caller agrees. */
          relatedGender: p?.gender ?? null,
          relatedDob: p?.dob ?? null,
          linked: !!p,
        };
      });
    });
  }

  async timeline(principal: Principal, patientId: string, limit?: number): Promise<PatientTimelineEvent[]> {
    this.patientScopeBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const patient = await this.repo.findById(tx, principal.orgId, patientId);
      if (!patient) throw new NotFoundError('Patient', patientId);
      this.assertPatientBranch(principal, patient);
      await this.assertDoctorCanSee(principal, patientId, tx);
      await this.recordCrossBranchRead(principal, patient, tx, 'patient_timeline_read');

      /* ONE LIST, TWO SOURCES — merged and sorted newest-first.
       *
       * The API returns them INTERLEAVED rather than as two sections, because the person
       * reading it wants one answer to "what happened to this patient", in the order it
       * happened. Returning `{registration: [...], clinical: [...]}` would push the
       * merging onto every caller.
       *
       * `limit` applies to the MERGED list, not to each side independently — otherwise a
       * patient with 500 clinical events would bury the registration that started it. */
      const cap = Math.min(Math.max(limit ?? 50, 1), 200);
      const [registration, clinical] = await Promise.all([
        this.repo.listTimeline(tx, principal.orgId, patientId, cap),
        this.clinical.listTimeline(tx, principal.orgId, patientId, cap),
      ]);

      /* `source` is added so the UI can label where a line came from without guessing
       * from the event type — the two feeds use different vocabularies. */
      const merged = [
        ...registration.map((e: PatientTimelineEvent) => ({ ...e, source: 'patient' as const })),
        ...clinical.map((e: { createdAt: unknown }) => ({ ...e, source: 'clinical' as const })),
      ].sort((a, b) => (b.createdAt as unknown as Date).valueOf()
                    - (a.createdAt as unknown as Date).valueOf());

      return merged.slice(0, cap) as PatientTimelineEvent[];
    });
  }

  /* ---- doctor own-scope helpers (app-layer; DB RLS stays branch-level) ---- */

  private async assertDoctorCanSee(principal: Principal, patientId: string, tx: unknown): Promise<void> {
    if (principal.role !== 'doctor') return;
    if (!(await this.doctorLinked(principal, patientId, tx))) {
      throw new ForbiddenError('You do not have access to this patient');
    }
  }

  private async doctorLinked(principal: Principal, patientId: string, tx: unknown): Promise<boolean> {
    if (!principal.doctorId) return false;
    return this.readPort.doctorLinkedToPatient(
      tx as never,
      principal.orgId,
      principal.doctorId,
      patientId,
    );
  }
}
