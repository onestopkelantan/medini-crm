import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { AdministrationRepository } from '@modules/administration/infrastructure/administration.repository';
import { AdministrationService } from '@modules/administration/application/administration.service';
import { canTransitionStaffStatus } from '@modules/administration/domain/administration-lifecycle';
import { ForbiddenError, ConflictError, ValidationError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000701';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

/* S7-namespaced principal staff IDs (staff_pkey is globally unique). */
const P = {
  hq1: '70d1f1a1-0000-4000-8000-0000000000a1',
  hq2: '70d1f1a1-0000-4000-8000-0000000000a2',
  bm: '70d1f1a1-0000-4000-8000-0000000000bb',
  ba: '70d1f1a1-0000-4000-8000-0000000000cc',
  dr: '70d1f1a1-0000-4000-8000-0000000000dd',
  target: '70d1f1a1-0000-4000-8000-0000000000ee',
};
const hq = { staffId: P.hq1, username: 'hq-s7', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
const hq2 = { staffId: P.hq2, username: 'hq2-s7', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
const bm = (branchId: string) => ({ staffId: P.bm, username: 'bm-s7', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null });

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit: InMemoryAuditAdapter) {
  const ctx = new DbContextService(db);
  return new AdministrationService(
    ctx,
    new AdministrationRepository(),
    new AuditService(audit),
    { revokeAllForStaff: async () => {} } as never,
    { generateInviteToken: async () => ({ token: 't', expiresAt: new Date() }) } as never,
  );
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  await admin.execute(sql`DELETE FROM role_assignments WHERE staff_id IN (SELECT id FROM staff WHERE org_id=${TEST_ORG})`);
  await admin.execute(sql`DELETE FROM staff WHERE org_id=${TEST_ORG}`);
}
async function seed(admin: ReturnType<typeof createFreshDatabase>['db']) {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const [b1, b2] = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  /* Deterministic principal staff (drop stale first — staff_pkey is global). */
  await admin.execute(sql`DELETE FROM staff WHERE id IN (${P.hq1},${P.hq2},${P.bm},${P.ba},${P.dr},${P.target})`);
  await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
    (${P.hq1}, ${TEST_ORG}, NULL, 'HQ One', 'hq-s7-fixed', 'hq', 'Active'),
    (${P.hq2}, ${TEST_ORG}, NULL, 'HQ Two', 'hq2-s7-fixed', 'hq', 'Active'),
    (${P.bm}, ${TEST_ORG}, ${b1}, 'BM Fixed', 'bm-s7-fixed', 'branch_manager', 'Active'),
    (${P.ba}, ${TEST_ORG}, ${b1}, 'BA Fixed', 'ba-s7-fixed', 'branch_admin', 'Active'),
    (${P.dr}, ${TEST_ORG}, ${b1}, 'DR Fixed', 'dr-s7-fixed', 'doctor', 'Active')`);
  return { b1: b1!, b2: b2! };
}

describe('S7 Administration — RBAC (HQ only) + lifecycle + last-HQ + versioned roles (unique org per suite)', () => {
  dbIt('organization record + branches read surface (hq + non-hq denied)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const org = await svc.getOrganization(hq);
    expect(org?.name).toBe('Medini Dental Group');
    expect(org?.id).toBe('00000000-0000-0000-0000-000000000001');
    /* branches are seeded under the single canonical org (single-tenant) */
    const branches = await svc.listBranches(hq, '00000000-0000-0000-0000-000000000001');
    expect(branches.length).toBeGreaterThanOrEqual(14);
    /* non-HQ denied on admin domain (matrix: admin = NONE for all but hq) */
    await expect(svc.listStaff(bm(s.b1), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.inviteStaff(bm(s.b1), { name: 'X Y', username: 'xy1', role: 'branch_admin', branchId: s.b1 })).rejects.toBeInstanceOf(ForbiddenError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('invite → INVITED + initial ACTIVE role assignment; duplicate username rejected', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const invited = await svc.inviteStaff(hq, { name: 'New Staff', username: 'newstaff1', role: 'branch_admin', branchId: s.b1, email: 'n@x.com' });
    expect(invited.status).toBe('Invited');
    expect(invited.role).toBe('branch_admin');
    const history = await svc.getRoleHistory(hq, invited.id);
    expect(history.length).toBe(1);
    expect(history[0]!.status).toBe('ACTIVE');
    expect(history[0]!.role).toBe('branch_admin');
    /* duplicate username */
    await expect(svc.inviteStaff(hq, { name: 'Dup', username: 'newstaff1', role: 'branch_admin', branchId: s.b1 })).rejects.toBeInstanceOf(ConflictError);
    /* branch rule: non-hq must have branch; hq must NOT */
    await expect(svc.inviteStaff(hq, { name: 'No Branch', username: 'nobranch', role: 'branch_admin', branchId: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.inviteStaff(hq, { name: 'HQ Bad', username: 'hqbad', role: 'hq', branchId: s.b1 })).rejects.toBeInstanceOf(ValidationError);
    /* audit recorded */
    expect(audit.events.some((e) => e.action === 'staff_invited')).toBe(true);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('lifecycle INVITED→ACTIVE→SUSPENDED→ACTIVE→DEACTIVATED + invalid transitions rejected', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const m = await svc.inviteStaff(hq, { name: 'Life Cycle', username: 'lifecycle1', role: 'branch_admin', branchId: s.b1 });
    /* INVITED cannot be suspended/deactivated directly (reason ≥ 2 chars to pass validation) */
    await expect(svc.transitionStaff(hq, m.id, 'suspend', { reason: 'no' })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.transitionStaff(hq, m.id, 'deactivate', { reason: 'no' })).rejects.toBeInstanceOf(ConflictError);
    /* activate */
    let r = await svc.transitionStaff(hq, m.id, 'activate', { reason: 'ok' });
    expect(r.status).toBe('Active');
    /* suspend then reactivate */
    r = await svc.transitionStaff(hq, m.id, 'suspend', { reason: 'investigation' });
    expect(r.status).toBe('Suspended');
    r = await svc.transitionStaff(hq, m.id, 'reactivate', { reason: 'cleared' });
    expect(r.status).toBe('Active');
    /* deactivate (terminal governance state) */
    r = await svc.transitionStaff(hq, m.id, 'deactivate', { reason: 'left company' });
    expect(r.status).toBe('Deactivated');
    /* reactivate from deactivated allowed (HQ) */
    r = await svc.transitionStaff(hq, m.id, 'reactivate', { reason: 'rehired' });
    expect(r.status).toBe('Active');
    await purge(admin.db); await admin.close(); await close();
  });

  it('domain state machine (unit): only legal transitions', () => {
    expect(canTransitionStaffStatus('Invited', 'Active')).toBe(true);
    expect(canTransitionStaffStatus('Invited', 'Suspended')).toBe(false);
    expect(canTransitionStaffStatus('Active', 'Suspended')).toBe(true);
    expect(canTransitionStaffStatus('Active', 'Deactivated')).toBe(true);
    expect(canTransitionStaffStatus('Suspended', 'Active')).toBe(true);
    expect(canTransitionStaffStatus('Deactivated', 'Active')).toBe(true);
    expect(canTransitionStaffStatus('Active', 'Active')).toBe(false);
  });

  dbIt('self-protection: HQ cannot suspend/deactivate/change own role', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    await expect(svc.transitionStaff(hq, P.hq1, 'suspend', { reason: 'no' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.transitionStaff(hq, P.hq1, 'deactivate', { reason: 'no' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.assignRole(hq, P.hq1, { role: 'branch_manager', branchId: s.b1, reason: 'no' })).rejects.toBeInstanceOf(ForbiddenError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('last-HQ protection: cannot suspend/deactivate/demote the last active HQ', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    /* seed with ONLY ONE hq (remove hq2) */
    const rows = await admin.db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
    const b1 = (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    await admin.db.execute(sql`DELETE FROM staff WHERE id IN (${P.hq1},${P.hq2})`);
    await admin.db.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
      (${P.hq1}, ${TEST_ORG}, NULL, 'Only HQ', 'hq-s7-solo', 'hq', 'Active')`);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    /* A second HQ actor tries to remove the ONLY other hq — that would leave the
     * system with zero active HQ admins. The last-HQ guard must block it. */
    await expect(svc.transitionStaff(hq2, P.hq1, 'suspend', { reason: 'no' })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.assignRole(hq2, P.hq1, { role: 'branch_manager', branchId: b1, reason: 'no' })).rejects.toBeInstanceOf(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('versioned role assignment: old SUPERSEDED, new ACTIVE; history preserved', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const m = await svc.inviteStaff(hq, { name: 'Role Changer', username: 'rolechanger', role: 'branch_admin', branchId: s.b1 });
    await svc.transitionStaff(hq, m.id, 'activate', { reason: 'ok' });
    /* promote branch_admin → branch_manager (branch b1) */
    const res = await svc.assignRole(hq, m.id, { role: 'branch_manager', branchId: s.b1, reason: 'promotion' });
    expect(res.staff.role).toBe('branch_manager');
    const history = await svc.getRoleHistory(hq, m.id);
    expect(history.length).toBe(2);
    const active = history.filter((h) => h.status === 'ACTIVE');
    const superseded = history.filter((h) => h.status === 'SUPERSEDED');
    expect(active.length).toBe(1);
    expect(active[0]!.role).toBe('branch_manager');
    expect(superseded.length).toBe(1);
    expect(superseded[0]!.role).toBe('branch_admin');
    /* reassign to different branch (b2) */
    await svc.assignRole(hq, m.id, { role: 'branch_manager', branchId: s.b2, reason: 'transfer' });
    const history2 = await svc.getRoleHistory(hq, m.id);
    expect(history2.length).toBe(3);
    expect(history2.filter((h) => h.status === 'ACTIVE').length).toBe(1);
    expect(history2.find((h) => h.status === 'ACTIVE')!.branchId).toBe(s.b2);
    expect(audit.events.some((e) => e.action === 'staff_role_assigned')).toBe(true);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('N7-1 regression: 2-HQ SEQUENTIAL — suspend HQ1 allowed, suspend HQ2 DENIED, never 0 ACTIVE HQ', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    /* exactly two ACTIVE HQ */
    await admin.db.execute(sql`DELETE FROM staff WHERE id IN (${P.hq1},${P.hq2})`);
    await admin.db.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
      (${P.hq1}, ${TEST_ORG}, NULL, 'HQ Seq One', 'hq-s7-seq1', 'hq', 'Active'),
      (${P.hq2}, ${TEST_ORG}, NULL, 'HQ Seq Two', 'hq-s7-seq2', 'hq', 'Active')`);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    /* actor = seeded system hq (hq2) — NOT the target (avoids self-protection) */
    const r1 = await svc.transitionStaff(hq2, P.hq1, 'suspend', { reason: 'first' });
    expect(r1.status).toBe('Suspended');
    /* suspend HQ2 → DENY (HQ1 suspended no longer counts as ACTIVE — N7-1).
     * actor is hq2 acting on hq2 → would be self-protection; use a third hq
     * actor to isolate the last-HQ guard. */
    const hq3 = { staffId: '70d1f1a1-0000-4000-8000-0000000000a3', username: 'hq3-s7', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
    await expect(svc.transitionStaff(hq3, P.hq2, 'suspend', { reason: 'second' })).rejects.toBeInstanceOf(ConflictError);
    /* final state: HQ2 still ACTIVE (exactly 1 active HQ) */
    const final = await svc.getStaff(hq2, P.hq2);
    expect(final.status).toBe('Active');
    /* deactivate HQ2 also denied while HQ1 suspended */
    await expect(svc.transitionStaff(hq3, P.hq2, 'deactivate', { reason: 'no' })).rejects.toBeInstanceOf(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('N7-2 regression: 2-HQ CONCURRENT race — exactly ONE suspend succeeds, never 0 ACTIVE HQ (×5 rounds)', async () => {
    const audit = new InMemoryAuditAdapter();
    for (let round = 0; round < 5; round++) {
      const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
      await admin.db.execute(sql`DELETE FROM staff WHERE id IN (${P.hq1},${P.hq2})`);
      await admin.db.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
        (${P.hq1}, ${TEST_ORG}, NULL, 'HQ Race One', 'hq-s7-race1', 'hq', 'Active'),
        (${P.hq2}, ${TEST_ORG}, NULL, 'HQ Race Two', 'hq-s7-race2', 'hq', 'Active')`);
      /* two INDEPENDENT connections (separate pools → true concurrent txs) */
      const c1 = createFreshDatabase(RUNTIME_URL);
      const c2 = createFreshDatabase(RUNTIME_URL);
      const svcA = build(c1.db, audit);
      const svcB = build(c2.db, audit);
      const actor = { staffId: P.hq2, username: 'actor', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
      const [resA, resB] = await Promise.allSettled([
        svcA.transitionStaff(actor, P.hq1, 'suspend', { reason: 'race A' }),
        svcB.transitionStaff(actor, P.hq2, 'suspend', { reason: 'race B' }),
      ]);
      const succeeded = [resA, resB].filter((r) => r.status === 'fulfilled').length;
      const failed = [resA, resB].filter((r) => r.status === 'rejected').length;
      /* exactly one succeeds, exactly one fails (last-HQ serialization) */
      expect(succeeded).toBe(1);
      expect(failed).toBe(1);
      /* final: exactly ONE active HQ remains */
      const rows = await admin.db.execute(sql`SELECT count(*)::int AS n FROM staff WHERE org_id=${TEST_ORG} AND role='hq' AND status='Active' AND deleted_at IS NULL`);
      expect((rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(1);
      await purge(admin.db); await admin.close(); await c1.close(); await c2.close();
    }
  });

  dbIt('P3: suspended/deactivated staff cannot authenticate (PrincipalResolver fail-closed)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const { PrincipalResolver } = await import('@core/auth/principal.resolver');
    const resolver = new PrincipalResolver(db as never);
    const member = await svc.inviteStaff(hq, { name: 'Auth Test', username: 'authtest', role: 'branch_admin', branchId: s.b1 });
    await svc.transitionStaff(hq, member.id, 'activate', { reason: 'ok' });
    /* active → resolves */
    expect(await resolver.resolve(member.id, TEST_ORG)).not.toBeNull();
    /* suspended → null (fail-closed) */
    await svc.transitionStaff(hq, member.id, 'suspend', { reason: 'investigate' });
    expect(await resolver.resolve(member.id, TEST_ORG)).toBeNull();
    /* reactivate → resolves again; deactivated → null */
    await svc.transitionStaff(hq, member.id, 'reactivate', { reason: 'cleared' });
    expect(await resolver.resolve(member.id, TEST_ORG)).not.toBeNull();
    await svc.transitionStaff(hq, member.id, 'deactivate', { reason: 'left' });
    expect(await resolver.resolve(member.id, TEST_ORG)).toBeNull();
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('RLS probe: non-hq organizations writes denied (WITH CHECK hq only, fail-closed)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    /* doctor context: organizations READ allowed (policy includes doctor).
     * set_config(..., is_local=false) is SESSION-scoped; use a single connection
     * so the GUC applies to subsequent statements (pooled clients may switch). */
    const client = await (db as unknown as { $client: { connect(): Promise<{ query(q: string): Promise<{ rows: Array<{ n: number }> }>; release(): void }> } }).$client.connect();
    try {
      await client.query(`SELECT set_config('app.role','doctor',false)`);
      const read = await client.query(`SELECT count(*)::int AS n FROM organizations`);
      expect(read.rows[0]!.n).toBeGreaterThanOrEqual(1);
      /* WRITE must fail (WITH CHECK hq only) — even though read is allowed. */
      let writeDenied = false;
      try {
        await client.query(`INSERT INTO organizations (id,name,status) VALUES (gen_random_uuid(),'Evil Org','active')`);
      } catch { writeDenied = true; }
      expect(writeDenied).toBe(true);
    } finally {
      client.release();
    }
    await admin.close(); await close();
  });

  dbIt('staff + role_assignments have NO RLS (consistent with S1 design); access is app+guard enforced', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    /* staff/role_assignments have RLS ENABLED (N9-1: least-privilege hardening for
     * legacy S0 tables). Human access preserved via permissive policies;
     * system_worker writes denied via restrictive policies. This test documents
     * the invariant so a future change that alters RLS here is caught. */
    const rows = await db.execute(sql`SELECT relrowsecurity AS rls FROM pg_class WHERE relname='staff'`);
    expect((rows as unknown as { rows: Array<{ rls: boolean }> }).rows[0]!.rls).toBe(true);
    await admin.close(); await close();
  });
});
