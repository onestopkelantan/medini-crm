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
import { ForbiddenError, ConflictError, ValidationError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';
const TEST_ORG = 'cccccccc-5c5c-4c5c-8c5c-000000000503';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}
const hq = { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
const bm = (branchId: string) => ({ staffId: '00000000-0000-0000-0000-0000000000bb', username: 'bm', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null });

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit: InMemoryAuditAdapter, idem: InMemoryIdempotencyAdapter) {
  const ctx = new DbContextService(db);
  return new OperationsService(ctx, new OperationsRepository(), new PatientsReadPort(db), new ClinicalReadPort(db), new AppointmentsReadPort(db), new AuditService(audit), new IdempotencyService(idem));
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  for (const t of ['lab_cases','patients','staff']) {
    await admin.execute(sql.raw(`DELETE FROM ${t} WHERE org_id='${TEST_ORG}'`));
  }
}
async function seed(admin: ReturnType<typeof createFreshDatabase>['db']) {
  await admin.execute(sql`INSERT INTO staff (org_id, branch_id, name, username, role, status) VALUES (${TEST_ORG}, NULL, 'HQ Lab Tester', 'hq-s5t3', 'hq', 'Active') ON CONFLICT (org_id, username) DO NOTHING`);
  const st = await admin.execute(sql`SELECT id::text AS id FROM staff WHERE org_id=${TEST_ORG} AND username='hq-s5t3'`);
  const hqStaffId = (st as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const [b1, b2] = (rows as unknown as { rows: Array<{ id: string }> }).rows.map(r => r.id);
  await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${TEST_ORG}, ${b1}, 'MDN-L501', 'Lab P1'), (${TEST_ORG}, ${b2}, 'MDN-L502', 'Lab P2')`);
  const p = await admin.execute(sql`SELECT id::text AS id FROM patients WHERE org_id=${TEST_ORG} ORDER BY mrn`);
  const pr = (p as unknown as { rows: Array<{ id: string }> }).rows;
  return { b1: b1!, b2: b2!, p1: pr[0]!.id, p2: pr[1]!.id, hqStaffId };
}

describe('S5-T3 LabCase — Operations-owned, Finance boundary preserved (unique org per suite)', () => {
  dbIt('lab case lifecycle: open → in_progress → ready_for_billing → billing_submitted → completed', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const hqP = { ...hq, staffId: s.hqStaffId };
    const lc = await svc.createLabCase(hqP, { branchId: s.b1, patientId: s.p1, labVendor: 'SmileLab', workDescription: 'Crown PFM #16', dueDate: '2026-08-25', idempotencyKey: 'idem-lab-0001' });
    expect(lc.status).toBe('open');
    await svc.transitionLabCase(hqP, lc.id, { status: 'in_progress' });
    await svc.transitionLabCase(hqP, lc.id, { status: 'ready_for_billing' });
    const submitted = await svc.transitionLabCase(hqP, lc.id, { status: 'billing_submitted' });
    expect((submitted as { billingSubmittedAt: Date | null }).billingSubmittedAt).not.toBeNull();
    const done = await svc.transitionLabCase(hq, lc.id, { status: 'completed' });
    expect(done.status).toBe('completed');
    await expect(svc.transitionLabCase(hq, lc.id, { status: 'open' })).rejects.toThrow(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('invalid transitions rejected: cannot skip from open to billing_submitted', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const lc = await svc.createLabCase(hq, { branchId: s.b1, patientId: s.p1, labVendor: 'SmileLab', workDescription: 'Denture repair' });
    await expect(svc.transitionLabCase(hq, lc.id, { status: 'billing_submitted' })).rejects.toThrow(ConflictError);
    await expect(svc.transitionLabCase(hq, lc.id, { status: 'completed' })).rejects.toThrow(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('invalid patient reference rejected; cross-branch patient denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    await expect(svc.createLabCase(hq, { branchId: s.b1, patientId: '00000000-0000-0000-0000-000000000000', labVendor: 'V', workDescription: 'W' })).rejects.toThrow(ValidationError);
    // patient from branch2 attached to branch1 lab case → denied
    await expect(svc.createLabCase(hq, { branchId: s.b1, patientId: s.p2, labVendor: 'V', workDescription: 'W' })).rejects.toThrow(ForbiddenError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('lab case idempotency: same key replays, no duplicate row', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const input = { branchId: s.b1, patientId: s.p1, labVendor: 'SmileLab', workDescription: 'Bridge #24-26', idempotencyKey: 'idem-lab-0002' };
    const first = await svc.createLabCase(hq, input);
    const replay = await svc.createLabCase(hq, input);
    expect(replay.id).toBe(first.id);
    const all = await svc.listLabCases(hq, s.b1);
    expect(all.length).toBe(1);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('Operations module exposes NO lab_payable write path (Finance boundary)', async () => {
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db, audit, idem) as unknown as Record<string, unknown>;
    // verify the service has no method that writes lab_payables
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc));
    const financeWrites = methods.filter(m => /payable|payment|invoice|approve.*fin|finance/i.test(m));
    expect(financeWrites.length).toBe(0);
    await close();
  });

  dbIt('BM branch-scoped lab cases; cross-branch invisible at RLS layer', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    await svc.createLabCase(hq, { branchId: s.b1, patientId: s.p1, labVendor: 'V', workDescription: 'W' });
    const bmOwn = await svc.listLabCases(bm(s.b1)); expect(bmOwn.length).toBe(1);
    const bmOther = await svc.listLabCases(bm(s.b2)); expect(bmOther.length).toBe(0);
    await purge(admin.db); await admin.close(); await close();
  });
});
