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
import { AiManagerRepository } from '@modules/ai-manager/infrastructure/ai-manager.repository';
import { AiManagerService } from '@modules/ai-manager/application/ai-manager.service';
import {
  canTransitionAiAgent,
  evaluatePolicy,
} from '@modules/ai-manager/domain/ai-manager-policy';
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '@shared/errors/errors';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'mysql://medini_app:medini_app_password@localhost:3306/medini_dev';

const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000703';
const OTHER_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000704';
const TEST_BRANCH = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000705';

const P = {
  hq: '70d1f1a3-0000-4000-8000-0000000000a1',
  bm: '70d1f1a3-0000-4000-8000-0000000000bb',
};

const hq = {
  staffId: P.hq,
  name: 'HQ S7A',
  username: 'hq-s7a',
  role: 'hq',
  orgId: TEST_ORG,
  branchId: null,
  doctorId: null,
};

const bm = {
  staffId: P.bm,
  name: 'BM S7A',
  username: 'bm-s7a',
  role: 'branch_manager',
  orgId: TEST_ORG,
  branchId: TEST_BRANCH,
  doctorId: null,
};

const otherHq = {
  ...hq,
  orgId: OTHER_ORG,
  username: 'hq-other',
};

const probe = Promise.all([
  pingDatabase(ADMIN_URL),
  pingDatabase(RUNTIME_URL),
]).then(([adminOk, runtimeOk]) => {
  const ok = adminOk && runtimeOk;

  if (!ok) {
    console.warn(
      '[ai-manager] MySQL admin/runtime database not reachable - SKIPPING.',
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

type Db = ReturnType<typeof createFreshDatabase>['db'];

function build(db: Db, audit: InMemoryAuditAdapter) {
  return new AiManagerService(
    new DbContextService(db),
    new AiManagerRepository(),
    new AuditService(audit),
  );
}

async function purge(admin: Db): Promise<void> {
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

  await admin.execute(sql`
    DELETE FROM staff
    WHERE id IN (${P.hq}, ${P.bm})
  `);

  await admin.execute(sql`
    DELETE FROM branches
    WHERE id = ${TEST_BRANCH}
  `);

  await admin.execute(sql`
    DELETE FROM organizations
    WHERE id = ${TEST_ORG}
  `);
}

async function seedSupportData(admin: Db): Promise<void> {
  await admin.execute(sql`
    INSERT INTO organizations (id, name)
    VALUES (${TEST_ORG}, 'AI Manager Integration Test')
  `);

  await admin.execute(sql`
    INSERT INTO branches (
      id,
      org_id,
      code,
      short_name,
      full_name
    )
    VALUES (
      ${TEST_BRANCH},
      ${TEST_ORG},
      'ai-test',
      'AI Test',
      'AI Manager Integration Test Branch'
    )
  `);

  await admin.execute(sql`
    INSERT INTO staff (
      id,
      org_id,
      branch_id,
      name,
      username,
      role,
      status
    )
    VALUES
      (
        ${P.hq},
        ${TEST_ORG},
        NULL,
        'HQ AI Test',
        'hq-ai-test',
        'hq',
        'Active'
      ),
      (
        ${P.bm},
        ${TEST_ORG},
        ${TEST_BRANCH},
        'BM AI Test',
        'bm-ai-test',
        'branch_manager',
        'Active'
      )
  `);
}

async function seedCanonicalAi(admin: Db): Promise<void> {
  const agents = [
    {
      key: 'ai-receptionist',
      name: 'AI Receptionist',
      ownerDomain: 'whatsapp',
      draftOnly: false,
    },
    {
      key: 'marketing-ai',
      name: 'Marketing AI',
      ownerDomain: 'marketing',
      draftOnly: true,
    },
    {
      key: 'clinical-ai',
      name: 'Clinical AI',
      ownerDomain: 'clinical',
      draftOnly: true,
    },
    {
      key: 'booking-ai',
      name: 'Booking AI',
      ownerDomain: 'appointments',
      draftOnly: false,
    },
    {
      key: 'finance-ai',
      name: 'Finance AI',
      ownerDomain: 'finance',
      draftOnly: false,
    },
    {
      key: 'inventory-ai',
      name: 'Inventory AI',
      ownerDomain: 'operations',
      draftOnly: true,
    },
    {
      key: 'recall-ai',
      name: 'Recall AI',
      ownerDomain: 'marketing',
      draftOnly: false,
    },
    {
      key: 'insights-ai',
      name: 'Insights AI',
      ownerDomain: 'reports',
      draftOnly: true,
    },
  ] as const;

  const ids = new Map<string, string>();

  for (const agent of agents) {
    const id = randomUUID();
    ids.set(agent.key, id);

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
        ${id},
        ${TEST_ORG},
        ${agent.key},
        ${agent.name},
        ${agent.ownerDomain},
        'enabled',
        'Integration test fixture'
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
          ${id},
          ${agent.ownerDomain},
          ${capability},
          ${agent.draftOnly ? 1 : 0}
        )
      `);
    }
  }

  const marketingId = ids.get('marketing-ai')!;
  const clinicalId = ids.get('clinical-ai')!;

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
    VALUES
      (
        ${randomUUID()},
        ${TEST_ORG},
        ${marketingId},
        'AP-3',
        'HIGH',
        0,
        'Campaign send requires human approval'
      ),
      (
        ${randomUUID()},
        ${TEST_ORG},
        ${clinicalId},
        'AP-4',
        'HIGH',
        0,
        'Clinical sign-off requires doctor approval'
      )
  `);

  await admin.execute(sql`
    INSERT INTO ai_guardrails (
      id,
      org_id,
      agent_id,
      rule_key,
      rule,
      level
    )
    VALUES
      (
        ${randomUUID()},
        ${TEST_ORG},
        NULL,
        'GR-1',
        'AI must not provide medical advice or diagnosis',
        'HARD_BLOCK'
      ),
      (
        ${randomUUID()},
        ${TEST_ORG},
        NULL,
        'GR-5',
        'AI must not send PHI to external model prompts',
        'HARD_BLOCK'
      )
  `);
}

async function withFixture(
  fn: (svc: AiManagerService, audit: InMemoryAuditAdapter) => Promise<void>,
): Promise<void> {
  const admin = createFreshDatabase(ADMIN_URL);

  await purge(admin.db);

  try {
    await seedSupportData(admin.db);
    await seedCanonicalAi(admin.db);

    const runtime = createFreshDatabase(RUNTIME_URL);
    const audit = new InMemoryAuditAdapter();
    const svc = build(runtime.db, audit);

    try {
      await fn(svc, audit);
    } finally {
      await runtime.close();
    }
  } finally {
    await purge(admin.db);
    await admin.close();
  }
}

describe('S7 AI Manager - MySQL isolated integration', () => {
  it('unit: policy engine decision matrix', () => {
    const base = {
      agentStatus: 'enabled' as const,
      agentOwnerDomain: 'whatsapp',
      agentDraftOnly: false,
      grantedCapabilities: [
        'READ',
        'DRAFT',
        'EXECUTE',
      ] as Array<'READ' | 'DRAFT' | 'EXECUTE'>,
      matchedGuardrails: [] as Array<{
        level: 'HARD_BLOCK' | 'APPROVAL_REQUIRED';
      }>,
      approvalRule: null,
      domain: 'whatsapp',
      capability: 'EXECUTE' as const,
    };

    expect(
      evaluatePolicy({
        ...base,
        matchedGuardrails: [{ level: 'HARD_BLOCK' }],
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy({
        ...base,
        agentStatus: 'paused',
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy({
        ...base,
        grantedCapabilities: ['READ'],
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy({
        ...base,
        agentDraftOnly: true,
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy({
        ...base,
        domain: 'admin',
        agentOwnerDomain: 'admin',
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy({
        ...base,
        domain: 'finance',
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy({
        ...base,
        approvalRule: { risk: 'HIGH', auto: false },
      }).decision,
    ).toBe('APPROVAL_REQUIRED');

    expect(
      evaluatePolicy({
        ...base,
        matchedGuardrails: [{ level: 'APPROVAL_REQUIRED' }],
      }).decision,
    ).toBe('APPROVAL_REQUIRED');

    expect(evaluatePolicy(base).decision).toBe('APPROVAL_REQUIRED');

    expect(
      evaluatePolicy(base, {
        medicalAdvice: true,
        phiToExternalModel: false,
        externalModelClassified: false,
      }).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy(
        {
          ...base,
          domain: 'marketing',
          capability: 'DRAFT',
        },
        {
          medicalAdvice: true,
          phiToExternalModel: false,
          externalModelClassified: false,
        },
      ).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy(
        base,
        {
          medicalAdvice: false,
          phiToExternalModel: true,
          externalModelClassified: true,
        },
      ).decision,
    ).toBe('BLOCKED');

    expect(
      evaluatePolicy(
        {
          ...base,
          approvalRule: { risk: 'LOW', auto: true },
        },
        {
          medicalAdvice: false,
          phiToExternalModel: false,
          externalModelClassified: true,
        },
      ).decision,
    ).toBe('AUTO');

    expect(
      evaluatePolicy({
        ...base,
        capability: 'DRAFT',
      }).decision,
    ).toBe('DRAFT');

    expect(
      evaluatePolicy({
        ...base,
        capability: 'READ',
      }).decision,
    ).toBe('AUTO');
  });

  it('unit: agent lifecycle transitions', () => {
    expect(canTransitionAiAgent('registered', 'enabled')).toBe(true);
    expect(canTransitionAiAgent('enabled', 'paused')).toBe(true);
    expect(canTransitionAiAgent('paused', 'enabled')).toBe(true);
    expect(canTransitionAiAgent('enabled', 'archived')).toBe(true);
    expect(canTransitionAiAgent('archived', 'enabled')).toBe(false);
    expect(canTransitionAiAgent('registered', 'paused')).toBe(false);
  });

  dbIt(
    'isolated canonical fixture has 8 agents, GR-1/GR-5 and AP-3/AP-4',
    async () => {
      await withFixture(async (svc) => {
        const agents = await svc.listAgents(hq);

        expect(agents).toHaveLength(8);
        expect(
          new Set(agents.map((agent) => agent.ownerDomain)).size,
        ).toBeGreaterThanOrEqual(7);

        const guardrails = await svc.listGuardrails(hq);

        expect(
          guardrails.map((guardrail) => guardrail.ruleKey).sort(),
        ).toEqual(['GR-1', 'GR-5']);

        expect(
          guardrails.every(
            (guardrail) =>
              guardrail.level === 'HARD_BLOCK' &&
              guardrail.agentId === null,
          ),
        ).toBe(true);

        const rules = await svc.listApprovalRules(hq);

        expect(
          rules.map((rule) => rule.actionKey).sort(),
        ).toEqual(['AP-3', 'AP-4']);

        expect(
          rules.every(
            (rule) =>
              rule.risk === 'HIGH' &&
              rule.auto === false,
          ),
        ).toBe(true);
      });
    },
  );

  dbIt(
    'RBAC service rules: BM view-only, HQ config, org isolation explicit',
    async () => {
      await withFixture(async (svc) => {
        const agent = await svc.registerAgent(hq, {
          key: 'test-agent',
          name: 'Test Agent',
          ownerDomain: 'operations',
        });

        const bmList = await svc.listAgents(bm);

        expect(
          bmList.map((row) => row.id),
        ).toContain(agent.id);

        await expect(
          svc.registerAgent(bm, {
            key: 'x',
            name: 'X Y',
            ownerDomain: 'finance',
          }),
        ).rejects.toBeInstanceOf(ForbiddenError);

        await expect(
          svc.transitionAgent(bm, agent.id, 'enable'),
        ).rejects.toBeInstanceOf(ForbiddenError);

        await expect(
          svc.grantCapability(bm, agent.id, {
            domain: 'operations',
            capability: 'READ',
          }),
        ).rejects.toBeInstanceOf(ForbiddenError);

        expect(await svc.listAgents(otherHq)).toEqual([]);
      });
    },
  );

  dbIt(
    'agent lifecycle works with MySQL returning compatibility',
    async () => {
      await withFixture(async (svc) => {
        const agent = await svc.registerAgent(hq, {
          key: 'lifecycle-agent',
          name: 'Life Agent',
          ownerDomain: 'finance',
        });

        expect(agent.status).toBe('registered');

        await expect(
          svc.transitionAgent(hq, agent.id, 'pause'),
        ).rejects.toBeInstanceOf(ConflictError);

        let row = await svc.transitionAgent(
          hq,
          agent.id,
          'enable',
        );

        expect(row.status).toBe('enabled');

        row = await svc.transitionAgent(
          hq,
          agent.id,
          'pause',
        );

        expect(row.status).toBe('paused');

        row = await svc.transitionAgent(
          hq,
          agent.id,
          'enable',
        );

        expect(row.status).toBe('enabled');

        row = await svc.transitionAgent(
          hq,
          agent.id,
          'archive',
        );

        expect(row.status).toBe('archived');

        await expect(
          svc.transitionAgent(hq, agent.id, 'enable'),
        ).rejects.toBeInstanceOf(ConflictError);

        const log = await svc.listAudit(
          hq,
          agent.id,
          {},
        );

        expect(log.length).toBeGreaterThanOrEqual(4);
      });
    },
  );

  dbIt(
    'policy evaluation handles draft-only, approval, guardrails and audit',
    async () => {
      await withFixture(async (svc) => {
        let result = await svc.evaluate(hq, {
          agentKey: 'marketing-ai',
          domain: 'marketing',
          capability: 'EXECUTE',
          actionKey: 'AP-3',
        });

        expect(result.decision).toBe('BLOCKED');

        result = await svc.evaluate(hq, {
          agentKey: 'marketing-ai',
          domain: 'marketing',
          capability: 'DRAFT',
        });

        expect(result.decision).toBe('DRAFT');

        result = await svc.evaluate(hq, {
          agentKey: 'clinical-ai',
          domain: 'clinical',
          capability: 'EXECUTE',
          actionKey: 'AP-4',
        });

        expect(result.decision).toBe('BLOCKED');

        result = await svc.evaluate(hq, {
          agentKey: 'booking-ai',
          domain: 'appointments',
          capability: 'EXECUTE',
        });

        expect(result.decision).toBe(
          'APPROVAL_REQUIRED',
        );

        result = await svc.evaluate(hq, {
          agentKey: 'booking-ai',
          domain: 'appointments',
          capability: 'READ',
        });

        expect(result.decision).toBe('AUTO');

        const log = await svc.listAudit(
          hq,
          undefined,
          {},
        );

        expect(
          log.filter(
            (entry) =>
              entry.action === 'policy_evaluated',
          ).length,
        ).toBeGreaterThanOrEqual(5);
      });
    },
  );

  dbIt(
    'GR-1 medical advice remains domain-independent',
    async () => {
      await withFixture(async (svc) => {
        for (const domain of [
          'clinical',
          'whatsapp',
          'patients',
          'marketing',
        ]) {
          const result = await svc.evaluate(hq, {
            agentKey: 'clinical-ai',
            domain,
            capability: 'DRAFT',
            actionKey: 'clinical.medical_advice',
          });

          expect(result.decision).toBe('BLOCKED');
          expect(result.reason).toMatch(/GR-1/);
        }

        const read = await svc.evaluate(hq, {
          agentKey: 'clinical-ai',
          domain: 'patients',
          capability: 'READ',
          actionKey: 'clinical.diagnosis',
        });

        expect(read.decision).toBe('BLOCKED');
      });
    },
  );

  dbIt(
    'GR-5 blocks PHI external model and HIGH risk remains approval-required',
    async () => {
      await withFixture(async (svc) => {
        let result = await svc.evaluate(hq, {
          agentKey: 'ai-receptionist',
          domain: 'whatsapp',
          capability: 'EXECUTE',
          actionKey: 'ai.external_prompt',
        });

        expect(result.decision).toBe('BLOCKED');
        expect(result.reason).toMatch(/GR-5/);

        result = await svc.evaluate(hq, {
          agentKey: 'ai-receptionist',
          domain: 'whatsapp',
          capability: 'EXECUTE',
          actionKey: 'wa.send_reminder',
        });

        expect(result.decision).toBe(
          'APPROVAL_REQUIRED',
        );

        result = await svc.evaluate(hq, {
          agentKey: 'marketing-ai',
          domain: 'marketing',
          capability: 'DRAFT',
          actionKey: 'AP-3',
        });

        expect(result.decision).toBe(
          'APPROVAL_REQUIRED',
        );
      });
    },
  );

  dbIt(
    'capability rules plus knowledge and automation metadata work',
    async () => {
      await withFixture(async (svc) => {
        const agent = await svc.registerAgent(hq, {
          key: 'grant-agent',
          name: 'Grant Agent',
          ownerDomain: 'operations',
        });

        await svc.grantCapability(hq, agent.id, {
          domain: 'finance',
          capability: 'READ',
        });

        await expect(
          svc.grantCapability(hq, agent.id, {
            domain: 'finance',
            capability: 'EXECUTE',
          }),
        ).rejects.toBeInstanceOf(ForbiddenError);

        const knowledge = await svc.addKnowledge(
          hq,
          agent.id,
          {
            item: 'SOP inventory reorder',
            type: 'static',
            sourceDomain: 'operations',
            sourceRef: 'ops:sop:inventory',
          },
        );

        expect(knowledge.sourceRef).toBe(
          'ops:sop:inventory',
        );

        const automation =
          await svc.createAutomation(
            hq,
            agent.id,
            {
              triggerKey: 'cron.daily',
              actionKey: 'inventory.suggest',
              enabled: false,
            },
          );

        const toggled =
          await svc.toggleAutomation(
            hq,
            automation.id,
            true,
          );

        expect(toggled.enabled).toBe(true);

        const log = await svc.listAudit(
          hq,
          agent.id,
          {},
        );

        expect(
          log.some(
            (entry) =>
              entry.action === 'automation_enabled',
          ),
        ).toBe(true);
      });
    },
  );

  dbIt(
    'unknown agent is NotFound and duplicate key is Conflict',
    async () => {
      await withFixture(async (svc) => {
        await expect(
          svc.evaluate(hq, {
            agentKey: 'ghost',
            domain: 'finance',
            capability: 'READ',
          }),
        ).rejects.toBeInstanceOf(NotFoundError);

        await svc.registerAgent(hq, {
          key: 'dup',
          name: 'Dup Agent',
          ownerDomain: 'finance',
        });

        await expect(
          svc.registerAgent(hq, {
            key: 'dup',
            name: 'Dup2',
            ownerDomain: 'finance',
          }),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    },
  );
});