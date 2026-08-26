import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DashboardService } from '@modules/dashboard/application/dashboard.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { AppointmentsReadPort } from '@shared/ports/appointments.read-port';
import { DbContextService } from '@core/auth/db-context.service';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[dashboard] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-999999999980';

function principal(branchId: string, role = 'branch_manager') {
  return { staffId: 'x', username: 'bm', role, orgId: TEST_ORG, branchId, doctorId: null };
}

describe('dashboard module — integration (live PG)', () => {
  dbIt('context aggregates patient + appointment counts within branch scope', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    /* isolate: TEST_ORG data in an EXISTING canonical branch (no new branch
     * rows — avoids racing the seed-count test in database.spec) */
    await admin.db.execute(
      sql`DELETE FROM appointments WHERE org_id = ${TEST_ORG}`,
    );
    await admin.db.execute(
      sql`DELETE FROM patients WHERE org_id = ${TEST_ORG}`,
    );
    const bRows = await admin.db.execute(
      sql`SELECT id::text AS id FROM branches LIMIT 1`,
    );
    const bId = (bRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    const pRows = await admin.db.execute(
      sql`INSERT INTO patients (org_id, branch_id, mrn, name)
          VALUES (${TEST_ORG}, ${bId}, 'MDN-DASH1', 'Dash Patient')
          RETURNING id::text AS id`,
    );
    const pId = (pRows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    await admin.db.execute(
      sql`INSERT INTO appointments (org_id, branch_id, code, patient_id, patient_name,
                                    scheduled_date, scheduled_time, status)
          VALUES (${TEST_ORG}, ${bId}, 'APT-DASH1', ${pId}, 'Dash Patient',
                  '2026-09-10', '09:00', 'waiting'),
                 (${TEST_ORG}, ${bId}, 'APT-DASH2', ${pId}, 'Dash Patient',
                  '2026-09-10', '10:00', 'completed')`,
    );

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const service = new DashboardService(ctx, new PatientsReadPort(db), new AppointmentsReadPort(db));
    const result = await service.context(principal(bId), '2026-09-10');

    expect(result.branchId).toBe(bId);
    expect(result.patients.total).toBe(1);
    expect(result.appointments.total).toBe(2);
    expect(result.appointments.queueActive).toBe(1); /* waiting only */
    expect(result.appointments.completed).toBe(1);
    const byStatus = result.appointments.byStatus;
    expect(byStatus.find((s) => s.status === 'waiting')?.n).toBe(1);
    expect(byStatus.find((s) => s.status === 'completed')?.n).toBe(1);

    /* cleanup */
    await admin.db.execute(sql`DELETE FROM appointments WHERE org_id = ${TEST_ORG}`);
    await admin.db.execute(sql`DELETE FROM patients WHERE org_id = ${TEST_ORG}`);
    await admin.close();
    await close();
  });

  dbIt('dashboard is read-only: no repository methods exist on the service', async () => {
    /* structural guard: the service surface exposes only `context` */
    const proto = DashboardService.prototype;
    const own = Object.getOwnPropertyNames(proto);
    expect(own).toContain('context');
    expect(own.filter((m) => /create|update|delete|insert|book|reschedule/i.test(m))).toEqual([]);
  });
});
