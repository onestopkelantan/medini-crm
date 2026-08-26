import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase, createFreshDatabase,
} from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService } from '@shared/audit/audit.service';
import { AuditPort, AuditEvent } from '@shared/audit/audit.port';
import { PanelsRepository } from '@modules/payors/infrastructure/panels.repository';
import { PanelsService } from '@modules/payors/application/panels.service';
import {
  ValidationError, ForbiddenError, NotFoundError, ConflictError,
} from '@shared/errors/errors';

/**
 * Sprint 2A T3 — Panel master data application layer (live PG).
 * Service-level tests through runAs() + RLS + same-transaction audit.
 * Honest skip when the DB is genuinely unreachable. All fixtures purged.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[panels] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-9999999999c1';
const OTHER_ORG = '99999999-9999-9999-9999-9999999999c2';

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
    /* mirror DbAuditAdapter semantics: write on the SAME tx when provided */
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
  await admin.execute(sql`DELETE FROM panel_companies WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})`);
  await admin.execute(sql`DELETE FROM audit_log WHERE org_id IN (${TEST_ORG}, ${OTHER_ORG})`);
  const key = TEST_ORG.replace(/-/g, '').slice(-8).toLowerCase();
  await admin.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_pnl_${key}`)} START WITH 1`);
  await admin.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_pnl_${key}`)} RESTART WITH 1`);
}

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit?: AuditService) {
  const ctx = new DbContextService(db);
  const svc = new PanelsService(ctx, new PanelsRepository(), audit ?? new AuditService(new RecordingAudit()));
  return svc;
}

