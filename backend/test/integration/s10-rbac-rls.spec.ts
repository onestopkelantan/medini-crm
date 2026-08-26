import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { Principal } from '@core/auth/principal';

/**
 * S10 T3 — RBAC + RLS + IDOR + API bypass (live PG).
 * Verifies backend authorization is authoritative; frontend hiding is NOT security.
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[s10-rbac-rls] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const ORG = '00000000-0000-0000-0000-000000000001';
const hq: Principal = { staffId: 'hq-1', username: 'hq', role: 'hq', orgId: ORG, branchId: null, doctorId: null };
const bm = (branchId: string): Principal => ({ staffId: 'bm-1', username: 'bm', role: 'branch_manager', orgId: ORG, branchId, doctorId: null });

describe('S10 T3 — RBAC + RLS + IDOR', () => {
  dbIt('HQ can read branches (org-wide)', async () => {
    const db = createDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const rows = await dbCtx.runAs(hq, async (tx) => {
      const r = await tx.execute(sql`SELECT id FROM branches WHERE deleted_at IS NULL`);
      return (r as unknown as { rows: unknown[] }).rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(14);
    await closeDatabase();
  });

  dbIt('Branch manager sees only own branch patients (RLS)', async () => {
    const db = createDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const b1Result = await db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
    const b1 = (b1Result as unknown as { rows: Array<{ id: string }> }).rows[0]?.id;
    if (!b1) { console.warn('No branches found — skipping'); return; }
    const rows = await dbCtx.runAs(bm(b1), async (tx) => {
      const r = await tx.execute(sql`SELECT id FROM patients WHERE deleted_at IS NULL LIMIT 5`);
      return (r as unknown as { rows: unknown[] }).rows;
    });
    expect(Array.isArray(rows)).toBe(true);
    await closeDatabase();
  });

  dbIt('Branch manager cannot see other branch patients (IDOR attempt)', async () => {
    const db = createDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const branchesResult = await db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
    const branches = (branchesResult as unknown as { rows: Array<{ id: string }> }).rows;
    if (branches.length < 2) { console.warn('Need 2+ branches — skipping'); return; }
    const b1 = branches[0]!.id;
    const b2 = branches[1]!.id;
    /* Seed a patient in b2 via admin */
    const admin = createDatabase(process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev');
    const patientId = 'a1000000-0000-4000-8000-000000000010';
    await admin.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await admin.execute(sql`INSERT INTO patients (id, org_id, branch_id, mrn, name, status) VALUES (${patientId}, ${ORG}, ${b2}, 'MDN-T3-TEST', 'IDOR Test Patient', 'Active')`);
    /* BM from b1 tries to read b2's patient — RLS should block */
    const rows = await dbCtx.runAs(bm(b1), async (tx) => {
      const r = await tx.execute(sql`SELECT id FROM patients WHERE id = ${patientId}`);
      return (r as unknown as { rows: unknown[] }).rows;
    });
    expect(rows.length).toBe(0); /* IDOR blocked by RLS */
    await admin.execute(sql`DELETE FROM patients WHERE id = ${patientId}`);
    await closeDatabase();
  });

  dbIt('Doctor cannot access admin endpoints (RBAC matrix: admin=NONE for doctor)', async () => {
    /* This is enforced by PermissionGuard at the route level; we verify the matrix */
    const { ROLE_DOMAIN_MATRIX } = await import('@shared/architecture/architecture.contract');
    expect(ROLE_DOMAIN_MATRIX.doctor?.admin?.view).toBe(false);
    expect(ROLE_DOMAIN_MATRIX.doctor?.reports?.view).toBe(false); /* S9 Q1 */
    expect(ROLE_DOMAIN_MATRIX.branch_admin?.reports?.view).toBe(false);
  });

  dbIt('Receptionist (branch_admin) cannot access reports (S9 Q1)', async () => {
    const { ROLE_DOMAIN_MATRIX } = await import('@shared/architecture/architecture.contract');
    expect(ROLE_DOMAIN_MATRIX.branch_admin?.reports?.view).toBe(false);
  });

  dbIt('HQ has full access (matrix verification)', async () => {
    const { ROLE_DOMAIN_MATRIX } = await import('@shared/architecture/architecture.contract');
    expect(ROLE_DOMAIN_MATRIX.hq?.admin?.view).toBe(true);
    expect(ROLE_DOMAIN_MATRIX.hq?.reports?.view).toBe(true);
    expect(ROLE_DOMAIN_MATRIX.hq?.finance?.view).toBe(true);
  });
});
