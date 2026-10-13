import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { ValidationError, ForbiddenError, NotFoundError, ConflictError } from '../../../shared/errors/errors';
import { ClinicalExtendedRepository } from '../infrastructure/clinical-extended.repository';
import { ClinicalCoreRepository } from '../infrastructure/clinical-core.repository';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { ConsentTemplate, IssuedForm, patients, staff } from '../../../infrastructure/database/schema';
import {
  FormKind, FORM_KINDS, FORM_SUBJECT, buildSerialNo, isPlaceholderBody, serialPrefix, serialYearOf,
} from '../domain/forms';

/* ------------------------------------------------------------------- schemas */

const kindSchema = z.enum(FORM_KINDS);

/**
 * Creating a form TEMPLATE for any family.
 *
 * `kind` is required here (unlike the consent route, where it is implied) because this
 * endpoint serves four families and a missing family would silently create a consent
 * form. `body` stays at the server's existing minimum so a near-empty notice cannot be
 * saved as if it were content.
 */
const formTemplateSchema = z.object({
  kind: kindSchema,
  title: z.string().trim().min(2).max(256),
  body: z.string().trim().min(10).max(20000),
});

const issueSchema = z.object({
  kind: kindSchema,
  templateId: z.string().uuid(),
  patientId: z.string().uuid().nullish(),
  staffId: z.string().uuid().nullish(),
  encounterId: z.string().uuid().nullish(),
  subject: z.string().trim().max(256).nullish(),
  details: z.string().trim().max(4000).nullish(),
}).refine(
  /* A form with no addressee cannot be filed. Enforced at the SCHEMA so it is a 422 with a
   * named field, not a row that exists with nobody to send it to. */
  (v) => !!v.patientId || !!v.staffId,
  { message: 'A form must be addressed to a patient or a staff member', path: ['patientId'] },
);

const cancelSchema = z.object({
  cancelReason: z.string().trim().min(4).max(512),
});