describe('Sprint 2A T3 — Panel master data (live PG)', () => {
  /* ---- CRUD ---- */
  dbIt('create: HQ creates a panel with allocated PNL code, source=custom, status=Active', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const p = await svc.create(hq(), { name: '  AIA   PANEL ', pic: 'Encik Ali', phone: '012-3456789', address: 'KL' });
    expect(p.code).toBe('PNL-0001');
    expect(p.name).toBe('AIA PANEL'); /* normalized whitespace, case preserved */
    expect(p.source).toBe('custom');
    expect(p.status).toBe('Active');
    expect(p.orgId).toBe(TEST_ORG);
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
    const a = await svc.create(hq(), { name: 'MEDNEFITS' });
    await svc.create(hq(), { name: 'PMCARE' });
    const got = await svc.getById(hq(), a.id);
    expect(got.name).toBe('MEDNEFITS');
    const all = await svc.search(hq());
    expect(all).toHaveLength(2);
    const filtered = await svc.search(hq(), 'PMC');
    expect(filtered.map((p) => p.name)).toEqual(['PMCARE']);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('update: HQ updates fields; immutable fields (code/source/org) unchanged', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const p = await svc.create(hq(), { name: 'Old Name', pic: 'A' });
    const u = await svc.update(hq(), p.id, { name: 'New Name', phone: '03-1111' });
    expect(u.name).toBe('New Name');
    expect(u.phone).toBe('03-1111');
    expect(u.code).toBe(p.code);
    expect(u.source).toBe('custom');
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('status: Active→Inactive→Active with audit actions', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const audit = new RecordingAudit();
    const svc = build(db, new AuditService(audit));
    const p = await svc.create(hq(), { name: 'Status Panel' });
    const off = await svc.changeStatus(hq(), p.id, { status: 'Inactive' });
    expect(off.status).toBe('Inactive');
    const on = await svc.changeStatus(hq(), p.id, { status: 'Active' });
    expect(on.status).toBe('Active');
    const actions = audit.events.map((e) => e.action);
    expect(actions).toEqual(['panel_created', 'panel_deactivated', 'panel_activated']);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('status: invalid value rejected (422); same-status is a no-op without audit', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const audit = new RecordingAudit();
    const svc = build(db, new AuditService(audit));
    const p = await svc.create(hq(), { name: 'Noop Panel' });
    await expect(svc.changeStatus(hq(), p.id, { status: 'Pending' })).rejects.toThrow(ValidationError);
    const again = await svc.changeStatus(hq(), p.id, { status: 'Active' });
    expect(again.status).toBe('Active');
    expect(audit.events.filter((e) => e.action !== 'panel_created')).toHaveLength(0);
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
    const p = await svc.create(hq(), { name: 'AIA PANEL' });
    await expect(svc.create(hq(), { name: 'aia panel' })).rejects.toThrow(ConflictError);
    await expect(svc.create(hq(), { name: '  AIA   PANEL ' })).rejects.toThrow(ConflictError);
    await svc.changeStatus(hq(), p.id, { status: 'Inactive' });
    await expect(svc.create(hq(), { name: 'AIA Panel' })).rejects.toThrow(ConflictError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('duplicate: same name in a DIFFERENT org is allowed (org isolation)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const oKey = OTHER_ORG.replace(/-/g, '').slice(-8).toLowerCase();
    await admin.db.execute(sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(`medini_pnl_${oKey}`)} START WITH 1`);
    await admin.db.execute(sql`ALTER SEQUENCE ${sql.raw(`medini_pnl_${oKey}`)} RESTART WITH 1`);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    await svc.create(hq(), { name: 'Shared Name' });
    const other = await svc.create({ ...hq(), orgId: OTHER_ORG }, { name: 'Shared Name' });
    expect(other.orgId).toBe(OTHER_ORG);
    /* cross-org read must not leak */
    await expect(svc.getById(hq(), other.id)).rejects.toThrow(NotFoundError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Library + clone ---- */
  dbIt('library: returns 5 static entries (no DB, no audit)', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const lib = svc.listLibrary();
    expect(lib).toHaveLength(5);
    expect(lib.map((e) => e.key)).toEqual(['healthmetrics', 'medident', 'medkad', 'micare', 'tuneprotect']);
    await close();
  });

  dbIt('clone: valid clone copies address, source=builtin, allocated code', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const audit = new RecordingAudit();
    const svc = build(db, new AuditService(audit));
    const p = await svc.clone(hq(), { libraryKey: 'medkad' });
    expect(p.name).toBe('MedKad');
    expect(p.address).toContain('Laman Seri Business Park');
    expect(p.source).toBe('builtin');
    expect(p.status).toBe('Active');
    expect(p.code).toBe('PNL-0001');
    expect(audit.events[0]?.action).toBe('panel_created');
    expect(audit.events[0]?.after).toMatchObject({ source: 'builtin', libraryKey: 'medkad' });
    await purge(admin.db);
    await admin.close();
    await close();
  });

  dbIt('clone: override name; invalid key → 422; duplicate name → 409 (no silent rename)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const p = await svc.clone(hq(), { libraryKey: 'micare', name: 'MiCare Shah Alam' });
    expect(p.name).toBe('MiCare Shah Alam');
    await expect(svc.clone(hq(), { libraryKey: 'aia' })).rejects.toThrow(ValidationError);
    await expect(svc.clone(hq(), { libraryKey: 'tuneprotect', name: 'MiCare Shah Alam' })).rejects.toThrow(ConflictError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Security ---- */
  dbIt('security: BM can read but cannot write; reception/doctor denied entirely', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    await admin.db.execute(
      sql`INSERT INTO panel_companies (org_id, code, name) VALUES (${TEST_ORG}, 'PNL-S001', 'Secured Panel')`,
    );
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    /* BM read OK (RLS USING) */
    const list = await svc.search(bm());
    expect(list.map((p) => p.name)).toContain('Secured Panel');
    /* BM write → 403 at service (RLS WITH CHECK is the DB backstop) */
    await expect(svc.create(bm(), { name: 'BM Panel' })).rejects.toThrow(ForbiddenError);
    await expect(svc.changeStatus(bm(), list[0]!.id, { status: 'Inactive' })).rejects.toThrow(ForbiddenError);
    /* reception + doctor: RLS hides rows even for reads */
    expect(await svc.search(reception())).toHaveLength(0);
    expect(await svc.search(doctor())).toHaveLength(0);
    await expect(svc.create(reception(), { name: 'R Panel' })).rejects.toThrow(ForbiddenError);
    await expect(svc.create(doctor(), { name: 'D Panel' })).rejects.toThrow(ForbiddenError);
    await purge(admin.db);
    await admin.close();
    await close();
  });

  /* ---- Audit + atomicity ---- */
  dbIt('atomicity: audit failure rolls back the panel mutation (0 panel + 0 audit)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    await purge(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db, new AuditService(new ThrowingAudit()));
    await expect(svc.create(hq(), { name: 'Atomicity Victim' })).rejects.toThrow(/audit backend down/);
    const rows = await admin.db.execute(
      sql`SELECT count(*)::int AS n FROM panel_companies WHERE org_id = ${TEST_ORG}`,
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
    const svc = build(db); /* default RecordingAudit writes to audit_log via tx */
    const p = await svc.create(hq(), { name: 'Audit Panel', pic: 'Before' });
    await svc.update(hq(), p.id, { pic: 'After' });
    const rows = await admin.db.execute(
      sql`SELECT action, before::text AS b, after::text AS a FROM audit_log
          WHERE org_id = ${TEST_ORG} AND entity = 'panel_companies' ORDER BY created_at`,
    );
    const list = (rows as unknown as { rows: Array<{ action: string; b: string; a: string }> }).rows;
    /* filter to THIS panel's rows — other suites may append audit rows to the
     * shared org concurrently (cross-suite isolation on the shared dev DB) */
    const mine = list.filter((r) => (r.a ?? '').includes('Audit Panel'));
    expect(mine.map((r) => r.action)).toEqual(['panel_created', 'panel_updated']);
    expect(mine[1]!.b).toContain('Before');
    expect(mine[1]!.a).toContain('After');
    await purge(admin.db);
    await admin.close();
    await close();
  });
});
