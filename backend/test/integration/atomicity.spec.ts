import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { AuditPort, AuditEvent } from '@shared/audit/audit.port';
import { PatientsRepository } from '@modules/patients/infrastructure/patients.repository';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { PatientsService } from '@modules/patients/application/patients.service';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:medini_app_password@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[atomicity] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-999999999950';

function hqPrincipal() {
  return { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
}

/** Audit port that ALWAYS throws — forces the atomicity contract. */
class ThrowingAuditPort extends AuditPort {
  record(_event: AuditEvent, _tx?: unknown): Promise<void> | void {
    throw new Error('audit backend down (controlled failure)');
  }
}

async function branchId(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<string> {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches LIMIT 1`);
  return (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
}

async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM appointments WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM patients WHERE org_id = ${TEST_ORG}`);
  await admin.execute(sql`DELETE FROM audit_log WHERE org_id = ${TEST_ORG}`);
  const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
  await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_mrn_${key}`)} START WITH 1`);
  await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_mrn_${key}`)} RESTART WITH 1`);
}

describe('Blocker 1 — audit atomicity (same transaction as mutation)', () => {
  dbIt('audit failure ROLLS BACK the patient mutation (0 patient + 0 audit)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bId = await branchId(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const audit = new AuditService(new ThrowingAuditPort());
    const service = new PatientsService(ctx, new PatientsRepository(), audit, new PatientsReadPort(db));

    /* register must reject because the audit insert fails INSIDE the tx */
    await expect(
      service.register(hqPrincipal(), { name: 'Atomicity Victim', branchId: bId }),
    ).rejects.toThrow(/audit backend down/);

    /* atomicity proof: NOTHING persisted — no patient, no audit row */
    const patients = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM patients WHERE org_id = ${TEST_ORG}`,
    );
    expect((patients as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
    const audits = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${TEST_ORG}`,
    );
    expect((audits as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);

    await admin.close();
    await close();
  });

  dbIt('successful register persists BOTH patient AND audit in the same tx', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const bId = await branchId(admin.db);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const audit = new AuditService(new (class extends AuditPort {
      record(_e: AuditEvent): void { /* no-op in-memory */ }
    })());
    const service = new PatientsService(ctx, new PatientsRepository(), audit, new PatientsReadPort(db));

    const res = await service.register(hqPrincipal(), { name: 'Atomicity Success', branchId: bId });
    expect(res.patient.mrn).toBe('MDN-0001');

    const patients = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM patients WHERE org_id = ${TEST_ORG}`,
    );
    expect((patients as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(1);

    await purge(admin.db);
    await admin.close();
    await close();
  });
});
