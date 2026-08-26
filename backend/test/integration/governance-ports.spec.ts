import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { SettingsRepository } from '@modules/settings/infrastructure/settings.repository';
import { SettingsService } from '@modules/settings/application/settings.service';
import { AiManagerRepository } from '@modules/ai-manager/infrastructure/ai-manager.repository';
import { AiManagerService } from '@modules/ai-manager/application/ai-manager.service';
import { ConfigResolverPort } from '@shared/ports/config-resolver.port';
import { AiPolicyPort } from '@shared/ports/ai-policy.port';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000704';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const hq = { staffId: '70d1f1a4-0000-4000-8000-0000000000a1', username: 'hq-s7x', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };

describe('S7-T4 Cross-domain governance contracts (ports)', () => {
  dbIt('ConfigResolverPort: domain-neutral effective resolution + isEnabled + unknown key fail-safe', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    for (const t of ['settings_versions', 'settings_values', 'settings_definitions']) {
      await admin.db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE org_id=${TEST_ORG}`);
    }
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const repo = new SettingsRepository();
    const audit = new InMemoryAuditAdapter();
    const settings = new SettingsService(ctx, repo, new AuditService(audit));
    const port = new ConfigResolverPort(ctx, repo);

    /* seed a governed flag */
    await settings.createDefinition(hq, { key: 'ai.features.enabled', valueType: 'boolean', defaultValue: false });
    await settings.setValue(hq, 'ai.features.enabled', { value: true, scope: 'system', reason: 'global on' });

    /* port resolves effective value (domain asks: "is this enabled?") */
    const resolved = await port.resolve(hq, 'ai.features.enabled', {});
    expect(resolved.value).toBe(true);
    expect(resolved.scope).toBe('system');
    expect(await port.isEnabled(hq, 'ai.features.enabled', {})).toBe(true);

    /* unknown key → fail-safe null (no throw; caller decides default) */
    const unknown = await port.resolve(hq, 'does.not.exist', {});
    expect(unknown.value).toBeNull();
    expect(unknown.scope).toBeNull();
    expect(await port.isEnabled(hq, 'does.not.exist', {})).toBe(false);

    for (const t of ['settings_versions', 'settings_values', 'settings_definitions']) {
      await admin.db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE org_id=${TEST_ORG}`);
    }
    await admin.close(); await close();
  });

  dbIt('AiPolicyPort: domain-neutral policy evaluation, fail-closed unknown agent, canAutoExecute', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const ctx = new DbContextService(db);
    const repo = new AiManagerRepository();
    const audit = new InMemoryAuditAdapter();
    const aiManager = new AiManagerService(ctx, repo, new AuditService(audit));
    const port = new AiPolicyPort(ctx, aiManager, repo);

    /* canonical org seeded agents */
    const canonicalHq = { ...hq, orgId: '00000000-0000-0000-0000-000000000001' };

    /* marketing-ai EXECUTE campaign send (AP-3) → BLOCKED (draft-only + GR) */
    const mkt = await port.evaluate(canonicalHq, { agentKey: 'marketing-ai', domain: 'marketing', capability: 'EXECUTE', actionKey: 'AP-3' });
    expect(mkt.decision).toBe('BLOCKED');

    /* marketing-ai DRAFT → DRAFT (domain asks before showing AI Suggest) */
    const draft = await port.evaluate(canonicalHq, { agentKey: 'marketing-ai', domain: 'marketing', capability: 'DRAFT' });
    expect(draft.decision).toBe('DRAFT');

    /* unknown agent → fail-closed BLOCKED (never throw to caller) */
    const ghost = await port.evaluate(canonicalHq, { agentKey: 'ghost', domain: 'finance', capability: 'READ' });
    expect(ghost.decision).toBe('BLOCKED');
    expect(ghost.reason).toMatch(/unknown agent/i);

    /* canAutoExecute convenience */
    expect(await port.canAutoExecute(canonicalHq, { agentKey: 'marketing-ai', domain: 'marketing', actionKey: 'AP-3' })).toBe(false);

    await admin.close(); await close();
  });
});
