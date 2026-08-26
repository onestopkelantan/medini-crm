import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { AiManagerRepository } from '@modules/ai-manager/infrastructure/ai-manager.repository';
import { AiManagerService } from '@modules/ai-manager/application/ai-manager.service';
import { canTransitionAiAgent, evaluatePolicy } from '@modules/ai-manager/domain/ai-manager-policy';
import { ForbiddenError, ConflictError, NotFoundError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000703';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const P = {
  hq: '70d1f1a3-0000-4000-8000-0000000000a1',
  bm: '70d1f1a3-0000-4000-8000-0000000000bb',
  ba: '70d1f1a3-0000-4000-8000-0000000000cc',
  dr: '70d1f1a3-0000-4000-8000-0000000000dd',
};
const hq = { staffId: P.hq, username: 'hq-s7a', role: 'hq', orgId: TEST_ORG, branchId: null, doctorId: null };
const bm = (b: string) => ({ staffId: P.bm, username: 'bm-s7a', role: 'branch_manager', orgId: TEST_ORG, branchId: b, doctorId: null });
const ba = (b: string) => ({ staffId: P.ba, username: 'ba-s7a', role: 'branch_admin', orgId: TEST_ORG, branchId: b, doctorId: null });
const doc = (b: string) => ({ staffId: P.dr, username: 'dr-s7a', role: 'doctor', orgId: TEST_ORG, branchId: b, doctorId: P.dr });

