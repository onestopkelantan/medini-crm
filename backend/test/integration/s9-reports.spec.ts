import { describe, it, expect } from 'vitest';

import { sql } from 'drizzle-orm';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { ReportsService } from '@modules/reports/application/reports.service';
import { ReportAuditService } from '@modules/reports/application/report-audit.service';
import { ReportsRepository } from '@modules/reports/infrastructure/reports.repository';
import { FinanceReadPort } from '@shared/ports/finance.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { ClinicalReadPort } from '@shared/ports/clinical.read-port';
import { RecallReadPort } from '@shared/ports/recall.read-port';
import { ForbiddenError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[s9-reports] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

/* S9-T2 unique org (≠ T1's …a01/…a02). */
const ORG = '99999999-9999-9999-9999-999999999b01';

type Db = ReturnType<typeof createFreshDatabase>['db'];

async function purge(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM report_audit WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM recall_cases WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM appointments WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM sale_records WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM patients WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM staff WHERE org_id = ${ORG}`);
}

function makeService(db: Db) {
  const dbCtx = new DbContextService(db);
  const repo = new ReportsRepository();
  return new ReportsService(
    dbCtx, new FinanceReadPort(), new AppointmentsReadPort(db),
    new ClinicalReadPort(db), new RecallReadPort(db), repo, new ReportAuditService(dbCtx, repo),
  );
}

describe('S9 reports endpoints — integration (live PG)', () => {
  dbIt('kpis/trends/registry honor scope, canonical truth, and audit (hq vs manager)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bRows = await admin.db.execute(sql`SELECT id::text AS id FROM branches LIMIT 2`);
    const bIds = (bRows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    const b1 = bIds[0]!;
    const b2 = bIds[1] ?? bIds[0]!;

    /* seed: b1 → 100+250 confirmed, 3 completed + 1 no-show; b2 → 500, 1 completed */
    await admin.db.execute(sql`
      INSERT INTO sale_records (org_id, branch_id, sale_code, amount, sale_date, status) VALUES
      (${ORG}, ${b1}, 'S9B-1', 100, current_date - 2, 'confirmed'),
      (${ORG}, ${b1}, 'S9B-2', 250, current_date - 1, 'confirmed'),
      (${ORG}, ${b2}, 'S9B-3', 500, current_date - 1, 'confirmed')`);
    await admin.db.execute(sql`
      INSERT INTO staff (id, org_id, branch_id, name, username, role)
      VALUES ('90d1f1a2-0000-4000-8000-000000000001', ${ORG}, ${b1}, '[s9b] Dr One', 'doc_s9b_1', 'doctor')`);
    await admin.db.execute(sql`
      INSERT INTO appointments (org_id, branch_id, code, patient_name, doctor_id, scheduled_date, scheduled_time, status) VALUES
      (${ORG}, ${b1}, 'S9B-A1', 'P1', '90d1f1a2-0000-4000-8000-000000000001', current_date - 2, '09:00', 'completed'),
      (${ORG}, ${b1}, 'S9B-A2', 'P2', '90d1f1a2-0000-4000-8000-000000000001', current_date - 2, '10:00', 'completed'),
      (${ORG}, ${b1}, 'S9B-A3', 'P3', '90d1f1a2-0000-4000-8000-000000000001', current_date - 1, '11:00', 'completed'),
      (${ORG}, ${b1}, 'S9B-A4', 'P4', NULL, current_date - 1, '12:00', 'no-show'),
      (${ORG}, ${b2}, 'S9B-A5', 'P5', NULL, current_date, '09:00', 'completed')`);
    await admin.db.execute(sql`
      INSERT INTO patients (org_id, branch_id, mrn, name) VALUES (${ORG}, ${b1}, 'S9B-MRN-1', 'RP1')`);
    await admin.db.execute(sql`
      INSERT INTO recall_cases (org_id, branch_id, patient_id, due_date, status)
      SELECT ${ORG}, ${b1}, id, current_date - 1, 'completed' FROM patients WHERE org_id=${ORG} AND mrn='S9B-MRN-1'`);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = makeService(db);
    const hq = { staffId: '90d1f1a2-0000-4000-8000-000000000099', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null };
    const mgr = { staffId: '90d1f1a2-0000-4000-8000-000000000098', username: 'bm', role: 'branch_manager', orgId: ORG, branchId: b1, doctorId: null };

    /* --- HQ: org-wide KPIs (7D window covers seeded rows) --- */
    const hqKpis = await svc.kpis(hq, '7D');
    expect(hqKpis.scope).toEqual({ type: 'org' });
    const revCard = hqKpis.cards.find((c) => c.kpiKey === 'revenue')!;
    expect(Number(revCard.value)).toBe(850);
    const rpa = hqKpis.cards.find((c) => c.kpiKey === 'revenue_per_appointment')!;
    expect(rpa.available).toBe(true);
    expect(Number(rpa.value)).toBeCloseTo(850 / 4, 2);
    const ns = hqKpis.cards.find((c) => c.kpiKey === 'no_show_rate')!;
    expect(ns.available).toBe(true);
    expect(Number(ns.value)).toBeCloseTo(20.0, 1); /* 1 no-show / (4 completed + 1 no-show) */
    const rc = hqKpis.cards.find((c) => c.kpiKey === 'recall_rate')!;
    expect(Number(rc.value)).toBe(100);
    expect(hqKpis.cards.find((c) => c.kpiKey === 'chair_utilisation')!.available).toBe(false);

    /* --- Manager: branch scope only (b1 = 350, 3 completed, 1 no-show) --- */
    const mgrKpis = await svc.kpis(mgr, '7D');
    expect(mgrKpis.scope).toEqual({ type: 'branch', branchId: b1 });
    expect(Number(mgrKpis.cards.find((c) => c.kpiKey === 'revenue')!.value)).toBe(350);
    expect(Number(mgrKpis.cards.find((c) => c.kpiKey === 'no_show_rate')!.value)).toBeCloseTo(25.0, 1);

    /* --- Canonical truth: reports revenue ≡ FinanceReadPort revenue --- */
    const finance = new FinanceReadPort();
    const dbCtx = new DbContextService(db);
    await dbCtx.runAs(hq, async (tx) => {
      const direct = await finance.revenueTotal(tx as never, ORG, { from: hqKpis.from, to: hqKpis.to });
      expect(Number(direct)).toBe(Number(revCard.value));
    });

    /* --- revenue-by-branch: hq sees 2 rows; manager pinned to own branch --- */
    const hqBranches = await svc.revenueByBranch(hq, '7D');
    expect(hqBranches.rows.length).toBe(2);
    expect(hqBranches.rows[0]!.revenue).toBe('500.0000'); // sorted desc
    const mgrBranches = await svc.revenueByBranch(mgr, '7D');
    expect(mgrBranches.rows.length).toBe(1);
    expect(mgrBranches.rows[0]!.branchId).toBe(b1);

    /* --- appointment trends: completed/no-show per day --- */
    const trends = await svc.appointmentTrends(hq, '7D');
    expect(trends.series.reduce((a, s) => a + s.completed, 0)).toBe(4);
    expect(trends.series.reduce((a, s) => a + s.noShow, 0)).toBe(1);

    /* --- doctor production: only the seeded doctor, 3 completions --- */
    const prod = await svc.doctorProduction(hq, '7D');
    expect(prod.rows.length).toBe(1);
    expect(prod.rows[0]!.appointmentsCompleted).toBe(3);
    expect(prod.rows[0]!.name).toBe('[s9b] Dr One');

    /* --- KPI registry: org-scoped by RLS. The 4 canonical seeds live in the
     * Medini org (00000000-…-0001), NOT this test org — so the test org sees 0
     * (org isolation working as designed). Manager is 403 regardless. --- */
    const registry = await svc.kpiRegistry(hq);
    expect(registry.definitions.length).toBe(0); // test org has no definitions
    await expect(svc.kpiRegistry(mgr)).rejects.toBeInstanceOf(ForbiddenError);
    /* canonical seeds verified out-of-band (admin path bypasses RLS) */
    const seedRows = await admin.db.execute(sql`
      SELECT count(*)::int AS n FROM kpi_definitions
      WHERE org_id = '00000000-0000-0000-0000-000000000001' AND status = 'published'`);
    expect((seedRows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(4);

    /* --- denied roles: doctor / receptionist (Q1) --- */
    const doc = { staffId: '90d1f1a2-0000-4000-8000-000000000097', username: 'd', role: 'doctor', orgId: ORG, branchId: b1, doctorId: 'dr' };
    const rec = { staffId: '90d1f1a2-0000-4000-8000-000000000096', username: 'r', role: 'receptionist', orgId: ORG, branchId: b1, doctorId: null };
    await expect(svc.kpis(doc, '7D')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.kpis(rec, '7D')).rejects.toBeInstanceOf(ForbiddenError);

    /* --- invalid period rejected --- */
    await expect(svc.kpis(hq, '1Y')).rejects.toBeInstanceOf(ForbiddenError);

    /* --- audit: one row per view, correct actors/views, immutable fields --- */
    const auditRows = await admin.db.execute(sql`
      SELECT actor_role, view, action, filter FROM report_audit WHERE org_id = ${ORG} ORDER BY created_at`);
    const audits = (auditRows as unknown as { rows: Array<{ actor_role: string; view: string; action: string; filter: Record<string, unknown> | null }> }).rows;
    /* 7 views: hq{kpis, revenue_by_branch, appointment_trends, doctor_production,
     * kpi_registry} + manager{kpis, revenue_by_branch}. Denied requests
     * (doctor/receptionist/bad period/manager registry) throw BEFORE runAs → no audit. */
    expect(audits.length).toBe(7);
    const views = audits.map((a) => `${a.actor_role}:${a.view}`);
    expect(views).toContain('hq:kpis');
    expect(views).toContain('branch_manager:kpis');
    expect(views).toContain('hq:kpi_registry');
    expect(audits.every((a) => a.action === 'view_opened')).toBe(true);
    const kpiAudit = audits.find((a) => a.view === 'kpis' && a.actor_role === 'hq')!;
    expect(kpiAudit.filter).toEqual({ period: '7D' });

    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('empty org returns honest zeros / unavailable cards (no fabricated numbers)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = makeService(db);
    const hq = { staffId: '90d1f1a2-0000-4000-8000-000000000099', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null };

    const kpis = await svc.kpis(hq, '30D');
    expect(Number(kpis.cards.find((c) => c.kpiKey === 'revenue')!.value)).toBe(0);
    expect(kpis.cards.find((c) => c.kpiKey === 'revenue_per_appointment')!.available).toBe(false);
    expect(kpis.cards.find((c) => c.kpiKey === 'no_show_rate')!.available).toBe(false);
    expect(kpis.cards.find((c) => c.kpiKey === 'recall_rate')!.available).toBe(false);

    const mix = await svc.treatmentMix(hq, '30D');
    expect(mix.rows).toEqual([]);
    const trends = await svc.appointmentTrends(hq, '30D');
    expect(trends.series).toEqual([]);

    await purge(admin.db); await admin.close(); await close();
  });
});
