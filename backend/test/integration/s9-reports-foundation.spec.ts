import { describe, it, expect } from 'vitest';

import { sql } from 'drizzle-orm';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { FinanceReadPort } from '@shared/ports/finance.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { ClinicalReadPort } from '@shared/ports/clinical.read-port';
import { RecallReadPort } from '@shared/ports/recall.read-port';
import {
  resolvePeriod, isReportPeriod,
} from '@modules/reports/domain/period-resolver';
import { resolveReportScope } from '@modules/reports/domain/reports-scope';
import {
  noShowRate, recallRate, revenuePerAppointment, chairUtilisation,
} from '@modules/reports/domain/kpi-formulas';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[s9-foundation] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

/* S9 unique orgs — never collide with other suites (S8 lesson). */
const ORG_A = '99999999-9999-9999-9999-999999999a01';
const ORG_B = '99999999-9999-9999-9999-999999999a02';

type Db = ReturnType<typeof createFreshDatabase>['db'];

async function purge(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM report_audit WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM kpi_definitions WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM treatment_plan_items WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM treatment_plans WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM treatment_catalog WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM recall_cases WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM appointments WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM sale_records WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM patients WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`DELETE FROM staff WHERE id IN ('90d1f1a1-0000-4000-8000-000000000001')`);
}

/* ------------------------------------------------------------------ */
/* Pure domain (no DB) — plain it() per skill convention                */
/* ------------------------------------------------------------------ */

describe('S9 reports domain — pure functions', () => {
  const NOW = new Date(2026, 7, 18, 15, 30); // 18 Aug 2026, 15:30 local

  it('period-resolver: 7D/30D/90D/12M inclusive ranges ending today', () => {
    expect(resolvePeriod('7D', NOW)).toEqual({ from: '2026-08-12', to: '2026-08-18' });
    expect(resolvePeriod('30D', NOW)).toEqual({ from: '2026-07-20', to: '2026-08-18' });
    expect(resolvePeriod('90D', NOW)).toEqual({ from: '2026-05-21', to: '2026-08-18' });
    expect(resolvePeriod('12M', NOW)).toEqual({ from: '2025-08-19', to: '2026-08-18' });
  });

  it('period-resolver: guards invalid input', () => {
    expect(isReportPeriod('7D')).toBe(true);
    expect(isReportPeriod('12M')).toBe(true);
    expect(isReportPeriod('1Y')).toBe(false);
    expect(isReportPeriod('')).toBe(false);
    expect(isReportPeriod(undefined)).toBe(false);
    expect(isReportPeriod(7)).toBe(false);
  });

  it('reports-scope: hq org-wide; manager own branch; others denied', () => {
    expect(resolveReportScope({ role: 'hq', branchId: null })).toEqual({ type: 'org' });
    expect(resolveReportScope({ role: 'branch_manager', branchId: 'b-1' }))
      .toEqual({ type: 'branch', branchId: 'b-1' });
    // fail closed when manager has no branch assignment
    expect(resolveReportScope({ role: 'branch_manager', branchId: null }).type).toBe('denied');
    // Q1: doctor + receptionist blocked from reports
    expect(resolveReportScope({ role: 'doctor', branchId: 'b-1' }).type).toBe('denied');
    expect(resolveReportScope({ role: 'receptionist', branchId: 'b-1' }).type).toBe('denied');
    expect(resolveReportScope({ role: 'branch_admin', branchId: 'b-1' }).type).toBe('denied');
    expect(resolveReportScope({ role: 'system_worker', branchId: null }).type).toBe('denied');
  });

  it('kpi-formulas: rates + honest divide-by-zero', () => {
    expect(noShowRate(1, 9)).toEqual({ available: true, value: '10.0' });
    expect(noShowRate(0, 0).available).toBe(false);
    expect(recallRate(3, 1, 0)).toEqual({ available: true, value: '75.0' });
    expect(recallRate(0, 0, 0).available).toBe(false);
    expect(revenuePerAppointment('1000.00', 4)).toEqual({ available: true, value: '250.00' });
    expect(revenuePerAppointment('1000.00', 0).available).toBe(false);
    expect(chairUtilisation().available).toBe(false); // Q2: never fabricated
  });
});

/* ------------------------------------------------------------------ */
/* Integration (live PG)                                                */
/* ------------------------------------------------------------------ */

