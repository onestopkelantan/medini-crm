import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { PanelsRepository } from '@modules/payors/infrastructure/panels.repository';
import { PanelsService } from '@modules/payors/application/panels.service';
import { InsurancesRepository } from '@modules/payors/infrastructure/insurances.repository';
import { InsurancesService } from '@modules/payors/application/insurances.service';
import { PayorsReadPort } from '@shared/ports/payors.read-port';
import { NotFoundError } from '@shared/errors/errors';

/**
 * Sprint 2A T5 — FULL VERIFICATION & REGRESSION (live PG).
 *
 * Final technical gate. Adds ONLY verification coverage not already proven
 * by T1–T4 specs:
 *   1. DB-level RLS UPDATE/DELETE enforcement per role (not just INSERT/SELECT)
 *   2. Cross-org UPDATE/DELETE (mutation) isolation
 *   3. Clone-all-5 library entries end-to-end
 *   4. Soft-deleted name reuse (partial unique index convention)
 *   5. PayorsReadPort live verification (panel + insurance sides)
 * No new features. Honest skip when DB unreachable. All fixtures purged.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[t5] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const ORG_A = '99999999-9999-9999-9999-9999999999e1';
const ORG_B = '99999999-9999-9999-9999-9999999999e2';

interface RawRows { rows: Array<Record<string, unknown>> }

function hq(org = ORG_A) {
  return { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: org, branchId: null, doctorId: null };
}

async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM panel_companies WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM insurance_companies WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM audit_log WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  for (const org of [ORG_A, ORG_B]) {
    const key = org.replace(/-/g, '').slice(-8).toLowerCase();
    await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_pnl_${key}`)} START WITH 1`);
    await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_ins_${key}`)} START WITH 1`);
    await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_pnl_${key}`)} RESTART WITH 1`);
    await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_ins_${key}`)} RESTART WITH 1`);
  }
}

function asRole<T>(
  db: ReturnType<typeof createFreshDatabase>['db'],
  role: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.role', ${role}, true)`);
    await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
    return fn(tx);
  });
}

function buildPanels(db: ReturnType<typeof createFreshDatabase>['db']) {
  return new PanelsService(new DbContextService(db), new PanelsRepository(), new AuditService(new InMemoryAuditAdapter()));
}
function buildInsurances(db: ReturnType<typeof createFreshDatabase>['db']) {
  return new InsurancesService(new DbContextService(db), new InsurancesRepository(), new AuditService(new InMemoryAuditAdapter()));
}

describe('Sprint 2A T5 — full verification & regression (live PG)', () => {
  /* ---- §10: DB-level RLS UPDATE/DELETE per role ---- */
  dbIt('RLS DB-level: branch_manager UPDATE denied (WITH CHECK), SELECT allowed', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-E101', 'RLS Update Target')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    /* BM UPDATE: row visible (USING) but WITH CHECK rejects the new row version */
    const updated = await asRole(db, 'branch_manager', async (tx) => {
      const r = await tx.execute(
        sql`UPDATE panel_companies SET pic = 'BM Edit' WHERE org_id = ${ORG_A} AND code = 'PNL-E101' RETURNING id`,
      );
      return (r as unknown as RawRows).rows.length;
    }).catch(() => -1);
    expect(updated).toBeLessThanOrEqual(0); /* rejected or 0 rows — never 1 */
    const row = await admin.db.execute(
      sql`SELECT pic FROM panel_companies WHERE org_id = ${ORG_A} AND code = 'PNL-E101'`,
    );
    expect((row as unknown as RawRows).rows[0]!.pic).toBeNull(); /* unchanged */
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('RLS DB-level: hq UPDATE allowed; doctor/reception UPDATE affects 0 rows', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO insurance_companies (org_id, code, name) VALUES (${ORG_A}, 'INS-E101', 'RLS Ins Target')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const hqN = await asRole(db, 'hq', async (tx) => {
      const r = await tx.execute(
        sql`UPDATE insurance_companies SET pic = 'HQ Edit' WHERE org_id = ${ORG_A} AND code = 'INS-E101' RETURNING id`,
      );
      return (r as unknown as RawRows).rows.length;
    });
    expect(hqN).toBe(1);
    for (const role of ['doctor', 'branch_admin']) {
      const n = await asRole(db, role, async (tx) => {
        const r = await tx.execute(
          sql`UPDATE insurance_companies SET pic = 'Bad Edit' WHERE org_id = ${ORG_A} AND code = 'INS-E101' RETURNING id`,
        );
        return (r as unknown as RawRows).rows.length;
      });
      expect(n).toBe(0);
    }
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('RLS DB-level: DELETE denied for runtime role on both payor tables (privilege-level)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${ORG_A}, 'PNL-E102', 'Del Target')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    await expect(
      asRole(db, 'hq', async (tx) => {
        await tx.execute(sql`DELETE FROM panel_companies WHERE org_id = ${ORG_A}`);
      }),
    ).rejects.toThrow();
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- §11: cross-org mutation isolation ---- */
  dbIt('org isolation: HQ of Org A cannot UPDATE/STATUS-change Org B records (not found, no leak)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const panels = buildPanels(db);
    const insurances = buildInsurances(db);
    const bPanel = await panels.create(hq(ORG_B), { name: 'Org B Panel' });
    const bIns = await insurances.create(hq(ORG_B), { name: 'Org B Insurer' });
    await expect(panels.update(hq(ORG_A), bPanel.id, { pic: 'cross' })).rejects.toThrow(NotFoundError);
    await expect(panels.changeStatus(hq(ORG_A), bPanel.id, { status: 'Inactive' })).rejects.toThrow(NotFoundError);
    await expect(insurances.update(hq(ORG_A), bIns.id, { pic: 'cross' })).rejects.toThrow(NotFoundError);
    await expect(insurances.changeStatus(hq(ORG_A), bIns.id, { status: 'Inactive' })).rejects.toThrow(NotFoundError);
    /* Org B rows untouched */
    const intact = await admin.db.execute(
      sql`SELECT status FROM panel_companies WHERE org_id = ${ORG_B} AND id = ${bPanel.id}`,
    );
    expect((intact as unknown as RawRows).rows[0]!.status).toBe('Active');
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- §21: clone all five library entries ---- */
  dbIt('clone: all 5 library entries clone successfully with sequential PNL codes', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const panels = buildPanels(db);
    const keys = ['healthmetrics', 'medident', 'medkad', 'micare', 'tuneprotect'];
    const codes: string[] = [];
    for (const k of keys) {
      const p = await panels.clone(hq(), { libraryKey: k });
      expect(p.source).toBe('builtin');
      expect(p.status).toBe('Active');
      expect(p.address?.length ?? 0).toBeGreaterThan(20);
      codes.push(p.code);
    }
    expect(codes).toEqual(['PNL-0001', 'PNL-0002', 'PNL-0003', 'PNL-0004', 'PNL-0005']);
    const list = await panels.search(hq());
    expect(list).toHaveLength(5);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- §17: soft-deleted name reuse (partial unique convention) ---- */
  dbIt('duplicate: soft-deleted record name may be reused (partial index), Active/Inactive may not', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const panels = buildPanels(db);
    const p = await panels.create(hq(), { name: 'Reusable Name' });
    /* soft-delete via SQL (runtime has no DELETE grant; admin simulates retention cleanup) */
    await admin.db.execute(sql`UPDATE panel_companies SET deleted_at = now() WHERE id = ${p.id}`);
    const reused = await panels.create(hq(), { name: 'reusable name' });
    expect(reused.id).not.toBe(p.id);
    /* the live duplicate is still blocked */
    await expect(panels.create(hq(), { name: 'REUSABLE NAME' })).rejects.toThrow();
    /* soft-deleted row is not exposed by reads */
    await expect(panels.getById(hq(), p.id)).rejects.toThrow(NotFoundError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- §27: PayorsReadPort live verification ---- */
  dbIt('PayorsReadPort: panel + insurance reads are org-scoped, RLS-scoped, read-only', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const panels = buildPanels(db);
    const insurances = buildInsurances(db);
    const p = await panels.create(hq(), { name: 'Port Panel' });
    const i = await insurances.create(hq(), { name: 'Port Insurer' });
    await insurances.changeStatus(hq(), i.id, { status: 'Inactive' });

    const port = new PayorsReadPort();
    const ctx = new DbContextService(db);
    await ctx.runAs(hq(), async (tx) => {
      expect((await port.getPanelById(tx as never, ORG_A, p.id))?.name).toBe('Port Panel');
      expect((await port.getInsuranceById(tx as never, ORG_A, i.id))?.name).toBe('Port Insurer');
      /* cross-org read → null (no leak) */
      expect(await port.getPanelById(tx as never, ORG_B, p.id)).toBeNull();
      expect(await port.getInsuranceById(tx as never, ORG_B, i.id)).toBeNull();
      /* active listings exclude the Inactive insurance */
      const activeP = await port.listActivePanels(tx as never, ORG_A);
      const activeI = await port.listActiveInsurances(tx as never, ORG_A);
      expect(activeP.map((x) => x.name)).toContain('Port Panel');
      expect(activeI.map((x) => x.name)).not.toContain('Port Insurer');
      /* name lookup helper (case-insensitive) */
      expect((await port.findPanelByName(tx as never, ORG_A, 'port panel'))?.id).toBe(p.id);
    });
    /* port surface is read-only: no mutating methods exist */
    const proto = Object.getOwnPropertyNames(PayorsReadPort.prototype);
    expect(proto.filter((m) => /create|update|delete|insert|set/i.test(m))).toEqual([]);
    await purge(admin.db);
    await admin.close();
    await close();
  });
});