function build(db: ReturnType<typeof createFreshDatabase>['db'], audit: InMemoryAuditAdapter) {
  return new AiManagerService(new DbContextService(db), new AiManagerRepository(), new AuditService(audit));
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  for (const t of ['ai_audit_log', 'ai_approval_rules', 'ai_guardrails', 'ai_automations', 'ai_knowledge', 'ai_capabilities', 'ai_agents']) {
    await admin.execute(sql`DELETE FROM ${sql.raw(t)} WHERE org_id=${TEST_ORG}`);
  }
  await admin.execute(sql`DELETE FROM staff WHERE id IN (${P.hq},${P.bm},${P.ba},${P.dr})`);
}
async function seedStaff(admin: ReturnType<typeof createFreshDatabase>['db']) {
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
  const b1 = (rows as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  await admin.execute(sql`DELETE FROM staff WHERE id IN (${P.hq},${P.bm},${P.ba},${P.dr})`);
  await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
    (${P.hq}, ${TEST_ORG}, NULL, 'HQ A', 'hq-s7a-fixed', 'hq', 'Active'),
    (${P.bm}, ${TEST_ORG}, ${b1}, 'BM A', 'bm-s7a-fixed', 'branch_manager', 'Active'),
    (${P.ba}, ${TEST_ORG}, ${b1}, 'BA A', 'ba-s7a-fixed', 'branch_admin', 'Active'),
    (${P.dr}, ${TEST_ORG}, ${b1}, 'DR A', 'dr-s7a-fixed', 'doctor', 'Active')`);
  return { b1 };
}

describe('S7 AI Manager — governance plane + policy engine (unique org per suite)', () => {
  /* ---------- pure policy engine unit tests ---------- */
  it('unit: policy engine decision matrix', () => {
    const base = {
      agentStatus: 'enabled' as const, agentOwnerDomain: 'whatsapp', agentDraftOnly: false,
      grantedCapabilities: ['READ', 'DRAFT', 'EXECUTE'] as Array<'READ' | 'DRAFT' | 'EXECUTE'>,
      matchedGuardrails: [] as Array<{ level: 'HARD_BLOCK' | 'APPROVAL_REQUIRED' }>,
      approvalRule: null, domain: 'whatsapp', capability: 'EXECUTE' as const,
    };
    /* HARD_BLOCK guardrail beats everything */
    expect(evaluatePolicy({ ...base, matchedGuardrails: [{ level: 'HARD_BLOCK' }] }).decision).toBe('BLOCKED');
    /* paused agent blocked */
    expect(evaluatePolicy({ ...base, agentStatus: 'paused' }).decision).toBe('BLOCKED');
    /* capability not granted */
    expect(evaluatePolicy({ ...base, grantedCapabilities: ['READ'] }).decision).toBe('BLOCKED');
    /* draft-only agent cannot EXECUTE */
    expect(evaluatePolicy({ ...base, agentDraftOnly: true }).decision).toBe('BLOCKED');
    /* administration is HUMAN-ONLY EXECUTE */
    expect(evaluatePolicy({ ...base, domain: 'admin', agentOwnerDomain: 'admin' }).decision).toBe('BLOCKED');
    /* non-owner domain EXECUTE blocked */
    expect(evaluatePolicy({ ...base, domain: 'finance' }).decision).toBe('BLOCKED');
    /* HIGH-risk non-auto → APPROVAL_REQUIRED */
    expect(evaluatePolicy({ ...base, approvalRule: { risk: 'HIGH', auto: false } }).decision).toBe('APPROVAL_REQUIRED');
    /* APPROVAL_REQUIRED guardrail */
    expect(evaluatePolicy({ ...base, matchedGuardrails: [{ level: 'APPROVAL_REQUIRED' }] }).decision).toBe('APPROVAL_REQUIRED');
    /* clean EXECUTE in owner domain, unclassified → APPROVAL_REQUIRED (N7-4 fail-closed) */
    expect(evaluatePolicy(base).decision).toBe('APPROVAL_REQUIRED');
    /* N7-3: GR-1 medical advice BLOCKED in ANY domain/capability */
    expect(evaluatePolicy(base, { medicalAdvice: true, phiToExternalModel: false, externalModelClassified: false }).decision).toBe('BLOCKED');
    expect(evaluatePolicy({ ...base, domain: 'marketing', capability: 'DRAFT' }, { medicalAdvice: true, phiToExternalModel: false, externalModelClassified: false }).decision).toBe('BLOCKED');
    expect(evaluatePolicy({ ...base, capability: 'READ' }, { medicalAdvice: true, phiToExternalModel: false, externalModelClassified: false }).decision).toBe('BLOCKED');
    /* N7-4: GR-5 PHI→external model BLOCKED */
    expect(evaluatePolicy(base, { medicalAdvice: false, phiToExternalModel: true, externalModelClassified: true }).decision).toBe('BLOCKED');
    /* N7-4: classified non-PHI EXECUTE in owner domain with auto rule → AUTO */
    expect(evaluatePolicy({ ...base, approvalRule: { risk: 'LOW', auto: true } }, { medicalAdvice: false, phiToExternalModel: false, externalModelClassified: true }).decision).toBe('AUTO');
    /* DRAFT capability → DRAFT */
    expect(evaluatePolicy({ ...base, capability: 'DRAFT' }).decision).toBe('DRAFT');
    /* READ → AUTO */
    expect(evaluatePolicy({ ...base, capability: 'READ' }).decision).toBe('AUTO');
  });
  it('unit: agent lifecycle transitions', () => {
    expect(canTransitionAiAgent('registered', 'enabled')).toBe(true);
    expect(canTransitionAiAgent('enabled', 'paused')).toBe(true);
    expect(canTransitionAiAgent('paused', 'enabled')).toBe(true);
    expect(canTransitionAiAgent('enabled', 'archived')).toBe(true);
    expect(canTransitionAiAgent('archived', 'enabled')).toBe(false);
    expect(canTransitionAiAgent('registered', 'paused')).toBe(false);
  });

  /* ---------- integration ---------- */
  dbIt('seeded canonical state: 8 agents, GR-1/GR-5 global, AP-3/AP-4 HIGH non-auto', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    /* HQ sees the canonical org agents (single-tenant canonical org). */
    const canonicalHq = { ...hq, orgId: '00000000-0000-0000-0000-000000000001' };
    const agents = await svc.listAgents(canonicalHq);
    expect(agents.length).toBe(8);
    expect(new Set(agents.map((a) => a.ownerDomain)).size).toBeGreaterThanOrEqual(7);
    const guardrails = await svc.listGuardrails(canonicalHq);
    expect(guardrails.map((g) => g.ruleKey).sort()).toEqual(['GR-1', 'GR-5']);
    expect(guardrails.every((g) => g.level === 'HARD_BLOCK' && g.agentId === null)).toBe(true);
    const rules = await svc.listApprovalRules(canonicalHq);
    expect(rules.map((r) => r.actionKey).sort()).toEqual(['AP-3', 'AP-4']);
    expect(rules.every((r) => r.risk === 'HIGH' && r.auto === false)).toBe(true);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('RBAC: BM view-only; BA/doctor NONE at RLS layer; HQ config only', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); const s = await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const agent = await svc.registerAgent(hq, { key: 'test-agent', name: 'Test Agent', ownerDomain: 'operations' });
    /* BM can view */
    const bmList = await svc.listAgents(bm(s.b1));
    expect(bmList.map((a) => a.id)).toContain(agent.id);
    /* BM cannot configure */
    await expect(svc.registerAgent(bm(s.b1), { key: 'x', name: 'X Y', ownerDomain: 'finance' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.transitionAgent(bm(s.b1), agent.id, 'enable')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.grantCapability(bm(s.b1), agent.id, { domain: 'operations', capability: 'READ' })).rejects.toBeInstanceOf(ForbiddenError);
    /* BA/doctor: RLS returns zero rows (fail-closed) */
    expect(await svc.listAgents(ba(s.b1))).toEqual([]);
    expect(await svc.listAgents(doc(s.b1))).toEqual([]);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('agent lifecycle: register→enable→pause→enable→archive + invalid transitions', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const agent = await svc.registerAgent(hq, { key: 'lifecycle-agent', name: 'Life Agent', ownerDomain: 'finance' });
    expect(agent.status).toBe('registered');
    await expect(svc.transitionAgent(hq, agent.id, 'pause')).rejects.toBeInstanceOf(ConflictError);
    let r = await svc.transitionAgent(hq, agent.id, 'enable');
    expect(r.status).toBe('enabled');
    r = await svc.transitionAgent(hq, agent.id, 'pause');
    expect(r.status).toBe('paused');
    r = await svc.transitionAgent(hq, agent.id, 'enable');
    expect(r.status).toBe('enabled');
    r = await svc.transitionAgent(hq, agent.id, 'archive');
    expect(r.status).toBe('archived');
    await expect(svc.transitionAgent(hq, agent.id, 'enable')).rejects.toBeInstanceOf(ConflictError);
    /* audit trail in ai_audit_log */
    const log = await svc.listAudit(hq, agent.id, {});
    expect(log.length).toBeGreaterThanOrEqual(4);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('policy evaluation: draft-only agent EXECUTE blocked; HIGH-risk APPROVAL_REQUIRED; paused agent blocked; audit written', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const canonicalHq = { ...hq, orgId: '00000000-0000-0000-0000-000000000001' };
    /* EXECUTE by marketing-ai → BLOCKED (draft-only) */
    let res = await svc.evaluate(canonicalHq, { agentKey: 'marketing-ai', domain: 'marketing', capability: 'EXECUTE', actionKey: 'AP-3' });
    expect(res.decision).toBe('BLOCKED');
    /* DRAFT by marketing-ai → DRAFT */
    res = await svc.evaluate(canonicalHq, { agentKey: 'marketing-ai', domain: 'marketing', capability: 'DRAFT' });
    expect(res.decision).toBe('DRAFT');
    /* clinical-ai EXECUTE AP-4 → GR-1 BLOCKED (AP-4 classified medical advice) */
    res = await svc.evaluate(canonicalHq, { agentKey: 'clinical-ai', domain: 'clinical', capability: 'EXECUTE', actionKey: 'AP-4' });
    expect(res.decision).toBe('BLOCKED');
    /* booking-ai EXECUTE in owner domain, unclassified → APPROVAL_REQUIRED (N7-4 fail-closed, no longer blanket BLOCKED) */
    res = await svc.evaluate(canonicalHq, { agentKey: 'booking-ai', domain: 'appointments', capability: 'EXECUTE' });
    expect(res.decision).toBe('APPROVAL_REQUIRED');
    /* booking-ai READ → AUTO */
    res = await svc.evaluate(canonicalHq, { agentKey: 'booking-ai', domain: 'appointments', capability: 'READ' });
    expect(res.decision).toBe('AUTO');
    /* policy evaluations audited */
    const log = await svc.listAudit(canonicalHq, undefined, {});
    expect(log.filter((l) => l.action === 'policy_evaluated').length).toBeGreaterThanOrEqual(5);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('N7-3 regression: GR-1 medical advice BLOCKED in EVERY domain (domain-independent)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const canonicalHq = { ...hq, orgId: '00000000-0000-0000-0000-000000000001' };
    /* the SAME medical-advice action key must be BLOCKED regardless of domain */
    for (const domain of ['clinical', 'whatsapp', 'patients', 'marketing']) {
      const res = await svc.evaluate(canonicalHq, { agentKey: 'clinical-ai', domain, capability: 'DRAFT', actionKey: 'clinical.medical_advice' });
      expect(res.decision).toBe('BLOCKED');
      expect(res.reason).toMatch(/GR-1/);
    }
    /* and regardless of capability (READ included — content-level block) */
    const read = await svc.evaluate(canonicalHq, { agentKey: 'clinical-ai', domain: 'patients', capability: 'READ', actionKey: 'clinical.diagnosis' });
    expect(read.decision).toBe('BLOCKED');
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('N7-4 regression: GR-5 PHI→external-model BLOCKED; unclassified EXECUTE fail-closed; HIGH→APPROVAL_REQUIRED', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const canonicalHq = { ...hq, orgId: '00000000-0000-0000-0000-000000000001' };
    /* PHI + external model → BLOCKED (GR-5) */
    let res = await svc.evaluate(canonicalHq, { agentKey: 'ai-receptionist', domain: 'whatsapp', capability: 'EXECUTE', actionKey: 'ai.external_prompt' });
    expect(res.decision).toBe('BLOCKED');
    expect(res.reason).toMatch(/GR-5/);
    /* unclassified EXECUTE → fail-closed APPROVAL_REQUIRED (not blanket BLOCKED) */
    res = await svc.evaluate(canonicalHq, { agentKey: 'ai-receptionist', domain: 'whatsapp', capability: 'EXECUTE', actionKey: 'wa.send_reminder' });
    expect(res.decision).toBe('APPROVAL_REQUIRED');
    /* HIGH-risk action with approval rule → APPROVAL_REQUIRED */
    res = await svc.evaluate(canonicalHq, { agentKey: 'marketing-ai', domain: 'marketing', capability: 'DRAFT', actionKey: 'AP-3' });
    expect(res.decision).toBe('APPROVAL_REQUIRED');
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('capability grant rules: EXECUTE outside owner domain rejected; knowledge + automation metadata + toggle audit', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const agent = await svc.registerAgent(hq, { key: 'grant-agent', name: 'Grant Agent', ownerDomain: 'operations' });
    /* READ in foreign domain OK; EXECUTE in foreign domain rejected */
    await svc.grantCapability(hq, agent.id, { domain: 'finance', capability: 'READ' });
    await expect(svc.grantCapability(hq, agent.id, { domain: 'finance', capability: 'EXECUTE' })).rejects.toBeInstanceOf(ForbiddenError);
    /* knowledge metadata */
    const k = await svc.addKnowledge(hq, agent.id, { item: 'SOP inventory reorder', type: 'static', sourceDomain: 'operations', sourceRef: 'ops:sop:inventory' });
    expect(k.sourceRef).toBe('ops:sop:inventory');
    /* automation metadata + toggle + ai_audit_log entry */
    const auto = await svc.createAutomation(hq, agent.id, { triggerKey: 'cron.daily', actionKey: 'inventory.suggest', enabled: false });
    const toggled = await svc.toggleAutomation(hq, auto.id, true);
    expect(toggled.enabled).toBe(true);
    const log = await svc.listAudit(hq, agent.id, {});
    expect(log.some((l) => l.action === 'automation_enabled')).toBe(true);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('unknown agent evaluate → NotFound; duplicate agent key → Conflict', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db); await seedStaff(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    await expect(svc.evaluate(hq, { agentKey: 'ghost', domain: 'finance', capability: 'READ' })).rejects.toBeInstanceOf(NotFoundError);
    await svc.registerAgent(hq, { key: 'dup', name: 'Dup Agent', ownerDomain: 'finance' });
    await expect(svc.registerAgent(hq, { key: 'dup', name: 'Dup2', ownerDomain: 'finance' })).rejects.toBeInstanceOf(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });
});
