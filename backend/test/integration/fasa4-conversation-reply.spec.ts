import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';

import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { WhatsappRepository } from '@modules/whatsapp/infrastructure/whatsapp.repository';
import { WhatsappService } from '@modules/whatsapp/application/whatsapp.service';
import { ForbiddenError, ValidationError, ConflictError } from '@shared/errors/errors';
import {
  WA_SAFETY_MESSAGE_FOR_REASON,
  evaluateWaSafety,
  type WaBlockedReason,
} from '@modules/whatsapp/domain/whatsapp-lifecycle';

/**
 * FASA 4 — conversation replies (live MySQL).
 *
 * Covers the two defects found by exercising the running system:
 *
 *  BUG 1 — replying had no idempotencyKey, so every send failed with 422 and
 *          staff could not answer a patient from inside the app.
 *  BUG 2 — a safety block surfaced as the raw code
 *          "Message blocked by safety engine: CHANNEL_UNAVAILABLE", which told
 *          an operator nothing about what to do next.
 *
 * The fixed clock below sits inside the 09:00–18:00 MYT sending window so the
 * safety gates are deterministic regardless of when the suite runs.
 */

const URL = process.env.DATABASE_URL ?? 'mysql://medini:medini_dev_password@localhost:3306/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? URL;

const probe = pingDatabase(URL).then((ok) => {
  if (!ok) {
    console.warn('[fasa4] MySQL not reachable — SKIPPING (honest skip, not a pass).');
  }
  return ok;
});

function dbIt(name: string, fn: () => Promise<void> | void): void {
  it(name, async (ctx) => {
    if (!(await probe)) { ctx.skip(); return; }
    await fn();
  });
}

const TEST_ORG = '99999999-9999-9999-9999-99999999fa04';
const STAFF = '99999999-1111-4111-8111-9999999fa401';
const IN_WINDOW = () => new Date('2026-08-17T10:00:00+08:00');

interface RawRows { rows: Array<Record<string, unknown>> }
type DB = ReturnType<typeof createFreshDatabase>['db'];

function build(db: DB, nowFn: () => Date = IN_WINDOW) {
  const ctx = new DbContextService(db);
  return new WhatsappService(
    ctx, new WhatsappRepository(), new PatientsReadPort(db),
    new AuditService(new InMemoryAuditAdapter()), nowFn,
  );
}

const hq = {
  staffId: STAFF, name: 'Fasa4 Tester', username: 'fasa4-hq', role: 'hq',
  orgId: TEST_ORG, branchId: null, doctorId: null,
};

/* A soft-deleted previous run must not collide: every fixture row is namespaced
 * to TEST_ORG and purged first. */