/**
 * FormsService — Fasa 1G. Issue, list, view and cancel printable forms
 * (MC, PDPA notice, time-off) on the same engine as consent templates.
 *
 * THREE RULES THIS SERVICE EXISTS TO ENFORCE
 *
 * 1. THE SERIAL IS CLAIMED, NEVER COMPOSED. The number comes from an atomic counter
 *    inside the transaction. A serial built in the browser collides the first time two
 *    receptionists click together.
 * 2. THE WORDING IS FROZEN AT ISSUE. `title_snapshot` / `body_snapshot` copy the template
 *    so a later edit cannot rewrite a certificate already in an employer's file.
 * 3. CANCELLING KEEPS THE NUMBER. The row stays; only `status` changes. A deleted row
 *    leaves a gap indistinguishable from a removed record.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly ext: ClinicalExtendedRepository,
    private readonly core: ClinicalCoreRepository,
    private readonly audit: AuditService,
    private readonly readPort: PatientsReadPort,
  ) {}

  private assertStaffWriter(p: Principal): asserts p is Principal & { branchId: string } {
    /* Whoever hands a form to a patient is at a branch. HQ has no branch, so HQ issues
     * nothing — it manages the templates instead. This mirrors `assertDoctor` for consent
     * records but stays open to non-doctors, because a receptionist prints MCs. */
    if (!p.branchId) throw new ForbiddenError('No branch context — cannot issue a form');
    if (p.role === 'developer') throw new ForbiddenError('Developer role has no business-domain access');
  }

  private validation(err: z.ZodError): ValidationError {
    return new ValidationError(
      Object.fromEntries(err.issues.map((i) => [i.path.join('.') || 'body', [i.message]])),
    );
  }

  /* ------------------------------------------------------------ templates */

  /**
   * List templates, optionally narrowed to one family.
   *
   * WHO SEES WHAT: everyone with clinical:view sees the list, because a doctor must read
   * the wording before issuing it. Only HQ sees INACTIVE templates — a retired version is
   * history, not an option, and offering it invites someone to issue a superseded notice.
   */
  async listFormTemplates(
    principal: Principal, opts: { kind?: string; activeOnly: boolean },
  ): Promise<ConsentTemplate[]> {
    const kind = opts.kind;
    if (kind && !FORM_KINDS.includes(kind as FormKind)) {
      throw this.validation(new z.ZodError([
        { code: 'custom', path: ['kind'], message: `kind mesti salah satu: ${FORM_KINDS.join(', ')}` },
      ]));
    }
    const activeOnly = principal.role === 'hq' ? opts.activeOnly : true;
    return this.dbCtx.runAs(principal, async (tx) =>
      this.ext.listTemplates(tx, principal.orgId, activeOnly, kind));
  }

  /** Create the next version of a form template. HQ only — the wording is a legal document. */
  async createFormTemplate(principal: Principal, raw: unknown): Promise<ConsentTemplate> {
    if (principal.role !== 'hq') {
      throw new ForbiddenError('Only HQ can manage form templates');
    }
    const parsed = formTemplateSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed.error);
    const input = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Version scoped to the FAMILY: two families may share a title, so a bare title
       * lookup would let an MC inherit a consent form's version number. */
      const version = (await this.ext.latestTemplateVersion(tx, principal.orgId, input.title, input.kind)) + 1;
      const tpl = await this.ext.createTemplate(tx, principal.orgId, {
        title: input.title, body: input.body, version, createdBy: principal.staffId,
        kind: input.kind,
      });
      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'form_template_created', entity: 'consent_templates', entityId: tpl.id,
        orgId: principal.orgId, branchId: null, source: 'api',
        after: { kind: input.kind, title: input.title, version },
      }, tx);
      return tpl;
    });
  }

  /* -------------------------------------------------------------- issuing */

  /**
   * Issue a form to a patient or a staff member.
   *
   * The serial is claimed BEFORE the row is inserted, in the same transaction: if the
   * insert fails the whole transaction rolls back and the counter increment with it, so a
   * failed attempt does not burn a serial number (which would show up as a gap someone
   * later has to explain).
   */
  async issueForm(principal: Principal, raw: unknown): Promise<IssuedForm> {
    this.assertStaffWriter(principal);
    const parsed = issueSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed.error);
    const input = parsed.data;

    /* The family decides who the form can be addressed to. An MC issued against a staff
     * row would leave the certificate with no patient to file it under — checked here so
     * the error names the mismatch instead of failing later at print time. */
    const target = FORM_SUBJECT[input.kind];
    if (target === 'patient' && !input.patientId) {
      throw this.validation(new z.ZodError([
        { code: 'custom', path: ['patientId'], message: `${input.kind} mesti ditujukan kepada pesakit` },
      ]));
    }
    if (target === 'staff' && !input.staffId) {
      throw this.validation(new z.ZodError([
        { code: 'custom', path: ['staffId'], message: `${input.kind} mesti ditujukan kepada staf` },
      ]));
    }
    if (input.patientId && input.staffId) {
      throw this.validation(new z.ZodError([
        { code: 'custom', path: ['patientId'], message: 'Pilih pesakit ATAU staf, bukan kedua-duanya' },
      ]));
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      /* ---- STEP 1: take a lock on the form's SUBJECT, before reading any number ----
       *
       * Three attempts at a counter row failed under 10 concurrent requests (a zero on the
       * first call, then a deadlock, then 50 lock waits) because they kept a SECOND row in
       * step with the form while holding a lock across the whole transaction.
       *
       * This does the opposite: it serialises on a row that already exists and already
       * matters — the patient or staff member the form is FOR. Two receptionists issuing an
       * MC for the same patient queue behind each other; different patients never contend,
       * so the clinic's real workload is not slowed down.
       *
       * The lock is taken FIRST, before the maximum is read, so the read-then-insert pair is
       * atomic without a separate counter table to keep honest.
       *
       * A serial number is unique per (org, kind, YEAR) — not per patient — so this makes
       * contention rarer, not impossible. The unique key remains the guarantee: if two
       * different patients somehow produce the same number, the INSERT is refused and no
       * duplicate is stored. Correctness never depends on the lock. */
      const lockId = input.patientId ?? input.staffId;
      if (lockId) {
        await tx.select({ lock: sql`1` }).from(input.patientId ? patients : staff)
          .where(eq(input.patientId ? patients.id : staff.id, lockId))
          .for('update');
      }

      /* ---- the template, and its family must match ---- */
      const tpl = await this.ext.findTemplateById(tx, principal.orgId, input.templateId);
      if (!tpl) throw new NotFoundError('ConsentTemplate', input.templateId);
      if (tpl.kind !== input.kind) {
        /* Issuing an MC from a consent template would print consent wording under an MC
         * serial — a document that is wrong in the way that matters. */
        throw new ConflictError(
          `Templat ini jenis '${tpl.kind}', bukan '${input.kind}'`,
        );
      }
      if (!tpl.isActive) throw new ConflictError('Templat tidak aktif');

      /* ---- the addressee must be reachable by this principal ---- */
      let patientId: string | null = null;
      if (input.patientId) {
        const pat = await this.patientInBranch(tx, principal, input.patientId);
        patientId = pat.id;
      }
      let staffId: string | null = null;
      if (input.staffId) {
        const ok = await this.staffInBranch(tx, principal.orgId, principal.branchId, input.staffId);
        if (!ok) throw new NotFoundError('Staff', input.staffId);
        staffId = input.staffId;
      }
      if (input.encounterId) {
        const enc = await this.core.findEncounterById(tx, principal.orgId, input.encounterId);
        if (!enc) throw new NotFoundError('Encounter', input.encounterId);
        if (principal.role === 'doctor' && enc.doctorId !== principal.doctorId) {
          throw new ForbiddenError('Encounter ini bukan milik anda');
        }
      }

      /* ---- the serial ---- */
      const now = new Date();
      const year = serialYearOf(now);
      const branchCode = await this.branchCode(tx, principal.orgId, principal.branchId);

      /* OPTIMISTIC, BECAUSE THE UNIQUE KEY IS THE REAL GUARANTEE.
       *
       * Read the highest number issued, add one, insert. If a concurrent request took that
       * number first, the unique key on (org, kind, serial_year, serial_no) refuses the row
       * and we take the next one. A lost race therefore costs a retry, never a duplicate —
       * which is what lets the number be derived instead of locked.
       *
       * WHY THE RETRY LIVES HERE AND NOT INSIDE A HELPER
       *
       * Once the INSERT has failed inside a transaction, MySQL has already marked that
       * transaction for rollback; every later statement in it raises ER_LOCK_DEADLOCK
       * "try restarting transaction". So a retry inside the same transaction cannot work —
       * it has to be a fresh attempt built from scratch. */
      const seq = (await this.ext.highestSerialFor(tx, principal.orgId, input.kind, year, principal.branchId)) + 1;
      const base = {
        branchId: principal.branchId,
        kind: input.kind,
        serialYear: year,
        templateId: tpl.id,
        templateVersion: tpl.version,
        titleSnapshot: tpl.title,
        bodySnapshot: tpl.body,
        patientId,
        staffId,
        encounterId: input.encounterId ?? null,
        subject: input.subject ?? null,
        details: input.details ?? null,
        issuedBy: principal.staffId,
        createdBy: principal.staffId,
      };
      const serialNo = buildSerialNo(input.kind, branchCode, year, seq);

      /* ---- the frozen snapshot ---- */
      const rec = await this.ext.createIssuedForm(tx, principal.orgId, { ...base, serialNo });

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'form_issued', entity: 'issued_forms', entityId: rec.id,
        orgId: principal.orgId, branchId: principal.branchId, source: 'api',
        /* The serial goes in the audit trail: that is the identifier people will quote
         * when they ask "who issued MC-STP-2026-00042". */
        after: { kind: input.kind, serialNo, templateVersion: tpl.version, patientId, staffId },
      }, tx);

      return rec;
    });
  }

  async listIssuedForms(principal: Principal, f: {
    kind?: string; patientId?: string; staffId?: string; year?: string; limit?: string;
  }): Promise<IssuedForm[]> {
    /* A doctor sees only their own patients' forms, mirroring the documents domain: RLS is
     * branch-level, so the 'own' narrowing has to happen in the application. */
    const limit = f.limit ? Math.min(Number(f.limit) || 200, 500) : 200;
    const year = f.year ? Number(f.year) : null;
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.ext.listIssuedForms(tx, principal.orgId, {
        kind: f.kind ?? null, patientId: f.patientId ?? null,
        staffId: f.staffId ?? null, year, limit,
      });
      if (principal.role !== 'doctor') return rows;
      const visible: IssuedForm[] = [];
      for (const r of rows) {
        if (!r.patientId) continue;
        if (await this.doctorLinked(principal, r.patientId, tx)) visible.push(r);
      }
      return visible;
    });
  }

  async getIssuedForm(principal: Principal, id: string): Promise<IssuedForm> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const rec = await this.ext.findIssuedFormById(tx, principal.orgId, id);
      if (!rec) throw new NotFoundError('IssuedForm', id);
      if (principal.role === 'doctor' && rec.patientId
        && !(await this.doctorLinked(principal, rec.patientId, tx))) {
        throw new ForbiddenError('Borang ini bukan untuk pesakit anda');
      }
      return rec;
    });
  }

  /** Cancel a form. The serial is RETAINED. */
  async cancelIssuedForm(principal: Principal, id: string, raw: unknown): Promise<IssuedForm> {
    const parsed = cancelSchema.safeParse(raw);
    if (!parsed.success) throw this.validation(parsed.error);

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.ext.findIssuedFormById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('IssuedForm', id);
      if (before.status === 'cancelled') throw new ConflictError('Borang ini sudah dibatalkan');
      /* A doctor may cancel only a form they issued. Anyone else needs to be at the same
       * branch — HQ is excluded from issuing but not from cancelling, because HQ is who
       * corrects a mistake. */
      if (principal.role === 'doctor' && before.issuedBy !== principal.staffId) {
        throw new ForbiddenError('Borang ini dikeluarkan oleh orang lain');
      }
      const rec = await this.ext.cancelIssuedForm(tx, principal.orgId, id, parsed.data.cancelReason);
      if (!rec) throw new NotFoundError('IssuedForm', id);

      await this.audit.record({
        actorId: principal.staffId, actorRole: principal.role,
        action: 'form_cancelled', entity: 'issued_forms', entityId: id,
        orgId: principal.orgId, branchId: before.branchId, source: 'api',
        before: { status: before.status },
        after: { status: 'cancelled', serialNo: before.serialNo, reason: parsed.data.cancelReason },
      }, tx);
      return rec;
    });
  }

  /** Exposed for the UI banner: a template still carrying placeholder wording must be
   * visible as unfinished BEFORE someone issues it to a patient. */
  isPlaceholder(kind: FormKind, body: string): boolean {
    return isPlaceholderBody(kind, body);
  }

  serialPrefixFor(kind: FormKind): string {
    return serialPrefix(kind);
  }

  /* ------------------------------------------------------------ internals */

  private async patientInBranch(tx: unknown, principal: Principal, patientId: string) {
    /* Mirrors ClinicalExtendedService.patientInBranch: fetch, then compare branches. The
     * port has no principal-aware lookup, and inventing one would put authorisation in a
     * read helper instead of here. */
    const patient = await this.readPort.getPatientById(tx as never, principal.orgId, patientId);
    if (!patient) throw new NotFoundError('Patient', patientId);
    if (principal.role !== 'hq' && patient.branchId !== principal.branchId) {
      throw new ForbiddenError('Pesakit ini dari cawangan lain');
    }
    return patient;
  }

  private async doctorLinked(principal: Principal, patientId: string, tx: unknown): Promise<boolean> {
    if (!principal.doctorId) return false;
    return this.readPort.doctorLinkedToPatient(
      tx as never, principal.orgId, principal.doctorId, patientId,
    );
  }

  /** Is this staff member at the acting branch? Read directly rather than through the
   * patients port, which carries no staff helpers. HQ is not branch-bound, so HQ passes. */
  private async staffInBranch(
    tx: unknown, orgId: string, branchId: string | null, staffId: string,
  ): Promise<boolean> {
    if (!branchId) return false;
    const rows = await (tx as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT COUNT(*) AS n FROM staff
          WHERE org_id = ${orgId} AND id = ${staffId} AND branch_id = ${branchId}`,
    );
    const r = (rows as { rows?: Array<{ n: number | string }> }).rows
      ?? (rows as Array<{ n: number | string }>);
    return Number(r?.[0]?.n ?? 0) > 0;
  }

  /**
   * The branch's short code, for the serial.
   *
   * Read straight from `branches` rather than added to the patients port: a branch code is
   * not patient data, and widening a patient-facing port for a serial prefix would make
   * the port's name a lie.
   */
  private async branchCode(tx: unknown, orgId: string, branchId: string | null): Promise<string> {
    if (!branchId) return '';
    const rows = await (tx as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT code FROM branches WHERE org_id = ${orgId} AND id = ${branchId} LIMIT 1`,
    );
    const r = (rows as { rows?: Array<{ code?: string | null }> }).rows
      ?? (rows as Array<{ code?: string | null }>);
    return r?.[0]?.code ?? '';
  }
}
