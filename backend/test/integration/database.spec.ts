import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  pingDatabase,
  createFreshDatabase,
} from '@infrastructure/database/database';
import { DbIdempotencyAdapter } from '@infrastructure/database/db-idempotency.adapter';
import { DbAuditAdapter } from '@infrastructure/database/db-audit.adapter';

const URL =
  process.env.DATABASE_URL ??
  'mysql://medini_admin:medini_dev_password@localhost:3306/medini_dev';

const probe = pingDatabase(URL).then((ok) => {
  if (!ok) {
    console.warn(
      '[integration] MySQL not reachable - SKIPPING DB integration tests (honest skip, not a pass).',
    );
  }

  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const available = await probe;

    if (!available) {
      ctx.skip();
      return;
    }

    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-999999999994';

interface RawRows {
  rows: Array<Record<string, unknown>>;
}

interface DbErr {
  message?: string;
  code?: string;
  sqlMessage?: string;
}

describe('database integration (MySQL)', () => {
  dbIt('database connection responds to SELECT 1', async () => {
    const { db, close } = createFreshDatabase(URL);

    const result = await db.execute(sql`SELECT 1 AS ok`);

    expect((result as RawRows).rows[0]?.ok).toBe(1);

    await close();
  });

  dbIt(
    'idempotency: begin -> duplicate blocked -> complete -> persisted',
    async () => {
      const { db, close } = createFreshDatabase(URL);
      const adapter = new DbIdempotencyAdapter(db);

      const marker = randomUUID();
      const key = `itest-${marker}`;
      const scope = `itest-scope-${marker}`;

      expect(await adapter.begin(key, scope, 60)).toBe('started');
      expect(await adapter.begin(key, scope, 60)).toBe('exists');

      await adapter.complete(key, scope, { ok: true });

      const got = await adapter.get<{ ok: boolean }>(key, scope);

      expect(got?.status).toBe('completed');
      expect(got?.response).toEqual({ ok: true });

      await db.execute(sql`
        DELETE FROM idempotency_keys
        WHERE \`key\` = ${key}
          AND scope = ${scope}
      `);

      await close();
    },
  );

  dbIt('idempotency: failure is recorded', async () => {
    const { db, close } = createFreshDatabase(URL);
    const adapter = new DbIdempotencyAdapter(db);

    const marker = randomUUID();
    const key = `itest-fail-${marker}`;
    const scope = `itest-scope-${marker}`;

    expect(await adapter.begin(key, scope, 60)).toBe('started');

    await adapter.fail(key, scope);

    const failed = await adapter.get(key, scope);

    expect(failed?.status).toBe('failed');

    await db.execute(sql`
      DELETE FROM idempotency_keys
      WHERE \`key\` = ${key}
        AND scope = ${scope}
    `);

    await close();
  });

  dbIt('idempotency: expired keys are purged on access', async () => {
    const { db, close } = createFreshDatabase(URL);
    const adapter = new DbIdempotencyAdapter(db);

    const marker = randomUUID();
    const key = `itest-exp-${marker}`;
    const scope = `itest-scope-${marker}`;

    await adapter.begin(key, scope, 0);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const got = await adapter.get(key, scope);

    expect(got).toBeUndefined();

    await db.execute(sql`
      DELETE FROM idempotency_keys
      WHERE \`key\` = ${key}
        AND scope = ${scope}
    `);

    await close();
  });

  dbIt('audit: writes and reads back an append-only record', async () => {
    const { db, close } = createFreshDatabase(URL);
    const adapter = new DbAuditAdapter(db);

    const marker = `itest-${randomUUID()}`;

    await adapter.record({
      actorId: '99999999-9999-9999-9999-999999999993',
      actorRole: 'hq',
      action: 'test_action',
      entity: 'test',
      entityId: marker,
      orgId: TEST_ORG,
      branchId: null,
      before: null,
      after: { ok: true },
      source: 'api',
      correlationId: marker,
      timestamp: new Date().toISOString(),
    });

    const rows = await db.execute(sql`
      SELECT entity_id, action
      FROM audit_log
      WHERE correlation_id = ${marker}
    `);

    expect((rows as RawRows).rows).toHaveLength(1);
    expect((rows as RawRows).rows[0]?.action).toBe('test_action');

    await db.execute(sql`
      DELETE FROM audit_log
      WHERE correlation_id = ${marker}
    `);

    await close();
  });

  dbIt(
    'audit: audit_log is append-only with no updated_at or deleted_at columns',
    async () => {
      const { db, close } = createFreshDatabase(URL);

      const cols = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'audit_log'
          AND column_name IN ('updated_at', 'deleted_at')
      `);

      expect((cols as RawRows).rows).toHaveLength(0);

      await close();
    },
  );

  dbIt('schema: application tables exist in current MySQL database', async () => {
    const { db, close } = createFreshDatabase(URL);

    const res = await db.execute(sql`
      SELECT CAST(COUNT(*) AS SIGNED) AS n
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
    `);

    const count = Number((res as RawRows).rows[0]?.n ?? 0);

    expect(count).toBeGreaterThanOrEqual(80);

    await close();
  });

  dbIt(
    'schema: staff_non_hq_requires_branch rejects non-HQ staff without branch',
    async () => {
      const { db, close } = createFreshDatabase(URL);

      const staffId = randomUUID();
      const username = `itest-${randomUUID()}`;

      let errText = '';

      try {
        await db.execute(sql`
          INSERT INTO staff (
            id,
            org_id,
            name,
            username,
            role,
            status
          )
          VALUES (
            ${staffId},
            ${TEST_ORG},
            'Constraint Test',
            ${username},
            'doctor',
            'Active'
          )
        `);
      } catch (e: unknown) {
        const err = e as DbErr & { cause?: DbErr };
        const cause = err.cause ?? {};

        errText = [
          err.message,
          err.code,
          err.sqlMessage,
          cause.message,
          cause.code,
          cause.sqlMessage,
        ]
          .filter(Boolean)
          .join(' | ');
      } finally {
        await db.execute(sql`
          DELETE FROM staff
          WHERE id = ${staffId}
        `);

        await close();
      }

      expect(errText).toMatch(/staff_non_hq_requires_branch|check constraint/i);
    },
  );
});
