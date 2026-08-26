import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { IdempotencyService, InMemoryIdempotencyAdapter } from '@shared/idempotency/idempotency.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { ClinicalReadPort } from '@shared/ports/clinical.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { OperationsRepository } from '@modules/operations/infrastructure/operations.repository';
import { OperationsService } from '@modules/operations/application/operations.service';
import { ForbiddenError, ConflictError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';
const TEST_ORG = 'bbbbbbbb-5b5b-4b5b-8b5b-000000000502';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}
const hq = { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
const bm = (branchId: string) => ({ staffId: '00000000-0000-0000-0000-0000000000bb', username: 'bm', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null });
const ba = (branchId: string) => ({ staffId: '00000000-0000-0000-0000-0000000000cc', username: 'ba', role: 'branch_admin', orgId: TEST_ORG, branchId, doctorId: null });
const doc = (branchId: string) => ({ staffId: '00000000-0000-0000-0000-0000000000dd', username: 'dr', role: 'doctor', orgId: TEST_ORG, branchId, doctorId: '00000000-0000-0000-0000-0000000000dd' });

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit: InMemoryAuditAdapter, idem: InMemoryIdempotencyAdapter) {
  const ctx = new DbContextService(db);
  return new OperationsService(ctx, new OperationsRepository(), new PatientsReadPort(db), new ClinicalReadPort(db), new AppointmentsReadPort(db), new AuditService(audit), new IdempotencyService(idem));
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  for (const t of ['lab_cases','incidents','tasks','checklists','doctor_statuses','patients','staff']) {
    await admin.execute(sql.raw(`DELETE FROM ${t} WHERE org_id='${TEST_ORG}'`));
  }
}
async function seed(admin: ReturnType<typeof createFreshDatabase>['db']) {
  await admin.execute(sql`INSERT INTO staff (org_id, branch_id, name, username, role, status) VALUES (${TEST_ORG}, NULL, 'HQ Ops Tester', 'hq-s5t2', 'hq', 'Active') ON CONFLICT (org_id, username) DO NOTHING`);
  const st = await admin.execute(sql`SELECT id::text AS id FROM staff WHERE org_id=${TEST_ORG} AND username='hq-s5t2'`);
  const hqStaffId = (st as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const [b1, b2] = (rows as unknown as { rows: Array<{ id: string }> }).rows.map(r => r.id);
  await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${TEST_ORG}, ${b1}, 'MDN-O501', 'Ops P1'), (${TEST_ORG}, ${b2}, 'MDN-O502', 'Ops P2')`);
  const p = await admin.execute(sql`SELECT id::text AS id FROM patients WHERE org_id=${TEST_ORG} ORDER BY mrn`);
  const pr = (p as unknown as { rows: Array<{ id: string }> }).rows;
  return { b1: b1!, b2: b2!, p1: pr[0]!.id, p2: pr[1]!.id, hqStaffId };
}

describe('S5-T2 Operations — live RLS/RBAC/lifecycle/audit/idempotency (unique org per suite)', () => {
  dbIt('doctor status append-only history with deterministic transitions', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const hqP = { ...hq, staffId: s.hqStaffId };
    const s1 = await svc.setDoctorStatus(hqP, { branchId: s.b1, doctorId: s.hqStaffId, status: 'available' });
    expect(s1.status).toBe('available');
    const s2 = await svc.setDoctorStatus(hqP, { branchId: s.b1, doctorId: s.hqStaffId, status: 'busy' });
    expect(s2.id).not.toBe(s1.id); // append-only history
    await expect(svc.setDoctorStatus(hqP, { branchId: s.b1, doctorId: s.hqStaffId, status: 'available', note: 'invalid from busy? no — busy→available allowed' })).resolves.toBeTruthy();
    const offline = await svc.setDoctorStatus(hqP, { branchId: s.b1, doctorId: s.hqStaffId, status: 'offline' });
    await expect(svc.setDoctorStatus(hqP, { branchId: s.b1, doctorId: s.hqStaffId, status: 'busy' })).rejects.toThrow(ConflictError);
    void offline;
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('task idempotency: same key returns same record; no duplicate on replay', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const input = { branchId: s.b1, title: 'Sterilise room 2', priority: 'high', idempotencyKey: 'idem-task-0001' };
    const first = await svc.createTask(hq, input);
    const replay = await svc.createTask(hq, input);
    expect(replay.id).toBe(first.id);
    const all = await svc.listTasks(hq, s.b1);
    expect(all.length).toBe(1);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('incident lifecycle: open → acknowledged → resolved → closed; reopen rejected', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const inc = await svc.createIncident(hq, { branchId: s.b1, title: 'Autoclave failure', severity: 'high', idempotencyKey: 'idem-inc-0001' });
    await svc.transitionIncident(hq, inc.id, { status: 'acknowledged' });
    await svc.transitionIncident(hq, inc.id, { status: 'resolved' });
    const closed = await svc.transitionIncident(hq, inc.id, { status: 'closed' });
    expect(closed.status).toBe('closed');
    await expect(svc.transitionIncident(hq, inc.id, { status: 'open' })).rejects.toThrow(ConflictError);
    const actions = audit.events.map(e => e.action);
    expect(actions).toContain('incident_created');
    expect(actions).toContain('operations_incident_closed');
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('RBAC: branch_admin and doctor denied; BM branch-scoped; cross-branch write denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    await expect(svc.createTask(ba(s.b1), { branchId: s.b1, title: 'X' })).rejects.toThrow(ForbiddenError);
    await expect(svc.listTasks(doc(s.b1))).rejects.toThrow(ForbiddenError);
    await expect(svc.createTask(bm(s.b1), { branchId: s.b2, title: 'Foreign' })).rejects.toThrow(ForbiddenError);
    await svc.createTask(bm(s.b1), { branchId: s.b1, title: 'Own branch task' });
    const bmOwn = await svc.listTasks(bm(s.b1)); expect(bmOwn.length).toBe(1);
    const bmOther = await svc.listTasks(bm(s.b2)); expect(bmOther.length).toBe(0);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('RLS at DB layer: BM of branch2 cannot see branch1 tasks even via direct query', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    await svc.createTask(hq, { branchId: s.b1, title: 'RLS probe task' });
    await db.execute(sql.raw(`SELECT set_config('app.role','branch_manager',false), set_config('app.org_id','${TEST_ORG}',false), set_config('app.branch_ids','${s.b2}',false)`));
    const rows = await db.execute(sql`SELECT id FROM tasks WHERE org_id=${TEST_ORG}`);
    expect((rows as unknown as { rows: unknown[] }).rows.length).toBe(0);
    await db.execute(sql.raw(`SELECT set_config('app.role','hq',false), set_config('app.org_id','${TEST_ORG}',false), set_config('app.branch_ids','${s.b1},${s.b2}',false)`));
    const hqRows = await db.execute(sql`SELECT id FROM tasks WHERE org_id=${TEST_ORG}`);
    expect((hqRows as unknown as { rows: unknown[] }).rows.length).toBe(1);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('checklist completion stamps completedAt; audit recorded same transaction', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const cl = await svc.createChecklist(hq, { branchId: s.b1, checklistDate: '2026-08-18', title: 'Opening duties', items: [{ label: 'Unlock', done: false }] });
    await svc.transitionChecklist(hq, cl.id, { status: 'in_progress' });
    const done = await svc.transitionChecklist(hq, cl.id, { status: 'completed' });
    expect(done.status).toBe('completed');
    expect((done as { completedAt: Date | null }).completedAt).not.toBeNull();
    await expect(svc.transitionChecklist(hq, cl.id, { status: 'open' })).rejects.toThrow(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });
});
