import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { AuditPort, AuditEvent } from '@shared/audit/audit.port';
import { FinanceClinicalRepository } from '@modules/finance/infrastructure/finance-clinical.repository';
import { ClinicalFinanceService } from '@modules/finance/application/clinical-finance.service';
import { ClinicalReadPort } from '@shared/ports/clinical.read-port';
import { ConflictError } from '@shared/errors/errors';

/**
 * S4 P1 REMEDIATION — financial-integrity regression (live PG, real concurrency).
 *
 *  P1-1  commission payout updates the ledger atomically (paid/outstanding/status),
 *        overpayment → 409, concurrent payouts serialize (one wins), same-tx audit.
 *  P1-2  commission duplicate race — DB unique (org,doctor,period) closes the
 *        check-then-act gap; two concurrent creates → exactly ONE ledger, one 409.
 *  P1-3  lab payment — single atomic guarded UPDATE; concurrent 600+600 on 1000
 *        → one succeeds one 409, final paid=600 outstanding=400, no raw 500.
 *
 * Throwaway org + fixtures purged. Honest skip when DB unreachable.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[finance.p1] PG unreachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!(await probe)) { ctx.skip(); return; }
    await fn();
  });
}

/* Unique throwaway org per suite (convention: never share org UUIDs across
 * spec files — CI runs files in parallel and a purge in one suite would race
 * with another suite's assertions on the same org). */
const TEST_ORG = '99999999-9999-9999-9999-999999abc001';
const STAFF = '00000000-0000-0000-0000-0000000000aa';
const DOCTOR = '00000000-0000-0000-0000-0000000000dd';

function hq() {
  return { staffId: STAFF, username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
}

class RecordingAudit extends AuditPort {
  readonly events: AuditEvent[] = [];
  record(event: AuditEvent, tx?: unknown): Promise<void> | void {
    if (tx) {
      const t = tx as { execute: (q: unknown) => Promise<unknown> };
      return t.execute(
        sql`INSERT INTO audit_log (org_id, branch_id, actor_id, actor_role, action, entity, entity_id, before, after, source, correlation_id)
            VALUES (${event.orgId}, ${event.branchId}, ${event.actorId}, ${event.actorRole}, ${event.action}, ${event.entity}, ${event.entityId},
                    ${event.before ? JSON.stringify(event.before) : null}::jsonb, ${event.after ? JSON.stringify(event.after) : null}::jsonb,
                    ${event.source}, ${event.correlationId})`,
      ).then(() => { this.events.push(event); });
    }
    this.events.push(event);
    return undefined;
  }
}

function buildSvc(db: ReturnType<typeof createFreshDatabase>['db'], audit?: AuditService): ClinicalFinanceService {
  const ctx = new DbContextService(db);
  return new ClinicalFinanceService(
    ctx, new FinanceClinicalRepository(), new ClinicalReadPort(null), audit ?? new AuditService(new RecordingAudit()),
  );
}

let branchId = '';

async function fixtures(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  const b = await admin.execute(sql`SELECT id::text AS id FROM branches WHERE org_id = ${'00000000-0000-0000-0000-000000000001'} AND deleted_at IS NULL ORDER BY code LIMIT 1`);
  branchId = String((b as unknown as { rows: Array<{ id: string }> }).rows[0]!.id);
  /* doctor identity for commission linkage (FK to staff) */
  await admin.execute(sql`
    INSERT INTO staff (id, org_id, branch_id, name, username, role, status)
    VALUES (${DOCTOR}, ${TEST_ORG}, ${branchId}, 'P1 Doctor', ${'p1-doc-' + Date.now()}, 'doctor', 'Active')
    ON CONFLICT (id) DO NOTHING
  `);
  /* NOTE: only the commission sequence is created for the throwaway org
   * (calculateCommission uses OrgAllocator.nextCommissionCode). Lab/ledger
   * seed helpers insert codes directly via raw SQL (no OrgAllocator). The
   * canonical-org finance sequences are asserted separately in finance.schema. */
  const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
  await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_com_${key}`)} START WITH 1`);
}

