import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { AuditPort, AuditEvent } from '@shared/audit/audit.port';
import { InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { ClinicalCoreRepository } from '@modules/clinical/infrastructure/clinical-core.repository';
import { ClinicalExtendedRepository } from '@modules/clinical/infrastructure/clinical-extended.repository';
import { EncountersService } from '@modules/clinical/application/encounters.service';
import { NotesService } from '@modules/clinical/application/notes.service';
import { PlansService } from '@modules/clinical/application/plans.service';
import { ClinicalExtendedService } from '@modules/clinical/application/clinical-extended.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/errors';
import { runWithCorrelation } from '@shared/correlation/correlation';
import { randomUUID } from 'node:crypto';

/**
 * Sprint 3 (S3-C..G) — clinical workflow (live PG, services end-to-end).
 *
 * CROSS-SUITE ISOLATION CONTRACT (shared dev DB):
 *  - this suite owns test org ...f1 EXCLUSIVELY (no other suite uses it)
 *  - every fixture row carries a '[clw]' marker in a text column
 *  - every service call runs under a 'clw-*' correlation id, so same-tx
 *    audit_log / clinical_timeline_events / domain_events rows are purged by
 *    correlation — other suites' rows are NEVER touched
 *  - org-wide DELETEs are forbidden here (they caused cross-suite flakes)
 * Honest skip when the DB is genuinely unreachable.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[clinical-workflow] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-9999999999f1';
const DOC_A = '99999999-0000-0000-0000-0000000000a1';
const DOC_B = '99999999-0000-0000-0000-0000000000b2';

function hqPrincipal() {
  return { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
}
function bmPrincipal(branchId: string) {
  return { staffId: '00000000-0000-0000-0000-0000000000bb', username: 'manager', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null };
}
function receptionPrincipal(branchId: string) {
  return { staffId: '00000000-0000-0000-0000-0000000000cc', username: 'reception', role: 'branch_admin', orgId: TEST_ORG, branchId, doctorId: null };
}
function doctorPrincipal(branchId: string, doctorId: string) {
  return { staffId: doctorId, username: 'doctor', role: 'doctor', orgId: TEST_ORG, branchId, doctorId };
}

/** Run `fn` under a suite-marked correlation id (audit/timeline scoping). */
function clw<T>(fn: () => Promise<T>): Promise<T> {
  return runWithCorrelation({ correlationId: `clw-${randomUUID()}` }, fn);
}

interface RawRows { rows: Array<Record<string, unknown>> }

function build(db: ReturnType<typeof createFreshDatabase>['db']) {
  const ctx = new DbContextService(db);
  const audit = new AuditService(new InMemoryAuditAdapter());
  const core = new ClinicalCoreRepository();
  const ext = new ClinicalExtendedRepository();
  const pRead = new PatientsReadPort(db);
  const encounters = new EncountersService(ctx, core, ext, pRead, audit);
  const notes = new NotesService(ctx, core, ext, audit);
  const plans = new PlansService(ctx, core, ext, pRead, audit, db);
  const ops = new ClinicalExtendedService(ctx, core, ext, pRead, audit);
  return { encounters, notes, plans, ops, ctx, audit };
}

/** Marker-scoped purge — deletes ONLY this suite's rows (child → parent). */
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM clinical_timeline_events WHERE org_id = ${TEST_ORG} AND correlation_id LIKE 'clw-%'`);
  await admin.execute(sql`DELETE FROM domain_events WHERE org_id = ${TEST_ORG} AND correlation_id LIKE 'clw-%'`);
  await admin.execute(sql`DELETE FROM audit_log WHERE org_id = ${TEST_ORG} AND correlation_id LIKE 'clw-%'`);
  await admin.execute(sql`DELETE FROM adverse_events WHERE org_id = ${TEST_ORG} AND description LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM consent_records WHERE org_id = ${TEST_ORG} AND consented_by LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM referrals WHERE org_id = ${TEST_ORG} AND reason LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM prescriptions WHERE org_id = ${TEST_ORG} AND medication LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM imaging_records WHERE org_id = ${TEST_ORG} AND title LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM treatment_sessions WHERE org_id = ${TEST_ORG} AND summary LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM treatment_plan_items WHERE org_id = ${TEST_ORG} AND description LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM treatment_plans WHERE org_id = ${TEST_ORG} AND title LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM tooth_records WHERE org_id = ${TEST_ORG} AND notes LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM clinical_notes WHERE org_id = ${TEST_ORG} AND soap_subjective LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM encounters WHERE org_id = ${TEST_ORG} AND chief_complaint LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM treatment_catalog WHERE org_id = ${TEST_ORG} AND name LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM consent_templates WHERE org_id = ${TEST_ORG} AND title LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM appointments WHERE doctor_id IN (
    SELECT id FROM staff WHERE username LIKE 'doc_%_clw')`);
  await admin.execute(sql`DELETE FROM patients WHERE org_id = ${TEST_ORG} AND name LIKE '%[clw]%'`);
  await admin.execute(sql`DELETE FROM role_assignments WHERE staff_id IN (
    SELECT id FROM staff WHERE username LIKE 'doc_%_clw')`);
  await admin.execute(sql`DELETE FROM staff WHERE username LIKE 'doc_%_clw'`);
  const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
  for (const prefix of ['mrn', 'enc', 'tpl', 'trt']) {
    await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_${prefix}_${key}`)} START WITH 1`);
    await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_${prefix}_${key}`)} RESTART WITH 1`);
  }
}

interface Fx { branch1: string; branch2: string; patientB1: string; patient2B2: string }

/** Fresh marked fixtures per test (a test's purge removes its own rows). */
async function fixtures(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<Fx> {
  await purge(admin);
  const b = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const branch1 = (b as unknown as RawRows).rows[0]!.id as string;
  const branch2 = (b as unknown as RawRows).rows[1]!.id as string;
  await admin.execute(sql`
    INSERT INTO staff (id, org_id, branch_id, name, username, role, doctor_ref)
    VALUES (${DOC_A}, ${TEST_ORG}, ${branch1}, '[clw] Dr Alpha', 'doc_alpha_clw', 'doctor', 'dr-alpha-clw'),
           (${DOC_B}, ${TEST_ORG}, ${branch1}, '[clw] Dr Beta', 'doc_beta_clw', 'doctor', 'dr-beta-clw')
    ON CONFLICT DO NOTHING`);
  const pt = await admin.execute(sql`
    INSERT INTO patients (org_id, branch_id, mrn, name)
    VALUES (${TEST_ORG}, ${branch1}, ${'MDN-CLW-' + randomUUID().slice(0, 6).toUpperCase()}, '[clw] Patient A'),
           (${TEST_ORG}, ${branch2}, ${'MDN-CLW-' + randomUUID().slice(0, 6).toUpperCase()}, '[clw] Patient B')
    RETURNING id::text AS id, branch_id::text AS branch_id`);
  const rows = (pt as unknown as RawRows).rows;
  return {
    branch1, branch2,
    patientB1: rows.find((r) => r.branch_id === branch1)!.id as string,
    patient2B2: rows.find((r) => r.branch_id === branch2)!.id as string,
  };
}

describe('Sprint 3 — clinical workflow (live PG)', () => {
  dbIt('doctor creates an encounter (ENC-#### allocator + same-tx audit + timeline)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);

    const enc = await clw(() => svc.encounters.create(doctorPrincipal(fx.branch1, DOC_A), {
      patientId: fx.patientB1, chiefComplaint: '[clw] Sakit gigi belakang kiri',
    }));
    expect(enc.encounterCode).toMatch(/^ENC-\d{4}$/);
    expect(enc.status).toBe('open');
    expect(enc.doctorId).toBe(DOC_A);

    const tl = await admin.db.execute(
      sql`SELECT type FROM clinical_timeline_events WHERE org_id = ${TEST_ORG} AND correlation_id LIKE 'clw-%'`,
    );
    expect((tl as unknown as RawRows).rows.map((r) => r.type)).toContain('encounter_created');

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('cross-branch patient → 404 (no leak); reception cannot create → 403', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    await expect(
      clw(() => svc.encounters.create(doctorPrincipal(fx.branch1, DOC_A), { patientId: fx.patient2B2, chiefComplaint: '[clw] xbranch' })),
    ).rejects.toThrow(NotFoundError);
    await expect(
      clw(() => svc.encounters.create(receptionPrincipal(fx.branch1), { patientId: fx.patientB1, chiefComplaint: '[clw] recep' })),
    ).rejects.toThrow(ForbiddenError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('doctor own-scope: doctor B cannot see or touch doctor A encounter (404, no leak)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const enc = await clw(() => svc.encounters.create(doctorPrincipal(fx.branch1, DOC_A), { patientId: fx.patientB1, chiefComplaint: '[clw] own-scope' }));

    await expect(clw(() => svc.encounters.getById(doctorPrincipal(fx.branch1, DOC_B), enc.id))).rejects.toThrow(NotFoundError);
    await expect(
      clw(() => svc.encounters.transition(doctorPrincipal(fx.branch1, DOC_B), enc.id, { status: 'completed' })),
    ).rejects.toThrow(NotFoundError);
    const listB = await clw(() => svc.encounters.search(doctorPrincipal(fx.branch1, DOC_B), {}));
    expect(listB.find((e) => e.id === enc.id)).toBeUndefined();

    const bmView = await clw(() => svc.encounters.getById(bmPrincipal(fx.branch1), enc.id));
    expect(bmView.id).toBe(enc.id);
    const hqView = await clw(() => svc.encounters.getById(hqPrincipal(), enc.id));
    expect(hqView.id).toBe(enc.id);

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('safety gate: severe adverse event blocks completion until allergy acknowledged', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const doc = doctorPrincipal(fx.branch1, DOC_A);
    const enc = await clw(() => svc.encounters.create(doc, { patientId: fx.patientB1, chiefComplaint: '[clw] safety' }));

    await clw(() => svc.ops.reportAdverseEvent(doc, {
      patientId: fx.patientB1, encounterId: enc.id, severity: 'severe',
      description: '[clw] Urticaria after penicillin (test fixture)',
    }));
    await expect(clw(() => svc.encounters.transition(doc, enc.id, { status: 'completed' })))
      .rejects.toThrow(/Safety gate/);

    await clw(() => svc.encounters.acknowledgeAllergy(doc, enc.id));
    const done = await clw(() => svc.encounters.transition(doc, enc.id, { status: 'completed' }));
    expect(done.status).toBe('completed');
    expect(done.completedAt).not.toBeNull();

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('SOAP lifecycle: draft → sign (one-way) → double-sign 409 → amend creates v2', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const doc = doctorPrincipal(fx.branch1, DOC_A);
    const enc = await clw(() => svc.encounters.create(doc, { patientId: fx.patientB1, chiefComplaint: '[clw] soap' }));

    const draft = await clw(() => svc.notes.createOrReplaceDraft(doc, {
      encounterId: enc.id, soapSubjective: '[clw] sakit', soapObjective: 'caries 36',
      soapAssessment: 'pulpitis', soapPlan: 'RCT',
    }));
    expect(draft.signedAt).toBeNull();

    const draft2 = await clw(() => svc.notes.createOrReplaceDraft(doc, {
      encounterId: enc.id, soapSubjective: '[clw] sakit teruk', soapObjective: 'caries 36 oklusal',
      soapAssessment: 'pulpitis irreversible', soapPlan: 'RCT + crown',
    }));
    const old = await admin.db.execute(
      sql`SELECT superseded_by_note_id::text AS s FROM clinical_notes WHERE id = ${draft.id}`,
    );
    expect((old as unknown as RawRows).rows[0]!.s).toBe(draft2.id);

    const signed = await clw(() => svc.notes.sign(doc, draft2.id));
    expect(signed.signedAt).not.toBeNull();

    await expect(clw(() => svc.notes.sign(doc, draft2.id))).rejects.toThrow(ConflictError);

    const amend = await clw(() => svc.notes.amend(doc, draft2.id, {
      encounterId: enc.id, soapSubjective: '[clw] sakit teruk (amended)', soapObjective: 'caries 36 oklusal',
      soapAssessment: 'pulpitis irreversible', soapPlan: 'RCT + crown + review',
    }));
    expect(amend.version).toBe(2);
    expect(amend.amendsNoteId).toBe(draft2.id);

    const orig = await admin.db.execute(
      sql`SELECT soap_subjective FROM clinical_notes WHERE id = ${draft2.id}`,
    );
    expect((orig as unknown as RawRows).rows[0]!.soap_subjective).toBe('[clw] sakit teruk');

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('plan lifecycle: draft→proposed→accepted→active→completed with gates + outbox events', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const doc = doctorPrincipal(fx.branch1, DOC_A);

    const cat = await clw(() => svc.ops.createCatalogEntry(hqPrincipal(), {
      name: '[clw] Test Root Canal', category: 'Endodontic', durationMin: 90,
    }));
    expect(cat.code).toMatch(/^TRT-\d{4}$/);

    const { plan } = await clw(() => svc.plans.create(doc, {
      patientId: fx.patientB1, title: '[clw] RCT 36 plan', consentRequired: true,
      items: [{ treatmentId: cat.id, description: '[clw] RCT 36', toothFdi: '36', quantity: 1 }],
    }));
    expect(plan.planCode).toMatch(/^TPL-\d{4}$/);
    expect(plan.status).toBe('draft');

    await expect(clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'active' }))).rejects.toThrow(ConflictError);
    await expect(clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'completed' }))).rejects.toThrow(ConflictError);

    await clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'proposed' }));
    await expect(clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'accepted' })))
      .rejects.toThrow(/Consent gate/);

    const tpl = await clw(() => svc.ops.createTemplate(hqPrincipal(), {
      title: '[clw] RCT Consent', body: 'Saya faham risiko rawatan saluran akar...',
    }));
    await clw(() => svc.ops.recordConsent(doc, {
      patientId: fx.patientB1, templateId: tpl.id, planId: plan.id,
      method: 'written', consentedBy: '[clw] Patient A',
    }));
    const accepted = await clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'accepted' }));
    expect(accepted.acceptedAt).not.toBeNull();

    const active = await clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'active' }));
    expect(active.activatedAt).not.toBeNull();

    await expect(clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'completed' }))).rejects.toThrow(/pending/);

    const items = await clw(() => svc.plans.getById(doc, plan.id));
    await clw(() => svc.plans.setItemStatus(doc, items.items[0]!.id, { status: 'done' }));
    const session = await clw(() => svc.plans.recordSession(doc, plan.id, { summary: '[clw] Visit 1 — access opening' }));
    expect(session.sessionNo).toBe(1);

    const completed = await clw(() => svc.plans.changeStatus(doc, plan.id, { status: 'completed' }));
    expect(completed.completedAt).not.toBeNull();

    const ev = await admin.db.execute(
      sql`SELECT event_type FROM domain_events WHERE org_id = ${TEST_ORG} AND correlation_id LIKE 'clw-%' ORDER BY occurred_at, id`,
    );
    expect((ev as unknown as RawRows).rows.map((r) => r.event_type))
      .toEqual(['TREATMENT_STARTED', 'TREATMENT_COMPLETED']);

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('audit atomicity: audit failure rolls back the encounter mutation (0 rows anywhere)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    class ThrowingAuditPort extends AuditPort {
      record(_e: AuditEvent): void { throw new Error('audit backend down (controlled failure)'); }
    }
    const ctx = new DbContextService(db);
    const svc = new EncountersService(
      ctx, new ClinicalCoreRepository(), new ClinicalExtendedRepository(),
      new PatientsReadPort(db), new AuditService(new ThrowingAuditPort()),
    );
    await expect(
      clw(() => svc.create(doctorPrincipal(fx.branch1, DOC_A), { patientId: fx.patientB1, chiefComplaint: '[clw] atomicity' })),
    ).rejects.toThrow(/audit backend down/);

    const n = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM encounters WHERE org_id = ${TEST_ORG} AND chief_complaint LIKE '%[clw]%'`,
    );
    expect((n as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
    const tl = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM clinical_timeline_events WHERE org_id = ${TEST_ORG} AND correlation_id LIKE 'clw-%'`,
    );
    expect((tl as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('validation: bad FDI / short title / foreign catalog id rejected before any write', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const doc = doctorPrincipal(fx.branch1, DOC_A);
    const enc = await clw(() => svc.encounters.create(doc, { patientId: fx.patientB1, chiefComplaint: '[clw] validation' }));

    await expect(clw(() => svc.notes.upsertTooth(doc, {
      encounterId: enc.id, fdi: 19, condition: 'decayed',
    }))).rejects.toThrow(ValidationError);
    await expect(clw(() => svc.plans.create(doc, {
      patientId: fx.patientB1, title: 'ab',
      items: [{ description: '[clw] xxxx' }],
    }))).rejects.toThrow(ValidationError);
    await expect(clw(() => svc.plans.create(doc, {
      patientId: fx.patientB1, title: '[clw] Valid title',
      items: [{ treatmentId: '99999999-9999-9999-9999-999999999999', description: '[clw] ghost treatment' }],
    }))).rejects.toThrow(ValidationError);

    const tooth = await clw(() => svc.notes.upsertTooth(doc, {
      encounterId: enc.id, fdi: '36', condition: 'decayed', surfaces: ['O'], notes: '[clw] occlusal',
    }));
    expect(tooth.fdiNo).toBe(36);

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('org isolation: canonical-org queries never see test-org clinical rows', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const fx = await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const doc = doctorPrincipal(fx.branch1, DOC_A);
    await clw(() => svc.encounters.create(doc, { patientId: fx.patientB1, chiefComplaint: '[clw] orgiso' }));

    const canonical = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM encounters WHERE org_id = '00000000-0000-0000-0000-000000000001'`,
    );
    expect((canonical as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);

    await purge(admin.db); await admin.close(); await close();
  });
});
