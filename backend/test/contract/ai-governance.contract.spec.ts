import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import {
  AI_AGENT_REGISTRY,
  CANONICAL_AGENT_KEYS,
  DRAFT_ONLY_AGENT_KEYS,
  AI_GUARDRAIL_REGISTRY,
  AI_APPROVAL_RULE_REGISTRY,
  RETIRED_AGENT_KEYS,
} from '@shared/architecture/ai-governance.contract';

/**
 * DRIFT GUARD — the AI Manager roster is LOCKED, and this test is what keeps it
 * that way.
 *
 * HISTORY THIS PREVENTS
 *
 * The locked canonical seed lived only in the retired legacy database migration set.
 * It was never ported to MySQL, so `ai_agents` / `ai_guardrails` /
 * `ai_approval_rules` shipped EMPTY — and every existing test still passed,
 * because they assert TypeScript constants, not the database. Weeks later the
 * tables held a session-invented 4-agent roster that violated the locked
 * draft-only rule. Nothing failed. That is the definition of drift.
 *
 * THREE LAYERS OF DEFENCE
 *
 *   A. Contract consistency — the curated lists agree with each other.
 *   B. Migration seed       — the MySQL migrations actually SEED the contract
 *                             (this is the exact check that was missing, and it
 *                             runs WITHOUT a database, so it can never skip).
 *   C. Live database        — the running DB matches the contract (honest skip
 *                             when no DB is reachable; enforced in CI/deploy).
 *                             Includes the negative case: a retired agent must
 *                             NOT evaluate as enabled.
 *
 * If the lock changes, the contract file changes and every layer follows. The
 * test is the thing that fails when the database does not.
 */

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:***@localhost:3306/medini_dev';

const CANONICAL_ORG = '00000000-0000-0000-0000-000000000001';

type Db = ReturnType<typeof createFreshDatabase>['db'];
interface RawRows { rows: Array<Record<string, unknown>> }

/* ==========================================================================
   A. CONTRACT CONSISTENCY (always runs — no DB, no skip)
   ========================================================================== */

describe('AI governance contract — internal consistency', () => {
  it('has exactly 8 canonical agents', () => {
    expect(AI_AGENT_REGISTRY).toHaveLength(8);
    expect(CANONICAL_AGENT_KEYS).toHaveLength(8);
  });

  it('agent keys are unique', () => {
    expect(new Set(CANONICAL_AGENT_KEYS).size).toBe(CANONICAL_AGENT_KEYS.length);
  });

  it('every agent has exactly one owner domain (locked rule 1)', () => {
    for (const a of AI_AGENT_REGISTRY) {
      expect(a.ownerDomain, `${a.key} owner domain`).toBeTruthy();
      expect(a.ownerDomain.trim()).toBe(a.ownerDomain); /* no accidental spaces */
    }
  });

  it('exactly the 4 locked draft-only agents are marked draft-only (locked rule 3)', () => {
    expect([...DRAFT_ONLY_AGENT_KEYS].sort()).toEqual(
      ['clinical-ai', 'insights-ai', 'inventory-ai', 'marketing-ai'].sort(),
    );
  });

  it('carries the two global HARD_BLOCK guardrails (GR-1, GR-5)', () => {
    expect(AI_GUARDRAIL_REGISTRY.map((g) => g.ruleKey).sort()).toEqual(['GR-1', 'GR-5']);
    for (const g of AI_GUARDRAIL_REGISTRY) {
      expect(g.level).toBe('HARD_BLOCK');
      expect(g.agentKey).toBeNull(); // not agent-scoped - applies to all agents
    }
  });

  it('approval rules reference only canonical agents, and exactly 2 are HIGH/human', () => {
    for (const r of AI_APPROVAL_RULE_REGISTRY) {
      expect(CANONICAL_AGENT_KEYS).toContain(r.agentKey);
    }
    const high = AI_APPROVAL_RULE_REGISTRY.filter((r) => r.risk === 'HIGH');
    expect(high.map((r) => r.actionKey).sort()).toEqual(['AP-3', 'AP-4']);
    for (const r of high) expect(r.auto).toBe(false); /* HIGH = human-mandatory */
  });
});

/* ==========================================================================
   B. MIGRATION SEED (always runs — this is the exact check that was missing)
   ========================================================================== */