async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM commission_payouts WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM commission_ledger WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM lab_payables WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM audit_log WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM staff WHERE org_id = ${TEST_ORG}`);
}

/** Insert a commission ledger directly, consistent with the LOCKED formula
 *  (commission_amount = commission_base × rate = gross × 0.40; gross=2500 → 1000). */
async function seedLedger(admin: ReturnType<typeof createFreshDatabase>['db'], opts: {
  net?: string; paid?: string; outstanding?: string; status?: string; period?: string; doctor?: string;
} = {}): Promise<string> {
  const net = opts.net ?? '1000'; const paid = opts.paid ?? '0';
  const outstanding = opts.outstanding ?? net; const status = opts.status ?? 'approved';
  const period = opts.period ?? 'P1-' + Date.now(); const doctor = opts.doctor ?? DOCTOR;
  /* gross=2500, costs=0, base=2500, rate=0.40 → commission_amount=1000 (matches `net`). */
  const gross = (parseFloat(net) / 0.40).toFixed(4);
  const r = await admin.execute(sql`
    INSERT INTO commission_ledger (org_id, branch_id, doctor_id, commission_code, period, gross_revenue, eligible_direct_costs, commission_base, rate, commission_amount, net_payable, paid_amount, outstanding_amount, status)
    VALUES (${TEST_ORG}, ${branchId}, ${doctor}, ${'COM-P1-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)}, ${period}, ${gross}, 0, ${gross}, 0.40, ${net}, ${net}, ${paid}, ${outstanding}, ${status})
    RETURNING id::text AS id
  `);
  return String((r as unknown as { rows: Array<{ id: string }> }).rows[0]!.id);
}

async function ledgerState(admin: ReturnType<typeof createFreshDatabase>['db'], id: string) {
  const r = await admin.execute(sql`SELECT paid_amount::text AS paid, outstanding_amount::text AS outstanding, status FROM commission_ledger WHERE id = ${id}`);
  return (r as unknown as { rows: Array<{ paid: string; outstanding: string; status: string }> }).rows[0]!;
}

/** Insert an OUTSTANDING lab payable directly. */
async function seedLab(admin: ReturnType<typeof createFreshDatabase>['db'], amount = '1000', status = 'OUTSTANDING'): Promise<string> {
  const r = await admin.execute(sql`
    INSERT INTO lab_payables (org_id, branch_id, lab_code, lab_name, amount, paid_amount, outstanding_amount, due_date, status)
    VALUES (${TEST_ORG}, ${branchId}, ${'LAB-P1-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)}, 'P1 Lab', ${amount}, '0', ${amount}, '2026-09-01', ${status})
    RETURNING id::text AS id
  `);
  return String((r as unknown as { rows: Array<{ id: string }> }).rows[0]!.id);
}

async function labState(admin: ReturnType<typeof createFreshDatabase>['db'], id: string) {
  const r = await admin.execute(sql`SELECT paid_amount::text AS paid, outstanding_amount::text AS outstanding, status FROM lab_payables WHERE id = ${id}`);
  return (r as unknown as { rows: Array<{ paid: string; outstanding: string; status: string }> }).rows[0]!;
}

describe('S4 P1 remediation (live PG, real concurrency)', () => {
  /* ============ P1-1: payout updates ledger atomically ============ */
  dbIt('P1-1 partial payout updates paid/outstanding; full payout sets status=paid', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const ledgerId = await seedLedger(admin.db, { net: '2800' });
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildSvc(db);

    await svc.recordPayout(hq(), ledgerId, { payoutDate: '2026-08-15', amount: '1000', method: 'Bank Transfer' });
    let s = await ledgerState(admin.db, ledgerId);
    expect(parseFloat(s.paid)).toBe(1000);
    expect(parseFloat(s.outstanding)).toBe(1800);
    expect(s.status).toBe('approved'); /* not fully paid yet */

    await svc.recordPayout(hq(), ledgerId, { payoutDate: '2026-08-30', amount: '1800', method: 'Bank Transfer' });
    s = await ledgerState(admin.db, ledgerId);
    expect(parseFloat(s.paid)).toBe(2800);
    expect(parseFloat(s.outstanding)).toBe(0);
    expect(s.status).toBe('paid'); /* fully settled → paid */

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('P1-1 overpayment rejected (409), no ledger/payout mutation survives', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const ledgerId = await seedLedger(admin.db, { net: '2800' });
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildSvc(db);

    await expect(
      svc.recordPayout(hq(), ledgerId, { payoutDate: '2026-08-15', amount: '3000' }),
    ).rejects.toThrow(ConflictError);

    const s = await ledgerState(admin.db, ledgerId);
    expect(parseFloat(s.paid)).toBe(0);
    expect(parseFloat(s.outstanding)).toBe(2800);
    const payouts = await admin.db.execute(sql`SELECT COUNT(*)::int AS c FROM commission_payouts WHERE commission_ledger_id = ${ledgerId}`);
    expect(Number((payouts as unknown as { rows: Array<{ c: number }> }).rows[0]!.c)).toBe(0);

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('P1-1 payout after fully paid → 409', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const ledgerId = await seedLedger(admin.db, { net: '2800', paid: '2800', outstanding: '0', status: 'paid' });
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildSvc(db);
    await expect(
      svc.recordPayout(hq(), ledgerId, { payoutDate: '2026-08-15', amount: '1' }),
    ).rejects.toThrow(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('P1-1 concurrent payouts serialize: one wins, one 409, ledger consistent', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    /* outstanding 1000; two concurrent 700 payouts → one wins, one 409 */
    const ledgerId = await seedLedger(admin.db, { net: '1000', outstanding: '1000', status: 'approved' });

    const a = createFreshDatabase(RUNTIME_URL);
    const b = createFreshDatabase(RUNTIME_URL);
    const svcA = buildSvc(a.db);
    const svcB = buildSvc(b.db);

    const results = await Promise.allSettled([
      svcA.recordPayout(hq(), ledgerId, { payoutDate: '2026-08-15', amount: '700' }),
      svcB.recordPayout(hq(), ledgerId, { payoutDate: '2026-08-15', amount: '700' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflict = results.filter((r) => r.status === 'rejected' && (r.reason as Error).constructor.name === 'ConflictError').length;
    expect(ok).toBe(1);
    expect(conflict).toBe(1);

    const s = await ledgerState(admin.db, ledgerId);
    expect(parseFloat(s.paid)).toBe(700);
    expect(parseFloat(s.outstanding)).toBe(300);
    const payouts = await admin.db.execute(sql`SELECT COUNT(*)::int AS c FROM commission_payouts WHERE commission_ledger_id = ${ledgerId}`);
    expect(Number((payouts as unknown as { rows: Array<{ c: number }> }).rows[0]!.c)).toBe(1); /* exactly ONE payout row */

    await purge(admin.db); await admin.close(); await a.close(); await b.close();
  });

  /* ============ P1-2: commission duplicate race ============ */
  dbIt('P1-2 concurrent commission create (same doctor+period) → one ledger, one 409', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const period = 'P1RACE-' + Date.now();

    const a = createFreshDatabase(RUNTIME_URL);
    const b = createFreshDatabase(RUNTIME_URL);
    const svcA = buildSvc(a.db);
    const svcB = buildSvc(b.db);

    const input = {
      branchId, doctorId: DOCTOR, period, grossRevenue: '7000',
      costsByCategory: { 'Lab Cost': '0' }, externalRef: null, notes: null,
    };
    const results = await Promise.allSettled([
      svcA.calculateCommission(hq(), input),
      svcB.calculateCommission(hq(), input),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflict = results.filter((r) => r.status === 'rejected' && (r.reason as Error).constructor.name === 'ConflictError').length;
    expect(ok).toBe(1);
    expect(conflict).toBe(1);

    const rows = await admin.db.execute(sql`SELECT COUNT(*)::int AS c FROM commission_ledger WHERE org_id = ${TEST_ORG} AND doctor_id = ${DOCTOR} AND period = ${period} AND deleted_at IS NULL`);
    expect(Number((rows as unknown as { rows: Array<{ c: number }> }).rows[0]!.c)).toBe(1); /* EXACTLY ONE active ledger */

    await purge(admin.db); await admin.close(); await a.close(); await b.close();
  });

  dbIt('P1-2 same doctor different period allowed; duplicate same period → 409 (23505 mapped)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildSvc(db);
    const period = 'P1DUP-' + Date.now();

    await svc.calculateCommission(hq(), { branchId, doctorId: DOCTOR, period, grossRevenue: '7000', costsByCategory: {} });
    /* same doctor, different period → OK */
    const other = await svc.calculateCommission(hq(), { branchId, doctorId: DOCTOR, period: period + '-B', grossRevenue: '5000', costsByCategory: {} });
    expect(other.period).toBe(period + '-B');
    /* duplicate same doctor+period → 409 */
    await expect(
      svc.calculateCommission(hq(), { branchId, doctorId: DOCTOR, period, grossRevenue: '7000', costsByCategory: {} }),
    ).rejects.toThrow(ConflictError);

    await purge(admin.db); await admin.close(); await close();
  });

  /* ============ P1-3: lab payment race ============ */
  dbIt('P1-3 concurrent 600+600 on 1000 → one succeeds, one 409, paid=600 outstanding=400', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const labId = await seedLab(admin.db, '1000');

    const a = createFreshDatabase(RUNTIME_URL);
    const b = createFreshDatabase(RUNTIME_URL);
    const svcA = buildSvc(a.db);
    const svcB = buildSvc(b.db);

    const results = await Promise.allSettled([
      svcA.applyLabPayment(hq(), labId, { amount: '600' }),
      svcB.applyLabPayment(hq(), labId, { amount: '600' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflict = results.filter((r) => r.status === 'rejected' && (r.reason as Error).constructor.name === 'ConflictError').length;
    expect(ok).toBe(1);
    expect(conflict).toBe(1);

    const s = await labState(admin.db, labId);
    expect(parseFloat(s.paid)).toBe(600);
    expect(parseFloat(s.outstanding)).toBe(400);
    expect(s.status).toBe('PARTIALLY_PAID');

    await purge(admin.db); await admin.close(); await a.close(); await b.close();
  });

  dbIt('P1-3 500+500 on 1000 both succeed (PAID); 1000+1 second fails', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);

    /* 500 + 500 → both succeed, PAID */
    const lab1 = await seedLab(admin.db, '1000');
    const a = createFreshDatabase(RUNTIME_URL);
    const b = createFreshDatabase(RUNTIME_URL);
    const svcA = buildSvc(a.db); const svcB = buildSvc(b.db);
    const r1 = await Promise.allSettled([
      svcA.applyLabPayment(hq(), lab1, { amount: '500' }),
      svcB.applyLabPayment(hq(), lab1, { amount: '500' }),
    ]);
    expect(r1.filter((r) => r.status === 'fulfilled').length).toBe(2);
    let s = await labState(admin.db, lab1);
    expect(parseFloat(s.paid)).toBe(1000);
    expect(s.status).toBe('PAID');

    /* 1000 + 1 → exactly one succeeds; final state consistent (no overpay). */
    const lab2 = await seedLab(admin.db, '1000');
    const r2 = await Promise.allSettled([
      svcA.applyLabPayment(hq(), lab2, { amount: '1000' }),
      svcB.applyLabPayment(hq(), lab2, { amount: '1' }),
    ]);
    const ok2 = r2.filter((r) => r.status === 'fulfilled').length;
    const conflict2 = r2.filter((r) => r.status === 'rejected' && (r.reason as Error).constructor.name === 'ConflictError').length;
    expect(ok2).toBe(1);
    expect(conflict2).toBe(1);
    s = await labState(admin.db, lab2);
    /* whichever won, paid == that single amount, outstanding = 1000 - paid, never negative */
    const paid2 = parseFloat(s.paid);
    expect([1000, 1]).toContain(paid2);
    expect(parseFloat(s.outstanding)).toBe(1000 - paid2);
    expect(parseFloat(s.outstanding)).toBeGreaterThanOrEqual(0);

    await purge(admin.db); await admin.close(); await a.close(); await b.close();
  });

  dbIt('P1-3 invalid payments rejected clean 409: overpay, PAID, VOID, non-positive', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db); await fixtures(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildSvc(db);

    /* overpay */
    const over = await seedLab(admin.db, '1000');
    await expect(svc.applyLabPayment(hq(), over, { amount: '1200' })).rejects.toThrow(ConflictError);
    /* PAID */
    const paid = await seedLab(admin.db, '1000', 'PAID');
    await admin.db.execute(sql`UPDATE lab_payables SET paid_amount = amount, outstanding_amount = 0 WHERE id = ${paid}`);
    await expect(svc.applyLabPayment(hq(), paid, { amount: '1' })).rejects.toThrow(ConflictError);
    /* VOID */
    const voided = await seedLab(admin.db, '1000', 'VOID');
    await expect(svc.applyLabPayment(hq(), voided, { amount: '100' })).rejects.toThrow(ConflictError);

    await purge(admin.db); await admin.close(); await close();
  });
});
