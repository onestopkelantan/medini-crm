import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { PatientsService } from '@modules/patients/application/patients.service';
import { AppointmentsRepository } from '@modules/appointments/infrastructure/appointments.repository';
import { AppointmentsService } from '@modules/appointments/application/appointments.service';
import { DashboardService } from '@modules/dashboard/application/dashboard.service';
import { ValidationError, ForbiddenError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[hq] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-999999999960';

function hqPrincipal() {
  return { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
}
function bmPrincipal(branchId: string) {
  return { staffId: '00000000-0000-0000-0000-0000000000bb', username: 'manager', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null };
}
function doctorPrincipal(branchId: string, doctorId: string) {
  return { staffId: doctorId, username: 'doctor', role: 'doctor', orgId: TEST_ORG, branchId, doctorId };
}

function build(db: ReturnType<typeof createFreshDatabase>['db']) {
  const ctx = new DbContextService(db);
  const audit = new AuditService(new InMemoryAuditAdapter());
  const patientsRepo = new PatientsRepository();
  const apptsRepo = new AppointmentsRepository();
  const pRead = new PatientsReadPort(db);
  const aRead = new AppointmentsReadPort(db);
  const patients = new PatientsService(ctx, patientsRepo, audit, pRead);
  const appts = new AppointmentsService(ctx, apptsRepo, pRead, audit);
  const dash = new DashboardService(ctx, pRead, aRead);
  return { patients, appts, dash, ctx };
}

async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM appointments WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM patients WHERE org_id = ${TEST_ORG}`);
  /* deterministic allocator counters for the test org */
  const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
  await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_mrn_${key}`)} START WITH 1`);
  await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_apt_${key}`)} START WITH 1`);
  await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_mrn_${key}`)} RESTART WITH 1`);
  await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_apt_${key}`)} RESTART WITH 1`);
}

describe('remediation — HQ access + doctor own-scope (GLM #3 #4)', () => {
  dbIt('HQ registers a patient with explicit branchId (org-wide identity)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bRows = await admin.db.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`);
    const bId = (bRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const res = await svc.patients.register(hqPrincipal(), {
      name: 'HQ Registered', branchId: bId,
    });
    expect(res.patient.branchId).toBe(bId);
    expect(res.patient.mrn).toMatch(/^MDN-\d{4}$/);

    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('HQ registration WITHOUT branchId → 422 (explicit target required)', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    await expect(
      svc.patients.register(hqPrincipal(), { name: 'No Branch' }),
    ).rejects.toThrow(ValidationError);
    await close();
  });

  dbIt('HQ books an appointment and reads org-wide dashboard', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bRows = await admin.db.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`);
    const bId = (bRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    const pRows = await admin.db.execute(
      sql`INSERT INTO patients (org_id, branch_id, mrn, name)
          VALUES (${TEST_ORG}, ${bId}, 'MDN-HQ01', 'HQ Patient') RETURNING id::text AS id`,
    );
    const pId = (pRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const appt = await svc.appts.book(hqPrincipal(), {
      patientId: pId, patientName: 'HQ Patient',
      scheduledDate: '2026-11-01', scheduledTime: '10:00', branchId: bId,
    });
    expect(appt.code).toMatch(/^APT-\d{4}$/);

    const dash = await svc.dash.context(hqPrincipal(), '2026-11-01');
    expect(dash.appointments.total).toBe(1);

    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('branch manager cannot see another branch (no HQ escalation)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const [b1, b2] = await (async () => {
      const rows = await admin.db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
      const list = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
      return [list[0]!, list[1]!] as const;
    })();
    await admin.db.execute(
      sql`INSERT INTO patients (org_id, branch_id, mrn, name)
          VALUES (${TEST_ORG}, ${b1}, 'MDN-B1', 'Branch One'),
                 (${TEST_ORG}, ${b2}, 'MDN-B2', 'Branch Two')`,
    );

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const mine = await svc.patients.search(bmPrincipal(b1), 'Branch');
    expect(mine.map((p) => p.mrn)).toEqual(['MDN-B1']);

    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('doctor sees own patients (appointment link) but not another doctor\'s', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bRows = await admin.db.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`);
    const bId = (bRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    const dRows = await admin.db.execute(sql`SELECT id::text AS id FROM staff WHERE role='doctor' LIMIT 1`);
    const docId = (dRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    const pRows = await admin.db.execute(
      sql`INSERT INTO patients (org_id, branch_id, mrn, name)
          VALUES (${TEST_ORG}, ${bId}, 'MDN-DOC1', 'Doctor Patient') RETURNING id::text AS id`,
    );
    const pId = (pRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    /* link doctor ↔ patient via an appointment (own-scope source of truth) */
    await admin.db.execute(
      sql`INSERT INTO appointments (org_id, branch_id, code, patient_id, patient_name, doctor_id, scheduled_date, scheduled_time)
          VALUES (${TEST_ORG}, ${bId}, 'APT-DOC1', ${pId}, 'Doctor Patient', ${docId}, '2026-11-02', '09:00')`,
    );

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const own = await svc.patients.search(doctorPrincipal(bId, docId), 'Doctor');
    expect(own.map((p) => p.mrn)).toEqual(['MDN-DOC1']);

    /* another (non-linked) doctor sees nothing */
    const other = await svc.patients.search(doctorPrincipal(bId, '00000000-0000-0000-0000-0000000000aa'), 'Doctor');
    expect(other).toHaveLength(0);

    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('missing branch context for non-HQ still fails closed', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const noBranch = { ...bmPrincipal('x'), branchId: null };
    await expect(svc.patients.search(noBranch, 'q')).rejects.toThrow(ForbiddenError);
    await close();
  });
});