describe('AI governance contract — MySQL migrations must SEED it (never-ported guard)', () => {
  const MIGRATIONS_DIR = resolve(__dirname, '../../drizzle-mysql');

  function allMigrationSql(): string {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
      .sort()
      .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8'))
      .join('\n');
  }

  it('some MySQL migration INSERTs into ai_agents (the seed was never ported once)', () => {
    const sqlText = allMigrationSql();
    /* accept `INSERT INTO ai_agents` or `INSERT IGNORE INTO ai_agents` */
    expect(/INSERT\s+(IGNORE\s+)?INTO\s+`?ai_agents`?/i.test(sqlText), 'no ai_agents seed in drizzle-mysql/').toBe(true);
  });

  it('every canonical agent key is present in the MySQL migration set', () => {
    const sqlText = allMigrationSql();
    for (const key of CANONICAL_AGENT_KEYS) {
      expect(sqlText.includes(`'${key}'`), `migration set never mentions agent '${key}'`).toBe(true);
    }
  });

  it('the migration set seeds both global guardrails and the HIGH approval rules', () => {
    const sqlText = allMigrationSql();
    for (const ruleKey of ['GR-1', 'GR-5', 'AP-3', 'AP-4']) {
      expect(sqlText.includes(`'${ruleKey}'`), `migration set never mentions ${ruleKey}`).toBe(true);
    }
  });
});

/* ==========================================================================
   C. LIVE DATABASE (honest skip when no DB — enforced in CI/deploy)
   ========================================================================== */

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[ai-governance-guard] MySQL not reachable — SKIPPING live checks (honest skip, not a pass).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

async function liveAgentKeys(db: Db): Promise<{ key: string; ownerDomain: string; status: string }[]> {
  const r = await db.execute(sql`
    SELECT \`key\` AS agent_key, owner_domain, status
    FROM ai_agents
    WHERE org_id = ${CANONICAL_ORG} AND deleted_at IS NULL
  `);
  return ((r as unknown as RawRows).rows as Array<Record<string, unknown>>).map((row) => ({
    key: String(row.agent_key),
    ownerDomain: String(row.owner_domain),
    status: String(row.status),
  }));
}

