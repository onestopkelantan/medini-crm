import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService, ScopedSystemWorkerContext } from '@core/auth/db-context.service';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ORG_A = '80d1f1a1-0000-4000-8000-0000000000a1';
const ORG_B = '80d1f1a1-0000-4000-8000-0000000000b1';
const BRANCH_A = 'a40c408a-ff28-4f89-887d-eb01011587ef';

const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

type FreshDb = ReturnType<typeof createFreshDatabase>['db'];
async function twoBranches(admin: FreshDb): Promise<[string, string]> {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const r = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((x) => x.id);
  return [r[0]!, r[1]!];
}
async function purge(admin: FreshDb): Promise<void> {
  for (const t of ['patients']) {
    await admin.execute(sql.raw(`DELETE FROM ${t} WHERE org_id IN ('${ORG_A}','${ORG_B}')`));
  }
}
async function seed(admin: FreshDb, b1: string, b2: string): Promise<void> {
  await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name) VALUES
    (${ORG_A}, ${b1}, 'MDN-S8A1', 'A-b1'),
    (${ORG_A}, ${b2}, 'MDN-S8A2', 'A-b2'),
    (${ORG_B}, ${b1}, 'MDN-S8B1', 'B-b1')`);
}

function workerCtx(orgId: string, branchIds: string[]): ScopedSystemWorkerContext {
  return { orgId, branchIds, correlationId: `s8-sec-${orgId}`, source: 'system_worker' };
}
/** Query org-wide (branchId null) — RLS restricts to worker's org+branch scope. */
async function visibleMrns(db: FreshDb, ctx: ScopedSystemWorkerContext): Promise<string[]> {
  const dbCtx = new DbContextService(db);
  const repo = new PatientsRepository();
  return dbCtx.runAsWorker(ctx, async (tx) => {
    const rows = await repo.search(tx, ctx.orgId, null, { limit: 100, offset: 0 });
    return rows.map((p) => p.mrn);
  });
}

describe('S8 T1 — system worker identity + RLS org isolation (unique orgs per suite)', () => {
  dbIt('worker Org A sees Org A rows only; cross-org DENIED', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const [b1, b2] = await twoBranches(admin.db); await seed(admin.db, b1, b2);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = await visibleMrns(db, workerCtx(ORG_A, [b1]));
    expect(a).toContain('MDN-S8A1');
    expect(a).not.toContain('MDN-S8B1'); /* cross-org denied */
    await close(); await admin.close();
  });

  dbIt('worker Org A / Branch b1 cannot see Org A / Branch b2 (cross-branch DENIED)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const [b1, b2] = await twoBranches(admin.db); await seed(admin.db, b1, b2);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const a = await visibleMrns(db, workerCtx(ORG_A, [b1]));
    expect(a).toContain('MDN-S8A1');
    expect(a).not.toContain('MDN-S8A2'); /* cross-branch denied */
    await close(); await admin.close();
  });

  dbIt('missing orgId context is rejected before any query (fail-safe)', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    await expect(dbCtx.runAsWorker({ orgId: '', branchIds: ['x'], correlationId: 'x', source: 'system_worker' }, async () => undefined))
      .rejects.toThrow(/Invalid system worker scope/);
    await close();
  });

  dbIt('context leakage: Org A then Org B jobs do not share GUC scope', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const [b1, b2] = await twoBranches(admin.db); await seed(admin.db, b1, b2);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    await visibleMrns(db, workerCtx(ORG_A, [b1]));
    const b = await visibleMrns(db, workerCtx(ORG_B, [b1]));
    expect(b).toContain('MDN-S8B1');
    expect(b).not.toContain('MDN-S8A1'); /* no leakage from A */
    await close(); await admin.close();
  });
});

describe('N8-3/N8-7 — worker least privilege contract (architecture-aligned)', () => {
  /* Architecture decision (N8-3): workers get SELECT on patients READ-ONLY,
   * org+branch scoped — the Bukku payload maps the customer display name and
   * the WhatsApp conversation-link flow reads patients. No worker writes. */

  dbIt('system_worker INSERT patient = DENY', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const [b1] = await twoBranches(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    let denied = false;
    try {
      await dbCtx.runAsWorker(workerCtx(ORG_A, [b1]), async (tx) => {
        await tx.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name)
          VALUES (${ORG_A}, ${b1}, 'MDN-S8-WDENY', 'worker write attempt')`);
      });
    } catch { denied = true; }
    expect(denied).toBe(true);
    await close(); await admin.close();
  });

  dbIt('system_worker UPDATE patient = DENY', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const [b1, b2] = await twoBranches(admin.db); await seed(admin.db, b1, b2);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const updated = await dbCtx.runAsWorker(workerCtx(ORG_A, [b1]), async (tx) => {
      const r = await tx.execute(sql`UPDATE patients SET name = 'worker tamper'
        WHERE org_id = ${ORG_A} AND branch_id = ${b1}`);
      return (r as unknown as { rowCount: number }).rowCount;
    });
    expect(updated ?? 0).toBe(0); /* RLS WITH CHECK blocks the write */
    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('system_worker DELETE patient = DENY', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const [b1, b2] = await twoBranches(admin.db); await seed(admin.db, b1, b2);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    /* medini_app has no DELETE grant on patients — the DB itself raises 42501.
     * Either way (grant denial or zero rows), no patient may be deleted. */
    let denied = false;
    let rowCount = 0;
    try {
      await dbCtx.runAsWorker(workerCtx(ORG_A, [b1]), async (tx) => {
        const r = await tx.execute(sql`DELETE FROM patients WHERE org_id = ${ORG_A} AND branch_id = ${b1}`);
        rowCount = (r as unknown as { rowCount: number }).rowCount ?? 0;
      });
    } catch { denied = true; }
    expect(denied || rowCount === 0).toBe(true);
    /* Prove nothing was actually deleted. */
    const remaining = await admin.db.execute(sql`SELECT COUNT(*)::int AS c FROM patients WHERE org_id = ${ORG_A}`);
    expect((remaining as unknown as { rows: Array<{ c: number }> }).rows[0]!.c).toBeGreaterThan(0);
    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('system_worker unrelated domain table (treatment_plans) = DENY', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const admin = createFreshDatabase(ADMIN_URL);
    const [b1] = await twoBranches(admin.db);
    const visible = await dbCtx.runAsWorker(workerCtx(ORG_A, [b1]), async (tx) => {
      const r = await tx.execute(sql`SELECT id FROM treatment_plans LIMIT 5`);
      return (r as unknown as { rows: unknown[] }).rows.length;
    });
    expect(visible).toBe(0); /* blanket s8_worker_exclusion holds */
    await close(); await admin.close();
  });
});

