import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';

/**
 * S10 T3 — Core business E2E (live PG, service-level via admin context).
 * Patient → Appointment → Reports data integrity.
 * Note: full request-level E2E (frontend→REST→backend) requires a booted app — T3 scope.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[s10-e2e] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const ORG = '00000000-0000-0000-0000-000000000001';

describe('S10 T3 — Core Business E2E', () => {
  dbIt('Patient: create → read → update → verify persistence', async () => {
    const admin = createDatabase(ADMIN_URL);
    const branchId = (await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`) as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    if (!branchId) { console.warn('No branches — skipping'); return; }
    const patientId = 'a1000000-0000-4000-8000-000000000030';

    await admin.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await admin.execute(sql`INSERT INTO patients (id, org_id, branch_id, mrn, name, phone, status)
      VALUES (${patientId}, ${ORG}, ${branchId}, 'MDN-E2E-001', 'E2E Patient', '+60123456789', 'Active')`);

    const created = (await admin.execute(sql`SELECT name, phone FROM patients WHERE id = ${patientId}`) as unknown as { rows: Array<{ name: string; phone: string }> }).rows[0];
    expect(created?.name).toBe('E2E Patient');

    await admin.execute(sql`UPDATE patients SET phone = '+60987654321' WHERE id = ${patientId}`);
    const updated = (await admin.execute(sql`SELECT phone FROM patients WHERE id = ${patientId}`) as unknown as { rows: Array<{ phone: string }> }).rows[0];
    expect(updated?.phone).toBe('+60987654321');

    await admin.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await closeDatabase();
  });

  dbIt('Appointment: create → assign doctor → update status → verify', async () => {
    const admin = createDatabase(ADMIN_URL);
    const branchId = (await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`) as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    if (!branchId) { console.warn('No branches — skipping'); return; }
    const patientId = 'a1000000-0000-4000-8000-000000000031';
    const apptId = 'a1000000-0000-4000-8000-000000000032';
    const doctorId = 'a1000000-0000-4000-8000-000000000033';

    await admin.execute(sql`DELETE FROM appointments WHERE id = ${apptId}`);
    await admin.execute(sql`DELETE FROM staff WHERE id = ${doctorId}`);
    await admin.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);

    await admin.execute(sql`INSERT INTO patients (id, org_id, branch_id, mrn, name, status)
      VALUES (${patientId}, ${ORG}, ${branchId}, 'MDN-E2E-002', 'Appt Patient', 'Active')`);
    await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status)
      VALUES (${doctorId}, ${ORG}, ${branchId}, 'Dr E2E', 'dr_e2e_s10t3', 'doctor', 'Active')`);
    await admin.execute(sql`INSERT INTO appointments (id, org_id, branch_id, code, patient_id, patient_name, scheduled_date, scheduled_time, status, version)
      VALUES (${apptId}, ${ORG}, ${branchId}, 'APT-E2E-001', ${patientId}, 'Appt Patient', '2026-08-20', '10:00', 'booked', 1)`);

    await admin.execute(sql`UPDATE appointments SET doctor_id = ${doctorId}, status = 'confirmed' WHERE id = ${apptId}`);
    const appt = (await admin.execute(sql`SELECT status, doctor_id FROM appointments WHERE id = ${apptId}`) as unknown as { rows: Array<{ status: string; doctor_id: string }> }).rows[0];
    expect(appt?.status).toBe('confirmed');
    expect(appt?.doctor_id).toBe(doctorId);

    await admin.execute(sql`DELETE FROM appointments WHERE id = ${apptId}`);
    await admin.execute(sql`DELETE FROM staff WHERE id = ${doctorId}`);
    await admin.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await closeDatabase();
  });

  dbIt('Reports: KPI definitions return canonical seeded data', async () => {
    const admin = createDatabase(ADMIN_URL);
    const kpis = (await admin.execute(sql`SELECT kpi_key FROM kpi_definitions WHERE status = 'published'`) as unknown as { rows: Array<{ kpi_key: string }> }).rows;
    expect(kpis.length).toBeGreaterThanOrEqual(4);
    expect(kpis.map((k) => k.kpi_key)).toContain('revenue');
    expect(kpis.map((k) => k.kpi_key)).toContain('no_show_rate');
    expect(kpis.map((k) => k.kpi_key)).toContain('recall_rate');
    await closeDatabase();
  });

  dbIt('Finance: sale_records table exists and is queryable', async () => {
    const admin = createDatabase(ADMIN_URL);
    const result = (await admin.execute(sql`SELECT count(*)::int AS n FROM sale_records`) as unknown as { rows: Array<{ n: number }> }).rows[0];
    expect(typeof result?.n).toBe('number');
    await closeDatabase();
  });
});
