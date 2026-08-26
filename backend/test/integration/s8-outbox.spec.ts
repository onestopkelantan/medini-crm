import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { OutboxWorker } from '@infrastructure/outbox/outbox.worker';
import { OutboxRepository } from '@infrastructure/outbox/outbox.repository';
import { ScopedOutboxEvent, assertScopedOutboxEvent } from '@infrastructure/outbox/outbox.types';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ORG_A = '80d1f1a1-0000-4000-8000-0000000000a2';

const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

describe('S8 T1 — outbox worker idempotency + scope validation (unit)', () => {
  it('assertScopedOutboxEvent rejects missing trusted scope', () => {
    const base: ScopedOutboxEvent = { eventId: 'e1', eventType: 'X', orgId: ORG_A, branchId: null, correlationId: 'c1', source: 'domain', payload: {} };
    expect(() => assertScopedOutboxEvent({ ...base, eventId: '' })).toThrow();
    expect(() => assertScopedOutboxEvent({ ...base, orgId: '' })).toThrow();
    expect(() => assertScopedOutboxEvent({ ...base, correlationId: '' })).toThrow();
    expect(() => assertScopedOutboxEvent(base)).not.toThrow();
  });
});

describe('S8 T1 — outbox worker execution + idempotency (live PG)', () => {
  dbIt('event processed once; duplicate re-delivery has no side effect', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const branchRow = await admin.db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
    const b1 = (branchRow as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
    const eventId = randomUUID();
    const correlationId = `s8-out-${randomUUID()}`;
    await admin.db.execute(sql`DELETE FROM domain_events WHERE org_id = ${ORG_A} AND correlation_id = ${correlationId}`);
    await admin.db.execute(sql`DELETE FROM processed_events WHERE org_id = ${ORG_A}`);
    await admin.db.execute(sql`INSERT INTO domain_events (id, org_id, branch_id, event_type, payload, correlation_id)
      VALUES (${eventId}, ${ORG_A}, ${b1}, 'TEST_EVENT', '{}'::jsonb, ${correlationId})`);

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const repo = new OutboxRepository();
    const worker = new OutboxWorker(dbCtx, repo);
    const event: ScopedOutboxEvent = { eventId, eventType: 'TEST_EVENT', orgId: ORG_A, branchId: b1, correlationId, source: 'domain', payload: {} };

    let runs = 0;
    const handler = async () => { runs += 1; };

    const first = await worker.process(event, handler);
    expect(first).toBe('processed');
    expect(runs).toBe(1);

    const second = await worker.process(event, handler);
    expect(second).toBe('duplicate');
    expect(runs).toBe(1); /* no duplicate side effect */

    await close(); await admin.close();
  });
});
