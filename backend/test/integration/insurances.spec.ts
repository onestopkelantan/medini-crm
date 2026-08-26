import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { AuditPort, AuditEvent } from '@shared/audit/audit.port';
import { InsurancesRepository } from '@modules/payors/infrastructure/insurances.repository';
import { InsurancesService } from '@modules/payors/application/insurances.service';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '@shared/errors/errors';

/**
 * Sprint 2A T4 — Insurance master data application layer (live PG).
 * Mirrors the T3 Panel test discipline: service-level through runAs() + RLS +
 * same-transaction audit. Honest skip when DB unreachable. Fixtures purged.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[insurances] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-9999999999d1';
const OTHER_ORG = '99999999-9999-9999-9999-9999999999d2';

function hq() {
  return { staffId: '00000000-0000-0000-0000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
}
function bm(branchId = 'b') {
  return { staffId: '00000000-0000-0000-0000-0000000000bb', username: 'manager', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null };
}
function reception(branchId = 'b') {
  return { staffId: '00000000-0000-0000-0000-0000000000cc', username: 'reception', role: 'branch_admin', orgId: TEST_ORG, branchId, doctorId: null };
}
function doctor(branchId = 'b') {
  const id = '00000000-0000-0000-0000-0000000000dd';
  return { staffId: id, username: 'doctor', role: 'doctor', orgId: TEST_ORG, branchId, doctorId: id };
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

class ThrowingAudit extends AuditPort {
  record(_e: AuditEvent, _tx?: unknown): Promise<void> | void {
    throw new Error('audit backend down (controlled failure)');
  }
}

async function purge(admin: ReturnType<typeof createFreshDatabase>['db']): Promise<void> {
  await admin.execute(sql`DELETE FROM insurance_companies WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})`);
  await admin.execute(sql`DELETE FROM audit_log WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})`);
  for (const org of [TEST_ORG, OTHER_ORG]) {
    const key = org.replace(/-/g, '').slice(-8).toLowerCase();
    await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_ins_${key}`)} START WITH 1`);
    await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_ins_${key}`)} RESTART WITH 1`);
  }
}

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit?: AuditService) {
  const ctx = new DbContextService(db);
  return new InsurancesService(ctx, new InsurancesRepository(), audit ?? new AuditService(new RecordingAudit()));
}

describe('Sprint 2A T4 — Insurance master data (live PG)', () => {
  /* ---- CRUD ---- */
  dbIt('create: HQ creates insurance with allocated INS code, source=custom, status=Active', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const i = await svc.create(hq(), { name: '  AIA   INSURANCE ', pic: 'Puan Mei', phone: '03-2222', address: 'KL' });
    expect(i.code).toBe('INS-0001');
    expect(i.name).toBe('AIA INSURANCE');
    expect(i.source).toBe('custom');
    expect(i.status).toBe('Active');
    expect(i.orgId).toBe(TEST_ORG);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('create: validation rejects missing/short name (422)', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    await expect(svc.create(hq(), { name: 'X' })).rejects.toThrow(ValidationError);
    await expect(svc.create(hq(), {})).rejects.toThrow(ValidationError);
    await close();
  });

  dbIt('get + list: org-scoped read with search query', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const a = await svc.create(hq(), { name: 'Great Eastern' });
    await svc.create(hq(), { name: 'Prudential' });
    const got = await svc.getById(hq(), a.id);
    expect(got.name).toBe('Great Eastern');
    const all = await svc.search(hq());
    expect(all).toHaveLength(2);
    const filtered = await svc.search(hq(), 'Prud');
    expect(filtered.map((i) => i.name)).toEqual(['Prudential']);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('update: HQ updates fields; immutable fields (code/source/org) unchanged', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const i = await svc.create(hq(), { name: 'Old Insurer', pic: 'A' });
    const u = await svc.update(hq(), i.id, { name: 'New Insurer', phone: '03-9999' });
    expect(u.name).toBe('New Insurer');
    expect(u.phone).toBe('03-9999');
    expect(u.code).toBe(i.code);
    expect(u.source).toBe('custom');
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('status: Active→Inactive→Active with audit actions; same-state is no-op', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const audit = new RecordingAudit();
    const svc = build(db, new AuditService(audit));
    const i = await svc.create(hq(), { name: 'Status Insurer' });
    const off = await svc.changeStatus(hq(), i.id, { status: 'Inactive' });
    expect(off.status).toBe('Inactive');
    const on = await svc.changeStatus(hq(), i.id, { status: 'Active' });
    expect(on.status).toBe('Active');
    const noop = await svc.changeStatus(hq(), i.id, { status: 'Active' });
    expect(noop.status).toBe('Active');
    expect(audit.events.map((e) => e.action)).toEqual([
      'insurance_created', 'insurance_deactivated', 'insurance_activated',
    ]);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('status: invalid value rejected (422)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const i = await svc.create(hq(), { name: 'Guard Insurer' });
    await expect(svc.changeStatus(hq(), i.id, { status: 'Void' })).rejects.toThrow(ValidationError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Duplicates ---- */
  dbIt('duplicate: same-org case-insensitive + whitespace variants rejected (409), incl. Inactive', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const i = await svc.create(hq(), { name: 'AIA INSURANCE' });
    await expect(svc.create(hq(), { name: 'aia insurance' })).rejects.toThrow(ConflictError);
    await expect(svc.create(hq(), { name: ' AIA   INSURANCE ' })).rejects.toThrow(ConflictError);
    await svc.changeStatus(hq(), i.id, { status: 'Inactive' });
    await expect(svc.create(hq(), { name: 'Aia Insurance' })).rejects.toThrow(ConflictError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('duplicate: same name in a DIFFERENT org is allowed; cross-org read does not leak', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    await svc.create(hq(), { name: 'Shared Insurer' });
    const other = await svc.create({ ...hq(), orgId: OTHER_ORG }, { name: 'Shared Insurer' });
    expect(other.orgId).toBe(OTHER_ORG);
    expect(other.code).toBe('INS-0001'); /* org-isolated sequence */
    await expect(svc.getById(hq(), other.id)).rejects.toThrow(NotFoundError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Security ---- */
  dbIt('security: BM can read but cannot write; reception/doctor denied entirely', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO insurance_companies (org_id, code, name) VALUES (${TEST_ORG}, 'INS-S001', 'Secured Insurer')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const list = await svc.search(bm());
    expect(list.map((i) => i.name)).toContain('Secured Insurer');
    await expect(svc.create(bm(), { name: 'BM Insurer' })).rejects.toThrow(ForbiddenError);
    await expect(svc.changeStatus(bm(), list[0]!.id, { status: 'Inactive' })).rejects.toThrow(ForbiddenError);
    expect(await svc.search(reception())).toHaveLength(0);
    expect(await svc.search(doctor())).toHaveLength(0);
    await expect(svc.create(reception(), { name: 'R Insurer' })).rejects.toThrow(ForbiddenError);
    await expect(svc.create(doctor(), { name: 'D Insurer' })).rejects.toThrow(ForbiddenError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Audit + atomicity ---- */
  dbIt('atomicity: audit failure rolls back the insurance mutation (0 insurance + 0 audit)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db, new AuditService(new ThrowingAudit()));
    await expect(svc.create(hq(), { name: 'Atomicity Victim' })).rejects.toThrow(/audit backend down/);
    const rows = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM insurance_companies WHERE org_id = ${TEST_ORG}`,
    );
    expect((rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('audit: update records before/after payloads on the same transaction', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const i = await svc.create(hq(), { name: 'Audit Insurer', pic: 'Before' });
    await svc.update(hq(), i.id, { pic: 'After' });
    const rows = await admin.db.execute(
      sql`SELECT action, before::text AS b, after::text AS a FROM audit_log
          WHERE org_id = ${TEST_ORG} AND entity = 'insurance_companies' ORDER BY created_at`,
    );
    const list = (rows as unknown as { rows: Array<{ action: string; b: string; a: string }> }).rows;
    expect(list.map((r) => r.action)).toEqual(['insurance_created', 'insurance_updated']);
    expect(list[1]!.b).toContain('Before');
    expect(list[1]!.a).toContain('After');
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Code allocation ---- */
  dbIt('code allocation: INS codes unique + org-safe + sequential per org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const a = await svc.create(hq(), { name: 'Insurer One' });
    const b = await svc.create(hq(), { name: 'Insurer Two' });
    expect(a.code).toBe('INS-0001');
    expect(b.code).toBe('INS-0002');
    await purge(admin.db);
    await admin.close();
    await close();
  });
});