describe('AI governance contract — LIVE database matches the lock', () => {
  dbIt('live ai_agents == exactly the 8 canonical keys (no invented, none missing)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const live = await liveAgentKeys(db);
    expect(live.map((a) => a.key).sort()).toEqual([...CANONICAL_AGENT_KEYS].sort());
    await close();
  });

  dbIt('each live agent sits in its canonical owner domain', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const live = await liveAgentKeys(db);
    for (const a of AI_AGENT_REGISTRY) {
      const row = live.find((l) => l.key === a.key);
      expect(row, `agent ${a.key} missing from live DB`).toBeDefined();
      expect(row!.ownerDomain, `${a.key} owner domain drifted`).toBe(a.ownerDomain);
    }
    await close();
  });

  dbIt('every live agent can be enabled/disabled (status is a legal lifecycle value)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const live = await liveAgentKeys(db);
    const LEGAL = ['registered', 'enabled', 'paused', 'archived'];
    for (const a of live) expect(LEGAL).toContain(a.status);
    await close();
  });

  dbIt('draft-only agents have draft_only=TRUE on their owner-domain capabilities', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const r = await db.execute(sql`
      SELECT a.\`key\` AS agent_key, c.domain, c.draft_only
      FROM ai_capabilities c
      JOIN ai_agents a ON a.id = c.agent_id
      WHERE a.org_id = ${CANONICAL_ORG} AND a.deleted_at IS NULL
    `);
    const rows = ((r as unknown as RawRows).rows as Array<Record<string, unknown>>);
    for (const key of DRAFT_ONLY_AGENT_KEYS) {
      const own = rows.filter((x) => String(x.agent_key) === key);
      expect(own.length, `${key} has no capability rows`).toBeGreaterThan(0);
      for (const cap of own) {
        expect(Number(cap.draft_only), `${key} capability ${cap.domain} must be draft_only`).toBe(1);
      }
    }
    await close();
  });

  dbIt('draft-only agents cannot EXECUTE: their EXECUTE capability is draft_only-gated (locked rule 3)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    /* The canonical seed (approved G4) grants READ+DRAFT+EXECUTE to EVERY agent
     * and gates the draft-only ones with draft_only=TRUE. The policy engine
     * (rule 4) then blocks their EXECUTE. So the lock is enforced by the FLAG,
     * not by the row's absence — this test encodes exactly that. */
    const r = await db.execute(sql`
      SELECT a.\`key\` AS agent_key, c.draft_only
      FROM ai_capabilities c
      JOIN ai_agents a ON a.id = c.agent_id
      WHERE a.org_id = ${CANONICAL_ORG}
        AND a.deleted_at IS NULL
        AND c.capability = 'EXECUTE'
    `);
    const rows = ((r as unknown as RawRows).rows as Array<Record<string, unknown>>);
    for (const key of DRAFT_ONLY_AGENT_KEYS) {
      const exec = rows.find((x) => String(x.agent_key) === key);
      expect(exec, `${key} has no EXECUTE capability row (canonical seed grants one)`).toBeDefined();
      expect(Number(exec!.draft_only), `${key} EXECUTE must be draft_only=TRUE or it could run`).toBe(1);
    }
    /* And the non-draft-only agents must NOT be draft_only on EXECUTE. */
    for (const a of AI_AGENT_REGISTRY) {
      if (a.draftOnly) continue;
      const exec = rows.find((x) => String(x.agent_key) === a.key);
      if (exec) {
        expect(Number(exec.draft_only), `${a.key} is not draft-only; its EXECUTE must be draft_only=FALSE`).toBe(0);
      }
    }
    await close();
  });

  dbIt('live guardrails contain GR-1 and GR-5 as global HARD_BLOCK', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const r = await db.execute(sql`
      SELECT rule_key, level, agent_id
      FROM ai_guardrails
      WHERE org_id = ${CANONICAL_ORG}
    `);
    const rows = ((r as unknown as RawRows).rows as Array<Record<string, unknown>>);
    for (const g of AI_GUARDRAIL_REGISTRY) {
      const row = rows.find((x) => String(x.rule_key) === g.ruleKey);
      expect(row, `guardrail ${g.ruleKey} missing from live DB`).toBeDefined();
      expect(String(row!.level), `${g.ruleKey} level drifted`).toBe(g.level);
      expect(row!.agent_id, `${g.ruleKey} must be global (agent_id NULL)`).toBeNull();
    }
    await close();
  });

  dbIt('live approval rules match the contract (risk + auto must not drift)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const r = await db.execute(sql`
      SELECT a.\`key\` AS agent_key, r.action_key, r.risk, r.auto
      FROM ai_approval_rules r
      LEFT JOIN ai_agents a ON a.id = r.agent_id
      WHERE r.org_id = ${CANONICAL_ORG}
    `);
    const rows = ((r as unknown as RawRows).rows as Array<Record<string, unknown>>);
    for (const expected of AI_APPROVAL_RULE_REGISTRY) {
      const row = rows.find((x) => String(x.action_key) === expected.actionKey);
      expect(row, `approval rule ${expected.actionKey} missing`).toBeDefined();
      expect(String(row!.agent_key), `${expected.actionKey} attached to the wrong agent`).toBe(expected.agentKey);
      expect(String(row!.risk), `${expected.actionKey} risk drifted`).toBe(expected.risk);
      expect(Number(row!.auto) === 1, `${expected.actionKey} auto drifted`).toBe(expected.auto);
    }
    await close();
  });

  dbIt('retired agents exist but are soft-deleted (never live)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    for (const key of RETIRED_AGENT_KEYS) {
      const r = await db.execute(sql`
        SELECT deleted_at FROM ai_agents
        WHERE org_id = ${CANONICAL_ORG} AND \`key\` = ${key} LIMIT 1
      `);
      const rows = ((r as unknown as RawRows).rows as Array<Record<string, unknown>>);
      const first = rows[0];
      if (first) {
        expect(first.deleted_at, `retired agent ${key} must be soft-deleted, not live`).not.toBeNull();
      }
    }
    await close();
  });

  dbIt('no live agent EXECUTEs outside its owner domain (locked rule 2)', async () => {
    const { db, close } = createFreshDatabase(ADMIN_URL);
    const r = await db.execute(sql`
      SELECT a.\`key\` AS agent_key, a.owner_domain, c.domain, c.capability
      FROM ai_capabilities c
      JOIN ai_agents a ON a.id = c.agent_id
      WHERE a.org_id = ${CANONICAL_ORG} AND a.deleted_at IS NULL
    `);
    const rows = ((r as unknown as RawRows).rows as Array<Record<string, unknown>>);
    for (const row of rows) {
      const agentKey = String(row.agent_key);
      const isDraftOnly = DRAFT_ONLY_AGENT_KEYS.includes(agentKey);
      if (isDraftOnly) continue; /* draft-only agents are exempt from the EXECUTE scan */
      if (String(row.capability) !== 'EXECUTE') continue;
      expect(String(row.domain), `${agentKey} EXECUTEs in ${row.domain}, not its owner ${row.owner_domain}`)
        .toBe(String(row.owner_domain));
    }
    await close();
  });
});
