import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { SettingsRepository } from '@modules/settings/infrastructure/settings.repository';
import { SettingsService } from '@modules/settings/application/settings.service';
import { resolveEffective, validateValueType } from '@modules/settings/domain/settings-lifecycle';
import { ForbiddenError, ConflictError, ValidationError, NotFoundError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000702';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const P = {
  hq: '70d1f1a2-0000-4000-8000-0000000000a1',
  bm: '70d1f1a2-0000-4000-8000-0000000000bb',
  ba: '70d1f1a2-0000-4000-8000-0000000000cc',
  dr: '70d1f1a2-0000-4000-8000-0000000000dd',
};
const hq = { staffId: P.hq, username: 'hq-s7s', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
const bm = (b: string) => ({ staffId: P.bm, username: 'bm-s7s', role: 'branch_manager', orgId: TEST_ORG, branchId: b, doctorId: null });
const ba = (b: string) => ({ staffId: P.ba, username: 'ba-s7s', role: 'branch_admin', orgId: TEST_ORG, branchId: b, doctorId: null });
const doc = (b: string) => ({ staffId: P.dr, username: 'dr-s7s', role: 'doctor', orgId: TEST_ORG, branchId: b, doctorId: P.dr });

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit: InMemoryAuditAdapter) {
  return new SettingsService(new DbContextService(db), new SettingsRepository(), new AuditService(audit));
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  for (const t of ['settings_versions', 'settings_values', 'settings_definitions', 'secret_refs']) {
    await admin.execute(sql`DELETE FROM ${sql.raw(t)} WHERE org_id=${TEST_ORG}`);
  }
  await admin.execute(sql`DELETE FROM staff WHERE id IN (${P.hq},${P.bm},${P.ba},${P.dr})`);
}
async function seed(admin: ReturnType<typeof createFreshDatabase>['db']) {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const [b1, b2] = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  await admin.execute(sql`DELETE FROM staff WHERE id IN (${P.hq},${P.bm},${P.ba},${P.dr})`);
  await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
    (${P.hq}, ${TEST_ORG}, NULL, 'HQ S', 'hq-s7s-fixed', 'hq', 'Active'),
    (${P.bm}, ${TEST_ORG}, ${b1}, 'BM S', 'bm-s7s-fixed', 'branch_manager', 'Active'),
    (${P.ba}, ${TEST_ORG}, ${b1}, 'BA S', 'ba-s7s-fixed', 'branch_admin', 'Active'),
    (${P.dr}, ${TEST_ORG}, ${b1}, 'DR S', 'dr-s7s-fixed', 'doctor', 'Active')`);
  return { b1: b1!, b2: b2! };
}

describe('S7 Settings — registry + inheritance + overrides + SecretRef (unique org per suite)', () => {
  /* ---------- pure domain unit tests ---------- */
  it('unit: precedence FEATURE>ROLE>BRANCH>ORG>SYSTEM; default fallback', () => {
    const values = [
      { scope: 'system' as const, scopeRef: null, value: 'sys' },
      { scope: 'branch' as const, scopeRef: 'B1', value: 'branch' },
      { scope: 'role' as const, scopeRef: 'doctor', value: 'role' },
    ];
    /* branch + role both set → role wins (more specific) */
    expect(resolveEffective(values, { branchId: 'B1', role: 'doctor' }, 'def').value).toBe('role');
    /* role not matching → branch wins */
    expect(resolveEffective(values, { branchId: 'B1', role: 'hq' }, 'def').value).toBe('branch');
    /* no branch/role match → system */
    expect(resolveEffective(values, { branchId: 'B9', role: 'hq' }, 'def').value).toBe('sys');
    /* none → default */
    expect(resolveEffective([], { branchId: 'B1' }, 'def').value).toBe('def');
  });
  it('unit: value type validation', () => {
    expect(validateValueType('string', 'x')).toBeNull();
    expect(validateValueType('string', 1)).not.toBeNull();
    expect(validateValueType('number', 5)).toBeNull();
    expect(validateValueType('boolean', true)).toBeNull();
    expect(validateValueType('json', { a: 1 })).toBeNull();
    expect(validateValueType('json', 'str')).not.toBeNull();
  });

  /* ---------- integration ---------- */
  dbIt('register definition (HQ only) + duplicate rejected + list', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const def = await svc.createDefinition(hq, { key: 'notifications.whatsapp.reminder_24h', valueType: 'boolean', category: 'notifications', defaultValue: true });
    expect(def.key).toBe('notifications.whatsapp.reminder_24h');
    await expect(svc.createDefinition(hq, { key: 'notifications.whatsapp.reminder_24h', valueType: 'boolean' })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createDefinition(bm(s.b1), { key: 'x.y', valueType: 'string' })).rejects.toBeInstanceOf(ForbiddenError);
    const list = await svc.listDefinitions(hq, 'notifications');
    expect(list.length).toBe(1);
    expect(audit.events.some((e) => e.action === 'settings_definition_created')).toBe(true);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('inheritance: system → org → branch override + effective resolution', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    await svc.createDefinition(hq, { key: 'ai.features.enabled', valueType: 'boolean', defaultValue: false, allowedScopes: ['system', 'organization', 'branch'] });
    /* default */
    let eff = await svc.getEffective(hq, 'ai.features.enabled', {});
    expect(eff.value).toBe(false); expect(eff.scope).toBeNull();
    /* system value */
    await svc.setValue(hq, 'ai.features.enabled', { value: true, scope: 'system', reason: 'global on' });
    eff = await svc.getEffective(hq, 'ai.features.enabled', {});
    expect(eff.value).toBe(true); expect(eff.scope).toBe('system');
    /* branch override (HQ sets for b1) */
    await svc.setValue(hq, 'ai.features.enabled', { value: false, scope: 'branch', scopeRef: s.b1, reason: 'b1 off' });
    eff = await svc.getEffective(hq, 'ai.features.enabled', { branchId: s.b1 });
    expect(eff.value).toBe(false); expect(eff.scope).toBe('branch');
    /* other branch inherits system */
    eff = await svc.getEffective(hq, 'ai.features.enabled', { branchId: s.b2 });
    expect(eff.value).toBe(true); expect(eff.scope).toBe('system');
    /* version history: 2 versions recorded */
    const versions = await svc.getVersions(hq, 'ai.features.enabled');
    expect(versions.length).toBe(2);
    expect(audit.events.filter((e) => e.action === 'settings_value_set').length).toBe(2);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('BM own-branch override allowed; BM foreign branch + system scope denied; BA/doctor set denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    await svc.createDefinition(hq, { key: 'notifications.whatsapp.reminder_2h', valueType: 'boolean', defaultValue: true });
    /* BM own branch OK */
    const v = await svc.setValue(bm(s.b1), 'notifications.whatsapp.reminder_2h', { value: false, scope: 'branch', reason: 'b1 custom' });
    expect(v.scope).toBe('branch'); expect(v.scopeRef).toBe(s.b1);
    /* BM foreign branch denied */
    await expect(svc.setValue(bm(s.b1), 'notifications.whatsapp.reminder_2h', { value: true, scope: 'branch', scopeRef: s.b2, reason: 'nope' })).rejects.toBeInstanceOf(ForbiddenError);
    /* BM system scope denied */
    await expect(svc.setValue(bm(s.b1), 'notifications.whatsapp.reminder_2h', { value: true, scope: 'system', reason: 'nope' })).rejects.toBeInstanceOf(ForbiddenError);
    /* BA / doctor denied entirely */
    await expect(svc.setValue(ba(s.b1), 'notifications.whatsapp.reminder_2h', { value: true, scope: 'branch', reason: 'nope' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.setValue(doc(s.b1), 'notifications.whatsapp.reminder_2h', { value: true, scope: 'branch', reason: 'nope' })).rejects.toBeInstanceOf(ForbiddenError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('non-overridable + locked settings reject branch override; type validation enforced', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    await svc.createDefinition(hq, { key: 'org.currency', valueType: 'string', defaultValue: 'MYR', branchOverridable: false, locked: true });
    /* branch override rejected (non-overridable) even for HQ */
    await expect(svc.setValue(hq, 'org.currency', { value: 'USD', scope: 'branch', scopeRef: s.b1, reason: 'try' })).rejects.toBeInstanceOf(ForbiddenError);
    /* HQ system set OK (locked allows HQ) */
    await svc.setValue(hq, 'org.currency', { value: 'MYR', scope: 'system', reason: 'canonical' });
    /* BM locked setting denied */
    await expect(svc.setValue(bm(s.b1), 'org.currency', { value: 'USD', scope: 'branch', reason: 'try' })).rejects.toBeInstanceOf(ForbiddenError);
    /* type validation */
    await svc.createDefinition(hq, { key: 'security.password.min_length', valueType: 'number', defaultValue: 8 });
    await expect(svc.setValue(hq, 'security.password.min_length', { value: 'eight', scope: 'system', reason: 'bad' })).rejects.toBeInstanceOf(ValidationError);
    /* scope not allowed by definition (role not in allowedScopes) */
    await expect(svc.setValue(hq, 'security.password.min_length', { value: 10, scope: 'role', scopeRef: 'hq', reason: 'try' })).rejects.toBeInstanceOf(ValidationError);
    /* unknown key */
    await expect(svc.getEffective(hq, 'does.not.exist', {})).rejects.toBeInstanceOf(NotFoundError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('SecretRef: HQ-only metadata, raw secret value hard-blocked, non-HQ denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ref = await svc.registerSecretRef(hq, { key: 'integrations.bukku.api_key', vaultPath: 'vault/medini/bukku', lastFour: 'x9z2', status: 'REGISTERED' });
    expect(ref.status).toBe('REGISTERED');
    expect((ref as Record<string, unknown>).value).toBeUndefined();
    /* raw secret value rejected */
    await expect(svc.registerSecretRef(hq, { key: 'bad', vaultPath: 'v/x', value: 'supersecret' } as never)).rejects.toBeInstanceOf(ValidationError);
    /* non-HQ denied list + register */
    await expect(svc.listSecretRefs(bm(s.b1))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.registerSecretRef(bm(s.b1), { key: 'k', vaultPath: 'v' })).rejects.toBeInstanceOf(ForbiddenError);
    /* rotation metadata */
    const rotated = await svc.registerSecretRef(hq, { key: 'integrations.bukku.api_key', vaultPath: 'vault/medini/bukku', lastFour: 'a1b2', status: 'ROTATED' });
    expect(rotated.status).toBe('ROTATED');
    expect(rotated.rotatedAt).not.toBeNull();
    expect(audit.events.some((e) => e.action === 'secret_ref_registered')).toBe(true);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('RLS probe: BM context cannot write system-scope value at DB layer; doctor write denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    await svc.createDefinition(hq, { key: 'probe.key', valueType: 'string', defaultValue: 'd' });
    const client = await (db as unknown as { $client: { connect(): Promise<{ query(q: string): Promise<{ rows: Array<{ n: number }> }>; release(): void }> } }).$client.connect();
    try {
      /* doctor: read allowed (definitions policy), write denied by WITH CHECK */
      await client.query(`SELECT set_config('app.role','doctor',false)`);
      await client.query(`SELECT set_config('app.org_id','${TEST_ORG}',false)`);
      await client.query(`SELECT set_config('app.branch_ids','${s.b1}',false)`);
      const read = await client.query(`SELECT count(*)::int AS n FROM settings_definitions WHERE org_id='${TEST_ORG}'`);
      expect(read.rows[0]!.n).toBe(1);
      let denied = false;
      try {
        await client.query(`INSERT INTO settings_values (org_id,key,scope,value) VALUES ('${TEST_ORG}','probe.key','system','"x"')`);
      } catch { denied = true; }
      expect(denied).toBe(true);
      /* BM: branch-scope write for FOREIGN branch denied at DB layer */
      await client.query(`SELECT set_config('app.role','branch_manager',false)`);
      denied = false;
      try {
        await client.query(`INSERT INTO settings_values (org_id,key,scope,scope_ref,value) VALUES ('${TEST_ORG}','probe.key','branch','${s.b2}','"x"')`);
      } catch { denied = true; }
      expect(denied).toBe(true);
      /* BM own branch write allowed */
      await client.query(`INSERT INTO settings_values (org_id,key,scope,scope_ref,value) VALUES ('${TEST_ORG}','probe.key','branch','${s.b1}','"ok"')`);
      /* secret_refs invisible to BM */
      const sr = await client.query(`SELECT count(*)::int AS n FROM secret_refs`);
      expect(sr.rows[0]!.n).toBe(0);
    } finally { client.release(); }
    await purge(admin.db); await admin.close(); await close();
  });
});
