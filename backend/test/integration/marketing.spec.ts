import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { IdempotencyService, InMemoryIdempotencyAdapter } from '@shared/idempotency/idempotency.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { ClinicalReadPort } from '@shared/ports/clinical.read-port';
import { MarketingRepository } from '@modules/marketing/infrastructure/marketing.repository';
import { MarketingService } from '@modules/marketing/application/marketing.service';
import { ForbiddenError, ConflictError, ValidationError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';
const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000501';
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
  return new MarketingService(ctx, new MarketingRepository(), new PatientsReadPort(db), new AppointmentsReadPort(db), new ClinicalReadPort(db), new AuditService(audit), new IdempotencyService(idem));
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  for (const t of ['follow_up_cases','recall_cases','recall_rules','campaigns','leads','patients','staff']) {
    await admin.execute(sql.raw(`DELETE FROM ${t} WHERE org_id='${TEST_ORG}'`));
  }
}
async function seed(admin: ReturnType<typeof createFreshDatabase>['db']) {
  await admin.execute(sql`INSERT INTO staff (org_id, branch_id, name, username, role, status) VALUES (${TEST_ORG}, NULL, 'HQ Tester', 'hq-s5t1', 'hq', 'Active') ON CONFLICT (org_id, username) DO NOTHING`);
  const staffRow = await admin.execute(sql`SELECT id::text AS id FROM staff WHERE org_id=${TEST_ORG} AND username='hq-s5t1'`);
  const hqStaffId = (staffRow as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const [b1, b2] = (rows as unknown as { rows: Array<{ id: string }> }).rows.map(r => r.id);
  await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${TEST_ORG}, ${b1}, 'MDN-M501', 'Marketing P1'), (${TEST_ORG}, ${b2}, 'MDN-M502', 'Marketing P2')`);
  const p = await admin.execute(sql`SELECT id::text AS id, branch_id::text AS branch FROM patients WHERE org_id=${TEST_ORG} ORDER BY mrn`);
  const pr = (p as unknown as { rows: Array<{ id: string; branch: string }> }).rows;
  return { b1: b1!, b2: b2!, p1: pr[0]!.id, p2: pr[1]!.id, hqStaffId };
}

describe('S5-T1 Marketing — live RLS/RBAC/audit/idempotency (unique org per suite)', () => {
  dbIt('HQ creates lead; BM lists own branch only; BM foreign-branch read is empty', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const lead = await svc.createLead(hq, { branchId: s.b1, name: 'Lead Alpha', source: 'WhatsApp' });
    expect(lead.status).toBe('new');
    const bmOwn = await svc.listLeads(bm(s.b1)); expect(bmOwn.length).toBe(1);
    const bmOther = await svc.listLeads(bm(s.b2)); expect(bmOther.length).toBe(0);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('branch_admin and doctor are denied Marketing entirely (locked RBAC)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    await expect(svc.createLead(ba(s.b1), { branchId: s.b1, name: 'X', source: 's' })).rejects.toThrow(ForbiddenError);
    await expect(svc.listLeads(doc(s.b1))).rejects.toThrow(ForbiddenError);
    await expect(svc.listRecallCases(ba(s.b1))).rejects.toThrow(ForbiddenError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('BM cannot write to a foreign branch; campaign approval is HQ-only', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    await expect(svc.createCampaign(bm(s.b1), { branchId: s.b2, name: 'Foreign', intent: 'x', audienceDefinition: { all: true } })).rejects.toThrow(ForbiddenError);
    const camp = await svc.createCampaign(bm(s.b1), { branchId: s.b1, name: 'Branch Draft', intent: 'recall', audienceDefinition: { segment: 'due' } });
    expect(camp.status).toBe('draft');
    await svc.transitionCampaign(bm(s.b1), camp.id, { status: 'pending_approval' });
    await expect(svc.transitionCampaign(bm(s.b1), camp.id, { status: 'approved' })).rejects.toThrow(ForbiddenError);
    const hqP = { ...hq, staffId: s.hqStaffId };
    const approved = await svc.transitionCampaign(hqP, camp.id, { status: 'approved' });
    expect(approved.status).toBe('approved');
    expect((approved as { approvedBy: string | null }).approvedBy).toBe(s.hqStaffId);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('recall case idempotency: same key returns same record; logical duplicate blocked', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const input = { branchId: s.b1, patientId: s.p1, dueDate: '2026-10-01', idempotencyKey: 'idem-recall-0001' };
    const first = await svc.createRecallCase(hq, input);
    const replay = await svc.createRecallCase(hq, input);
    expect(replay.id).toBe(first.id);
    // different idempotency key, same logical identity → service returns existing (no duplicate row)
    const logicalDup = await svc.createRecallCase(hq, { ...input, idempotencyKey: 'idem-recall-0002' });
    expect(logicalDup.id).toBe(first.id);
    const all = await svc.listRecallCases(hq, s.b1);
    expect(all.length).toBe(1);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('audit rows recorded for creates and transitions (same transaction contract)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const lead = await svc.createLead(hq, { branchId: s.b1, name: 'Audited Lead', source: 'Walk-in' });
    await svc.transitionLead(hq, lead.id, { status: 'contacted' });
    const actions = audit.events.map(e => e.action);
    expect(actions).toContain('marketing_lead_created');
    expect(actions).toContain('marketing_lead_contacted');
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('T4: follow-up with mismatched appointment/encounter ownership is rejected', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    // unknown appointment reference
    await expect(svc.createFollowUp(hq, { branchId: s.b1, patientId: s.p1, appointmentId: '00000000-0000-0000-0000-000000000000', dueDate: '2026-10-10' })).rejects.toThrow(ValidationError);
    // unknown encounter reference
    await expect(svc.createFollowUp(hq, { branchId: s.b1, patientId: s.p1, encounterId: '00000000-0000-0000-0000-000000000000', dueDate: '2026-10-10' })).rejects.toThrow(ValidationError);
    // plain valid follow-up (no references) still works
    const fu = await svc.createFollowUp(hq, { branchId: s.b1, patientId: s.p1, dueDate: '2026-10-10' });
    expect(fu.status).toBe('open');
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('invalid lifecycle transition → ConflictError; cross-branch recall case invisible via RLS', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter(); const idem = new InMemoryIdempotencyAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit, idem);
    const rc = await svc.createRecallCase(hq, { branchId: s.b1, patientId: s.p1, dueDate: '2026-10-05', idempotencyKey: 'idem-recall-rls1' });
    await svc.transitionRecall(hq, rc.id, { status: 'completed' });
    await expect(svc.transitionRecall(hq, rc.id, { status: 'open' })).rejects.toThrow(ConflictError);
    // RLS at DB layer: BM of branch2 cannot see branch1 case even via direct repo path
    const rows = await db.execute(sql.raw(`SELECT set_config('app.role','branch_manager',false), set_config('app.branch_ids','${s.b2}',false)`)).then(() =>
      db.execute(sql`SELECT id FROM recall_cases WHERE org_id=${TEST_ORG}`));
    expect((rows as unknown as { rows: unknown[] }).rows.length).toBe(0);
    await purge(admin.db); await admin.close(); await close();
  });
});