describe('S9 reports foundation — integration (live PG)', () => {
  dbIt('migration 0024: tables, indexes, seed, RLS flags present', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const tables = await admin.db.execute(sql`
      SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS force
      FROM pg_class WHERE relname IN ('kpi_definitions','report_audit') ORDER BY relname`);
    const rows = (tables as unknown as { rows: Array<{ relname: string; rls: boolean; force: boolean }> }).rows;
    expect(rows).toEqual([
      { relname: 'kpi_definitions', rls: true, force: true },
      { relname: 'report_audit', rls: true, force: true },
    ]);
    const idx = await admin.db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('kpi_definitions','report_audit') ORDER BY indexname`);
    const names = (idx as unknown as { rows: Array<{ indexname: string }> }).rows.map((r) => r.indexname);
    expect(names).toContain('kpi_definitions_org_key_version_uq');
    expect(names).toContain('report_audit_org_created_idx');
    const seed = await admin.db.execute(sql`
      SELECT kpi_key FROM kpi_definitions
      WHERE org_id = '00000000-0000-0000-0000-000000000001' ORDER BY kpi_key`);
    expect((seed as unknown as { rows: Array<{ kpi_key: string }> }).rows.map((r) => r.kpi_key))
      .toEqual(['no_show_rate', 'recall_rate', 'revenue', 'revenue_per_appointment']);
    await admin.close();
  });

  dbIt('RLS: org isolation — org A cannot read/write org B rows (both directions)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    /* seed KPI row for org B (admin path bypasses RLS) */
    await admin.db.execute(sql`
      INSERT INTO kpi_definitions (org_id, kpi_key, name, formula, source_domain, unit, scope_rules)
      VALUES (${ORG_B}, 'revenue', 'Revenue', 'f', 'finance', 'MYR', '{"hq":"all"}'::jsonb)`);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    /* single raw connection: session GUCs stay on one socket (S8 lesson) */
    const client = await (db as unknown as {
      $client: { connect(): Promise<{ query(q: string, p?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>; release(): void }> };
    }).$client.connect();
    try {
      /* --- as org A hq: must NOT see org B row --- */
      await client.query(`SELECT set_config('app.role','hq',false)`);
      await client.query(`SELECT set_config('app.org_id',$1,false)`, [ORG_A]);
      const read = await client.query(`SELECT count(*)::int AS n FROM kpi_definitions WHERE org_id = $1`, [ORG_B]);
      expect(read.rows[0]!.n).toBe(0); // RESTRICTIVE org isolation

      /* --- insert as org A hq into org A: allowed (hq permissive) --- */
      await client.query(
        `INSERT INTO kpi_definitions (org_id, kpi_key, name, formula, source_domain, unit, scope_rules)
         VALUES ($1,'test_kpi','T','f','finance','count','{}'::jsonb)`, [ORG_A]);
      const ownRead = await client.query(`SELECT count(*)::int AS n FROM kpi_definitions WHERE kpi_key='test_kpi'`);
      expect(ownRead.rows[0]!.n).toBe(1);

      /* --- branch_manager cannot INSERT (hq-only) --- */
      await client.query(`SELECT set_config('app.role','branch_manager',false)`);
      let denied = false;
      try {
        await client.query(
          `INSERT INTO kpi_definitions (org_id, kpi_key, name, formula, source_domain, unit, scope_rules)
           VALUES ($1,'bm_kpi','T','f','finance','count','{}'::jsonb)`, [ORG_A]);
      } catch { denied = true; }
      expect(denied).toBe(true);

      /* --- DELETE has no permissive → denied even for hq ---
       * Accept BOTH denial mechanisms (S8 lesson): GRANT error (42501) OR
       * RLS silently affecting 0 rows. */
      await client.query(`SELECT set_config('app.role','hq',false)`);
      let delDenied = false;
      try {
        const del = await client.query(`DELETE FROM kpi_definitions WHERE kpi_key='test_kpi' AND org_id=$1`, [ORG_A]);
        if ((del.rowCount ?? 0) === 0) delDenied = true;
      } catch { delDenied = true; }
      expect(delDenied).toBe(true);
    } finally {
      client.release();
    }
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('RLS: report_audit append-only — INSERT ok, UPDATE/DELETE blocked', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const client = await (db as unknown as {
      $client: { connect(): Promise<{ query(q: string, p?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>; release(): void }> };
    }).$client.connect();
    try {
      await client.query(`SELECT set_config('app.role','branch_manager',false)`);
      await client.query(`SELECT set_config('app.org_id',$1,false)`, [ORG_A]);
      await client.query(
        `INSERT INTO report_audit (org_id, actor_id, actor_role, action, view, filter, correlation_id)
         VALUES ($1, gen_random_uuid(), 'branch_manager', 'view_opened', 'kpis', '{"period":"30D"}'::jsonb, 'corr-t1')`,
        [ORG_A]);
      /* append-only: UPDATE/DELETE denied — BOTH mechanisms accepted
       * (42501 no-grant OR RLS 0-rows) + unchanged-proof via admin */
      let updDenied = false;
      try {
        const upd = await client.query(`UPDATE report_audit SET view='x' WHERE org_id=$1 AND correlation_id='corr-t1'`, [ORG_A]);
        if ((upd.rowCount ?? 0) === 0) updDenied = true;
      } catch { updDenied = true; }
      expect(updDenied).toBe(true);
      let delDenied = false;
      try {
        const del = await client.query(`DELETE FROM report_audit WHERE org_id=$1 AND correlation_id='corr-t1'`, [ORG_A]);
        if ((del.rowCount ?? 0) === 0) delDenied = true;
      } catch { delDenied = true; }
      expect(delDenied).toBe(true);
      /* branch_manager cannot SELECT audit (hq only) */
      const sel = await client.query(`SELECT count(*)::int AS n FROM report_audit WHERE org_id=$1`, [ORG_A]);
      expect(sel.rows[0]!.n).toBe(0);
      /* hq CAN select */
      await client.query(`SELECT set_config('app.role','hq',false)`);
      const hqSel = await client.query(`SELECT count(*)::int AS n FROM report_audit WHERE org_id=$1`, [ORG_A]);
      expect(hqSel.rows[0]!.n).toBe(1);
    } finally {
      client.release();
    }
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('read ports: aggregates match direct SQL (canonical truth)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bRows = await admin.db.execute(sql`SELECT id::text AS id FROM branches LIMIT 2`);
    const bIds = (bRows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    const b1 = bIds[0]!;
    const b2 = bIds[1] ?? bIds[0]!;

    /* seed: 2 confirmed sales b1 (100, 250), 1 confirmed b2 (500), 1 recorded b1 (ignored) */
    await admin.db.execute(sql`
      INSERT INTO sale_records (org_id, branch_id, sale_code, amount, sale_date, status) VALUES
      (${ORG_A}, ${b1}, 'S9-A1', 100, '2026-08-10', 'confirmed'),
      (${ORG_A}, ${b1}, 'S9-A2', 250, '2026-08-11', 'confirmed'),
      (${ORG_A}, ${b2}, 'S9-A3', 500, '2026-08-11', 'confirmed'),
      (${ORG_A}, ${b1}, 'S9-A4', 999, '2026-08-12', 'recorded')`);
    /* appointments: b1 → 3 completed + 1 no-show; b2 → 1 completed */
    await admin.db.execute(sql`
      INSERT INTO appointments (org_id, branch_id, code, patient_name, scheduled_date, scheduled_time, status) VALUES
      (${ORG_A}, ${b1}, 'S9-APT1', 'P1', '2026-08-10', '09:00', 'completed'),
      (${ORG_A}, ${b1}, 'S9-APT2', 'P2', '2026-08-10', '10:00', 'completed'),
      (${ORG_A}, ${b1}, 'S9-APT3', 'P3', '2026-08-11', '11:00', 'completed'),
      (${ORG_A}, ${b1}, 'S9-APT4', 'P4', '2026-08-11', '12:00', 'no-show'),
      (${ORG_A}, ${b2}, 'S9-APT5', 'P5', '2026-08-12', '09:00', 'completed')`);
    /* recall: 1 completed + 1 open (due in window) */
    await admin.db.execute(sql`
      INSERT INTO patients (org_id, branch_id, mrn, name) VALUES
      (${ORG_A}, ${b1}, 'S9-MRN-1', 'Recall P1'), (${ORG_A}, ${b1}, 'S9-MRN-2', 'Recall P2')`);
    await admin.db.execute(sql`
      INSERT INTO recall_cases (org_id, branch_id, patient_id, due_date, status)
      SELECT ${ORG_A}, ${b1}, id, '2026-08-10', 'completed' FROM patients WHERE org_id=${ORG_A} AND mrn='S9-MRN-1'`);
    await admin.db.execute(sql`
      INSERT INTO recall_cases (org_id, branch_id, patient_id, due_date, status)
      SELECT ${ORG_A}, ${b1}, id, '2026-08-11', 'open' FROM patients WHERE org_id=${ORG_A} AND mrn='S9-MRN-2'`);
    /* treatment mix: 2 Restorative + 1 Surgery via plans/items/catalog */
    await admin.db.execute(sql`
      INSERT INTO treatment_catalog (org_id, code, name, category) VALUES
      (${ORG_A}, 'S9-T1', 'Filling', 'Restorative'), (${ORG_A}, 'S9-T2', 'Extraction', 'Surgery')`);
    /* treatment plans need a doctor (NOT NULL) — seed S9-namespaced staff */
    const DOC = '90d1f1a1-0000-4000-8000-000000000001';
    await admin.db.execute(sql`
      INSERT INTO staff (id, org_id, branch_id, name, username, role)
      VALUES (${DOC}, ${ORG_A}, ${b1}, '[s9] Dr KPI', 'doc_s9_kpi', 'doctor')
      ON CONFLICT DO NOTHING`);
    await admin.db.execute(sql`
      INSERT INTO treatment_plans (org_id, branch_id, patient_id, doctor_id, plan_code, title, status)
      SELECT ${ORG_A}, ${b1}, id, ${DOC}, 'S9-PLAN-1', 'Plan 1', 'active' FROM patients WHERE org_id=${ORG_A} AND mrn='S9-MRN-1'`);
    await admin.db.execute(sql`
      INSERT INTO treatment_plan_items (org_id, plan_id, treatment_id, description, quantity)
      SELECT p.org_id, p.id, c.id, 'item', 1
      FROM treatment_plans p
      JOIN treatment_catalog c ON c.org_id = p.org_id AND c.code = 'S9-T1'
      WHERE p.org_id=${ORG_A} AND p.plan_code='S9-PLAN-1'
      UNION ALL
      SELECT p.org_id, p.id, c.id, 'item', 1
      FROM treatment_plans p
      JOIN treatment_catalog c ON c.org_id = p.org_id AND c.code = 'S9-T1'
      WHERE p.org_id=${ORG_A} AND p.plan_code='S9-PLAN-1'
      UNION ALL
      SELECT p.org_id, p.id, c.id, 'item', 1
      FROM treatment_plans p
      JOIN treatment_catalog c ON c.org_id = p.org_id AND c.code = 'S9-T2'
      WHERE p.org_id=${ORG_A} AND p.plan_code='S9-PLAN-1'`);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const finance = new FinanceReadPort();
    const appts = new AppointmentsReadPort(db);
    const clinical = new ClinicalReadPort(db);
    const recall = new RecallReadPort(db);
    const hq = { staffId: 'x', username: 'hq', role: 'hq', orgId: ORG_A, branchId: null, doctorId: null };
    const mgr = { staffId: 'y', username: 'bm', role: 'branch_manager', orgId: ORG_A, branchId: b1, doctorId: null };
    const from = '2026-08-01'; const to = '2026-08-31';

    /* HQ org-wide */
    await dbCtx.runAs(hq, async (tx) => {
      expect(await finance.revenueTotal(tx as never, ORG_A, { from, to })).toBe('850.0000');
      const byBranch = await finance.revenueByBranch(tx as never, ORG_A, { from, to });
      expect(byBranch.find((r) => r.branchId === b1)?.revenue).toBe('350.0000');
      expect(byBranch.find((r) => r.branchId === b2)?.revenue).toBe('500.0000');
      const series = await finance.revenueDailySeries(tx as never, ORG_A, { from, to });
      expect(series.reduce((a, s) => a + Number(s.revenue), 0)).toBe(850);
      const daily = await appts.dailySeries(tx as never, ORG_A, null, from, to);
      expect(daily.filter((d) => d.status === 'completed').reduce((a, d) => a + d.n, 0)).toBe(4);
      expect(daily.filter((d) => d.status === 'no-show').reduce((a, d) => a + d.n, 0)).toBe(1);
      const rc = await recall.recallStats(tx as never, ORG_A, null, from, to);
      expect(rc).toEqual({ open: 1, completed: 1, cancelled: 0 });
      const mix = await clinical.treatmentMix(tx as never, ORG_A, null, from, to);
      expect(mix.find((m) => m.category === 'Restorative')?.count).toBe(2);
      expect(mix.find((m) => m.category === 'Surgery')?.count).toBe(1);
    });

    /* Manager branch scope: sees b1 only */
    await dbCtx.runAs(mgr, async (tx) => {
      expect(await finance.revenueTotal(tx as never, ORG_A, { branchId: b1, from, to })).toBe('350.0000');
      const byBranch = await finance.revenueByBranch(tx as never, ORG_A, { branchId: b1, from, to });
      expect(byBranch.length).toBe(1);
      const daily = await appts.dailySeries(tx as never, ORG_A, b1, from, to);
      expect(daily.filter((d) => d.status === 'completed').reduce((a, d) => a + d.n, 0)).toBe(3);
    });

    await purge(admin.db); await admin.close(); await close();
  });
});
