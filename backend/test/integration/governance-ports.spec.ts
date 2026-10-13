import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createFreshDatabase,
} from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import {
  AuditService,
  InMemoryAuditAdapter,
} from '@shared/audit/audit.service';
import { SettingsRepository } from '@modules/settings/infrastructure/settings.repository';
import { SettingsService } from '@modules/settings/application/settings.service';
import { AiManagerRepository } from '@modules/ai-manager/infrastructure/ai-manager.repository';
import { AiManagerService } from '@modules/ai-manager/application/ai-manager.service';
import { ConfigResolverPort } from '@shared/ports/config-resolver.port';
import { AiPolicyPort } from '@shared/ports/ai-policy.port';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app_password@localhost:3306/medini_dev';

const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000704';

const probe = Promise.all([
  pingDatabase(ADMIN_URL),
  pingDatabase(RUNTIME_URL),
]).then(([adminOk, runtimeOk]) => {
  const ok = adminOk && runtimeOk;

  if (!ok) {
    console.warn(
      '[governance-ports] MySQL admin/runtime database not reachable - SKIPPING.',
    );
  }

  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!(await probe)) {
      ctx.skip();
      return;
    }

    await fn();
  });
}

const hq = {
  staffId: '70d1f1a4-0000-4000-8000-0000000000a1',
  name: 'Test User',
  username: 'hq-s7x',
  role: 'hq',
  orgId: TEST_ORG,
  branchId: null,
  doctorId: null,
};

type Db = ReturnType<typeof createFreshDatabase>['db'];

async function purgeSettings(admin: Db): Promise<void> {
  for (const table of [
    'settings_versions',
    'settings_values',
    'settings_definitions',
  ]) {
    await admin.execute(
      sql`DELETE FROM ${sql.raw(table)} WHERE org_id = ${TEST_ORG}`,
    );
  }
}

async function purgeAi(admin: Db): Promise<void> {
  for (const table of [
    'ai_audit_log',
    'ai_approval_rules',
    'ai_guardrails',
    'ai_automations',
    'ai_knowledge',
    'ai_capabilities',
    'ai_agents',
  ]) {
    await admin.execute(
      sql`DELETE FROM ${sql.raw(table)} WHERE org_id = ${TEST_ORG}`,
    );
  }
}

async function seedMarketingAi(admin: Db): Promise<void> {
  const agentId = randomUUID();

  await admin.execute(sql`
    INSERT INTO ai_agents (
      id,
      org_id,
      \`key\`,
      name,
      owner_domain,
      status,
      description
    )
    VALUES (
      ${agentId},
      ${TEST_ORG},
      'marketing-ai',
      'Marketing AI',
      'marketing',
      'enabled',
      'Governance port integration fixture'
    )
  `);

  for (const capability of ['READ', 'DRAFT', 'EXECUTE'] as const) {
    await admin.execute(sql`
      INSERT INTO ai_capabilities (
        id,
        org_id,
        agent_id,
        domain,
        capability,
        draft_only
      )
      VALUES (
        ${randomUUID()},
        ${TEST_ORG},
        ${agentId},
        'marketing',
        ${capability},
        1
      )
    `);
  }

  await admin.execute(sql`
    INSERT INTO ai_approval_rules (
      id,
      org_id,
      agent_id,
      action_key,
      risk,
      auto,
      note
    )
    VALUES (
      ${randomUUID()},
      ${TEST_ORG},
      ${agentId},
      'AP-3',
      'HIGH',
      0,
      'Campaign send requires human approval'
    )
  `);
}

describe('S7-T4 Cross-domain governance contracts (MySQL)', () => {
  dbIt(
    'ConfigResolverPort resolves effective values and fails safe for unknown keys',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await purgeSettings(admin.db);

      const runtime = createFreshDatabase(RUNTIME_URL);

      try {
        const ctx = new DbContextService(runtime.db);
        const repo = new SettingsRepository();
        const audit = new InMemoryAuditAdapter();

        const settings = new SettingsService(
          ctx,
          repo,
          new AuditService(audit),
        );

        const port = new ConfigResolverPort(ctx, repo);

        await settings.createDefinition(hq, {
          key: 'ai.features.enabled',
          valueType: 'boolean',
          defaultValue: false,
        });

        await settings.setValue(
          hq,
          'ai.features.enabled',
          {
            value: true,
            scope: 'system',
            reason: 'global on',
          },
        );

        const resolved = await port.resolve(
          hq,
          'ai.features.enabled',
          {},
        );

        expect(resolved.value).toBe(true);
        expect(resolved.scope).toBe('system');

        expect(
          await port.isEnabled(
            hq,
            'ai.features.enabled',
            {},
          ),
        ).toBe(true);

        const unknown = await port.resolve(
          hq,
          'does.not.exist',
          {},
        );

        expect(unknown.value).toBeNull();
        expect(unknown.scope).toBeNull();

        expect(
          await port.isEnabled(
            hq,
            'does.not.exist',
            {},
          ),
        ).toBe(false);
      } finally {
        await runtime.close();
        await purgeSettings(admin.db);
        await admin.close();
      }
    },
  );

  dbIt(
    'AiPolicyPort evaluates isolated agent policy and fails closed for unknown agents',
    async () => {
      const admin = createFreshDatabase(ADMIN_URL);
      await purgeAi(admin.db);
      await seedMarketingAi(admin.db);

      const runtime = createFreshDatabase(RUNTIME_URL);

      try {
        const ctx = new DbContextService(runtime.db);
        const repo = new AiManagerRepository();
        const audit = new InMemoryAuditAdapter();

        const aiManager = new AiManagerService(
          ctx,
          repo,
          new AuditService(audit),
        );

        const port = new AiPolicyPort(
          ctx,
          aiManager,
          repo,
        );

        const execute = await port.evaluate(hq, {
          agentKey: 'marketing-ai',
          domain: 'marketing',
          capability: 'EXECUTE',
          actionKey: 'AP-3',
        });

        expect(execute.decision).toBe('BLOCKED');

        const draft = await port.evaluate(hq, {
          agentKey: 'marketing-ai',
          domain: 'marketing',
          capability: 'DRAFT',
        });

        expect(draft.decision).toBe('DRAFT');

        const ghost = await port.evaluate(hq, {
          agentKey: 'ghost',
          domain: 'finance',
          capability: 'READ',
        });

        expect(ghost.decision).toBe('BLOCKED');
        expect(ghost.reason).toMatch(/unknown agent/i);

        expect(
          await port.canAutoExecute(hq, {
            agentKey: 'marketing-ai',
            domain: 'marketing',
            actionKey: 'AP-3',
          }),
        ).toBe(false);
      } finally {
        await runtime.close();
        await purgeAi(admin.db);
        await admin.close();
      }
    },
  );
});