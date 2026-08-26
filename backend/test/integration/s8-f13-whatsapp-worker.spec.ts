import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { waMessages } from '@infrastructure/database/schema';
import { DbContextService, ScopedSystemWorkerContext } from '@core/auth/db-context.service';
import { WhatsappService } from '@modules/whatsapp/application/whatsapp.service';
import { WhatsappRepository } from '@modules/whatsapp/infrastructure/whatsapp.repository';
import { WahaAdapter } from '@modules/whatsapp/infrastructure/waha.adapter';
import { WhatsappTransportWorker } from '@modules/whatsapp/infrastructure/whatsapp-transport.worker';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ORG_A = '80d1f1a1-0000-4000-8000-0000000000a6';
const ORG_B = '80d1f1a1-0000-4000-8000-0000000000b6';

const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

/* F-13: skip the D18 randomized 30–60s sleep so the test executes the real
 * worker runtime deterministically (the delay math is unit-tested). */
process.env.WA_SEND_DELAY_DISABLE = '1';

type FreshDb = ReturnType<typeof createFreshDatabase>['db'];

async function seed(admin: FreshDb) {
  const branchRow = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const branches = (branchRow as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  const b1 = branches[0]!;
  const b2 = branches[1]!;
  await admin.execute(sql`INSERT INTO wa_channels (org_id, branch_id, phone, status, health_score)
    VALUES (${ORG_A}, ${b1}, '601111111111', 'working', 85)`);
  const ch = await admin.execute(sql`SELECT id::text AS id FROM wa_channels WHERE org_id = ${ORG_A} LIMIT 1`);
  const channelId = (ch as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  await admin.execute(sql`INSERT INTO wa_conversations (org_id, branch_id, channel_id, contact_phone, status)
    VALUES (${ORG_A}, ${b1}, ${channelId}, '60123456789', 'open')`);
  const conv = await admin.execute(sql`SELECT id::text AS id FROM wa_conversations WHERE org_id = ${ORG_A} LIMIT 1`);
  const conversationId = (conv as unknown as { rows: Array<{ id: string }> }).rows[0]!.id;
  return { b1, b2, channelId, conversationId };
}

async function purge(admin: FreshDb) {
  await admin.execute(sql`DELETE FROM wa_safety_decisions WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM wa_messages WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM wa_conversations WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  await admin.execute(sql`DELETE FROM wa_channels WHERE org_id IN (${ORG_A}, ${ORG_B})`);
}

function workerCtx(orgId: string, branchId: string): ScopedSystemWorkerContext {
  return { orgId, branchIds: [branchId], correlationId: `t5-${randomUUID()}`, source: 'system_worker' };
}

function build(db: FreshDb, waha?: WahaAdapter) {
  const dbCtx = new DbContextService(db);
  const repo = new WhatsappRepository();
  const patients = new PatientsReadPort(db);
  const audit = new AuditService(new InMemoryAuditAdapter());
  return new WhatsappService(dbCtx, repo, patients, audit, () => new Date('2026-08-17T10:00:00+08:00'), waha);
}

describe('F-13 — WhatsappTransportWorker.handle() actual runtime (mocked WAHA)', () => {
  dbIt('worker resolves correct chatId from conversation.contact_phone', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, channelId, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);

    /* Create message via HQ */
    const msg = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
      const [row] = await tx.insert(waMessages).values({
        orgId: ORG_A, branchId: b1, channelId, conversationId,
        direction: 'out', senderType: 'human', body: 'F-13 test', status: 'queued',
      }).returning();
      return row as unknown as { id: string };
    });

    /* Mock WAHA — capture the chatId it receives */
    let capturedChatId = '';
    const mockWaha = new WahaAdapter();
    mockWaha.sendText = async (_session: string, chatId: string, _text: string) => {
      capturedChatId = chatId;
      return { externalMessageId: `ext-${randomUUID()}` };
    };

    const svc = build(db, mockWaha);
    const ctx = workerCtx(ORG_A, b1);

    /* F-13: execute the ACTUAL WhatsappTransportWorker.handle() runtime —
     * no logic is re-implemented in this spec. */
    const worker = new WhatsappTransportWorker({ workerConnection: null } as never, svc);
    await worker.handle({
      data: {
        messageId: msg.id, orgId: ORG_A, branchId: b1,
        channelId, conversationId, correlationId: ctx.correlationId,
      },
      attemptsMade: 0,
    } as never);

    /* F-01 proof: WAHA received the canonical chatId, NOT the internal UUID. */
    expect(capturedChatId).toBe('60123456789@c.us');

    const updated = await svc.markMessageProcessing(ctx, msg.id);
    expect(updated.status).toBe('sent');

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-org worker DENIED: Org B cannot see Org A conversation', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const ctxB = workerCtx(ORG_B, b1);

    const conv = await svc.getWorkerConversation(ctxB, conversationId);
    expect(conv).toBeNull(); /* RLS blocks cross-org */

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-branch worker DENIED: Org A/b2 cannot see Org A/b1 conversation', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b2, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = build(db);
    const ctxWrong = workerCtx(ORG_A, b2);

    const conv = await svc.getWorkerConversation(ctxWrong, conversationId);
    expect(conv).toBeNull(); /* RLS blocks cross-branch */

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('N8-2: worker SELECT conversation ALLOW; INSERT/UPDATE/DELETE DENY', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, channelId, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const dbCtx = new DbContextService(db);
    const ctx = workerCtx(ORG_A, b1);

    /* SELECT = ALLOW (the worker read path). */
    const seen = await dbCtx.runAsWorker(ctx, async (tx) => {
      const r = await tx.execute(sql`SELECT id FROM wa_conversations WHERE id = ${conversationId}`);
      return (r as unknown as { rows: unknown[] }).rows.length;
    });
    expect(seen).toBe(1);

    /* INSERT/UPDATE/DELETE = DENY — via role grants (42501) or RLS (0 rows).
     * Either mechanism is a valid denial; we also prove no data changed. */
    let insertDenied = false;
    try {
      await dbCtx.runAsWorker(ctx, async (tx) => {
        await tx.execute(sql`INSERT INTO wa_conversations (org_id, branch_id, channel_id, contact_phone, status)
          VALUES (${ORG_A}, ${b1}, ${channelId}, '60999999999', 'open')`);
      });
    } catch { insertDenied = true; }
    expect(insertDenied).toBe(true);

    let updateDenied = false; let updated = 0;
    try {
      await dbCtx.runAsWorker(ctx, async (tx) => {
        const r = await tx.execute(sql`UPDATE wa_conversations SET status = 'archived' WHERE id = ${conversationId}`);
        updated = (r as unknown as { rowCount: number }).rowCount ?? 0;
      });
    } catch { updateDenied = true; }
    expect(updateDenied || updated === 0).toBe(true);

    let deleteDenied = false; let deleted = 0;
    try {
      await dbCtx.runAsWorker(ctx, async (tx) => {
        const r = await tx.execute(sql`DELETE FROM wa_conversations WHERE id = ${conversationId}`);
        deleted = (r as unknown as { rowCount: number }).rowCount ?? 0;
      });
    } catch { deleteDenied = true; }
    expect(deleteDenied || deleted === 0).toBe(true);

    /* Proof: the conversation still exists, unmodified. */
    const still = await dbCtx.runAsWorker(ctx, async (tx) => {
      const r = await tx.execute(sql`SELECT status FROM wa_conversations WHERE id = ${conversationId}`);
      return (r as unknown as { rows: Array<{ status: string }> }).rows[0]?.status;
    });
    expect(still).toBe('open');

    await close(); await purge(admin.db); await admin.close();
  });
});