describe('N9-1 — legacy table least-privilege hardening', () => {
  dbIt('system_worker INSERT staff = DENY', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    let denied = false;
    try {
      await dbCtx.runAsWorker(workerCtx(ORG_A, [BRANCH_A]), async (tx) => {
        await tx.execute(sql`INSERT INTO staff (org_id, branch_id, name, username, role)
          VALUES (${ORG_A}, ${BRANCH_A}, 'test', 'testuser', 'doctor')`);
      });
    } catch { denied = true; }
    expect(denied).toBe(true);
    await close();
  });

  dbIt('system_worker INSERT role_assignments = DENY', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    let denied = false;
    try {
      await dbCtx.runAsWorker(workerCtx(ORG_A, [BRANCH_A]), async (tx) => {
        await tx.execute(sql`INSERT INTO role_assignments (org_id, staff_id, role, branch_id)
          VALUES (${ORG_A}, '00000000-0000-0000-0000-000000000000', 'doctor', ${BRANCH_A})`);
      });
    } catch { denied = true; }
    expect(denied).toBe(true);
    await close();
  });

  dbIt('system_worker INSERT idempotency_keys = DENY', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    let denied = false;
    try {
      await dbCtx.runAsWorker(workerCtx(ORG_A, [BRANCH_A]), async (tx) => {
        await tx.execute(sql`INSERT INTO idempotency_keys (key, scope, expires_at)
          VALUES ('test', 'test', NOW() + INTERVAL '1 hour')`);
      });
    } catch { denied = true; }
    expect(denied).toBe(true);
    await close();
  });

  dbIt('system_worker INSERT audit_log = ALLOW (required)', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    let allowed = false;
    try {
      await dbCtx.runAsWorker(workerCtx(ORG_A, [BRANCH_A]), async (tx) => {
        await tx.execute(sql`INSERT INTO audit_log (org_id, branch_id, actor_id, actor_role, action, entity, entity_id, source, correlation_id)
          VALUES (${ORG_A}, ${BRANCH_A}, '00000000-0000-0000-0000-000000000000', 'system_worker', 'test', 'test', 'test', 'worker', 'test-123')`);
        allowed = true;
      });
    } catch { /* denied */ }
    expect(allowed).toBe(true);
    await close();
  });
});