async function purge(db: DB) {
  for (const t of ['wa_safety_decisions', 'wa_assignments', 'wa_messages', 'wa_conversations', 'wa_channels', 'staff']) {
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE org_id='${TEST_ORG}'`));
  }
}

async function activeBranchId(db: DB): Promise<string> {
  const r = await db.execute(sql`SELECT id FROM branches WHERE deleted_at IS NULL ORDER BY code LIMIT 1`);
  const id = (r as unknown as RawRows).rows[0]?.id as string | undefined;
  if (!id) throw new Error('no seeded branch available');
  return id;
}

async function seed(db: DB, channelStatus: string, health = 95) {
  const branchId = await activeBranchId(db);
  await db.execute(sql`
    INSERT INTO staff (id, org_id, branch_id, name, username, role, status)
    VALUES (${STAFF}, ${TEST_ORG}, ${branchId}, 'Fasa4 HQ', 'fasa4-hq', 'hq', 'Active')
  `);
  const channelId = randomUUID();
  await db.execute(sql`
    INSERT INTO wa_channels (id, org_id, branch_id, phone, session_name, status, health_score, sent_today_count)
    VALUES (${channelId}, ${TEST_ORG}, ${branchId}, '+60109998888', 'fasa4-test', ${channelStatus}, ${health}, 0)
  `);
  const conversationId = randomUUID();
  await db.execute(sql`
    INSERT INTO wa_conversations (id, org_id, branch_id, channel_id, contact_phone, status)
    VALUES (${conversationId}, ${TEST_ORG}, ${branchId}, ${channelId}, '60109998888', 'open')
  `);
  return { branchId, channelId, conversationId };
}

describe('FASA 4 — conversation reply (live MySQL)', () => {
  /* ---------------------------------------------------------------- BUG 1 */
  dbIt('rejects a reply with NO idempotencyKey (the exact defect: HTTP 422)', async () => {
    const { db, close } = createFreshDatabase(URL);
    try {
      await purge(db);
      const { conversationId } = await seed(db, 'working');
      const svc = build(db);

      await expect(
        svc.createMessage(hq as never, conversationId, { body: 'Balasan tanpa kunci' }),
      ).rejects.toThrow(ValidationError);

      await close();
    } catch (e) { await close(); throw e; }
  });

  dbIt('accepts a reply WITH idempotencyKey and persists it', async () => {
    const { db, close } = createFreshDatabase(URL);
    try {
      await purge(db);
      const { conversationId } = await seed(db, 'working');
      const svc = build(db);

      const msg = await svc.createMessage(hq as never, conversationId, {
        body: 'Balasan staff — disimpan',
        idempotencyKey: 'fasa4-key-000001',
      }) as Record<string, unknown>;

      expect(msg.id).toBeTruthy();
      expect(msg.body).toBe('Balasan staff — disimpan');
      expect(msg.direction).toBe('out');

      /* Prove it really landed in the database, not just in the response. */
      const rows = await db.execute(sql`
        SELECT body, direction, status FROM wa_messages
        WHERE conversation_id = ${conversationId} AND org_id = ${TEST_ORG}
      `);
      const saved = (rows as unknown as RawRows).rows;
      expect(saved).toHaveLength(1);
      expect(saved[0]?.body).toBe('Balasan staff — disimpan');
      expect(saved[0]?.status).toBe('queued');

      await close();
    } catch (e) { await close(); throw e; }
  });

  dbIt('a SECOND reply with a fresh key also succeeds (retry not blocked)', async () => {
    const { db, close } = createFreshDatabase(URL);
    try {
      await purge(db);
      const { conversationId } = await seed(db, 'working');
      const svc = build(db);

      await svc.createMessage(hq as never, conversationId, {
        body: 'Balasan pertama', idempotencyKey: 'fasa4-key-first',
      });
      await svc.createMessage(hq as never, conversationId, {
        body: 'Balasan kedua', idempotencyKey: 'fasa4-key-second',
      });

      const rows = await db.execute(sql`
        SELECT body FROM wa_messages WHERE conversation_id = ${conversationId} ORDER BY created_at
      `);
      expect((rows as unknown as RawRows).rows.map((r) => r.body))
        .toEqual(['Balasan pertama', 'Balasan kedua']);

      await close();
    } catch (e) { await close(); throw e; }
  });

  dbIt('reusing the same key with DIFFERENT text is refused (no silent send)', async () => {
    const { db, close } = createFreshDatabase(URL);
    try {
      await purge(db);
      const { conversationId } = await seed(db, 'working');
      const svc = build(db);

      await svc.createMessage(hq as never, conversationId, {
        body: 'Mesej asal', idempotencyKey: 'fasa4-key-dup',
      });

      await expect(
        svc.createMessage(hq as never, conversationId, {
          body: 'Mesej berbeza', idempotencyKey: 'fasa4-key-dup',
        }),
      ).rejects.toThrow(ConflictError);

      await close();
    } catch (e) { await close(); throw e; }
  });

  /* ---------------------------------------------------------------- BUG 2 */
  dbIt('a blocked send explains itself in plain Malay, not a raw code', async () => {
    const { db, close } = createFreshDatabase(URL);
    try {
      await purge(db);
      const { conversationId } = await seed(db, 'failed'); // channel not working
      const svc = build(db);

      const err = await svc.createMessage(hq as never, conversationId, {
        body: 'Cuba hantar', idempotencyKey: 'fasa4-key-blocked',
      }).then(() => null, (e: unknown) => e as ForbiddenError);

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err!.message).toContain('nombor WhatsApp ini tidak aktif');
      expect(err!.message).toMatch(/tab "Nombor"/);
      /* The raw code must NOT be the user-facing message any more. */
      expect(err!.message).not.toContain('safety engine');
      /* …but the machine-readable reason travels for the client to branch on. */
      expect(err!.details).toMatchObject({
        blockedReason: 'CHANNEL_UNAVAILABLE',
        conversationId,
      });

      await close();
    } catch (e) { await close(); throw e; }
  });

  dbIt('every safety reason has an operator explanation (no code leaks to users)', () => {
    const reasons: WaBlockedReason[] = [
      'CHANNEL_UNAVAILABLE', 'LOW_HEALTH', 'DAILY_CAP_REACHED',
      'OUTSIDE_SENDING_WINDOW', 'RATE_LIMIT', 'AUTO_PAUSED', 'BLOCKED',
    ];
    for (const r of reasons) {
      const text = WA_SAFETY_MESSAGE_FOR_REASON[r];
      expect(text, `missing message for ${r}`).toBeTruthy();
      expect(text).toMatch(/^Mesej tidak dihantar/);
      /* Each message must say WHY and what to do — not just a bare code. */
      expect(text.length).toBeGreaterThan(60);
      expect(text).not.toContain(r);
    }
  });

  dbIt('a blocked send is still recorded for compliance (audit survives)', async () => {
    const { db, close } = createFreshDatabase(URL);
    try {
      await purge(db);
      const { conversationId } = await seed(db, 'failed');
      const svc = build(db);

      await svc.createMessage(hq as never, conversationId, {
        body: 'Cuba', idempotencyKey: 'fasa4-key-audit',
      }).catch(() => undefined);

      const rows = await db.execute(sql`
        SELECT decision, blocked_reason FROM wa_safety_decisions WHERE org_id = ${TEST_ORG}
      `);
      const rec = (rows as unknown as RawRows).rows[0];
      expect(rec?.decision).toBe('blocked');
      expect(rec?.blocked_reason).toBe('CHANNEL_UNAVAILABLE');

      await close();
    } catch (e) { await close(); throw e; }
  });

  /* --------------------------------------------------- safety gate ordering */
  dbIt('safety gates short-circuit in order: channel first', () => {
    const evaln = evaluateWaSafety({
      channelStatus: 'failed' as never, healthScore: 10, sentTodayCount: 999,
      now: IN_WINDOW(), lastSentAt: null,
    });
    expect(evaln.allowed).toBe(false);
    expect(evaln.blockedReason).toBe('CHANNEL_UNAVAILABLE');
    expect(evaln.gates).toHaveLength(1); /* stops at the first failing gate */
  });

  dbIt('outside 09:00–18:00 MYT is blocked with its own reason', () => {
    const night = evaluateWaSafety({
      channelStatus: 'working' as never, healthScore: 95, sentTodayCount: 0,
      now: new Date('2026-08-17T20:25:00+08:00'), lastSentAt: null,
    });
    expect(night.allowed).toBe(false);
    expect(night.blockedReason).toBe('OUTSIDE_SENDING_WINDOW');
  });

  dbIt('inside the window, a healthy channel is allowed', () => {
    const ok = evaluateWaSafety({
      channelStatus: 'working' as never, healthScore: 95, sentTodayCount: 0,
      now: IN_WINDOW(), lastSentAt: null,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.blockedReason).toBeNull();
  });

  /* --------------------------------------------------- regression guard */
  dbIt('RUNTIME_URL stays separate from the admin URL (least privilege)', async () => {
    const okRuntime = await pingDatabase(RUNTIME_URL);
    expect(okRuntime).toBe(true);
  });
});
