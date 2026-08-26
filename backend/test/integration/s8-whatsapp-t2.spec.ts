import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { waMessages } from '@infrastructure/database/schema';
import { DbContextService, ScopedSystemWorkerContext } from '@core/auth/db-context.service';
import { WhatsappService } from '@modules/whatsapp/application/whatsapp.service';
import { WhatsappRepository } from '@modules/whatsapp/infrastructure/whatsapp.repository';
import { WahaAdapter } from '@modules/whatsapp/infrastructure/waha.adapter';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const ORG_A = '80d1f1a1-0000-4000-8000-0000000000a3';
const ORG_B = '80d1f1a1-0000-4000-8000-0000000000b3';

const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

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
  return { orgId, branchIds: [branchId], correlationId: `t2-${randomUUID()}`, source: 'system_worker' };
}

function buildService(db: FreshDb, waha?: WahaAdapter) {
  const dbCtx = new DbContextService(db);
  const repo = new WhatsappRepository();
  const patients = new PatientsReadPort(db);
  const audit = new AuditService(new InMemoryAuditAdapter());
  return new WhatsappService(dbCtx, repo, patients, audit, () => new Date('2026-08-17T10:00:00+08:00'), waha);
}

describe('T2 — WhatsApp worker transport (live PG)', () => {
  dbIt('queued → processing → sent: counter +1 once, duplicate success +0', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, channelId, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildService(db);
    const ctx = workerCtx(ORG_A, b1);

    /* Create message (queued) — counter unchanged */
    /* Create message as HQ (human API path) — worker processes it after */
    const msg = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
      const [row] = await tx.insert(waMessages).values({
        orgId: ORG_A, branchId: b1, channelId, conversationId,
        direction: 'out', senderType: 'human', body: 'T2 test', status: 'queued',
      }).returning();
      return row as unknown as { id: string };
    });
    expect(msg.id).toBeTruthy();

    /* mark processing */
    const processing = await svc.markMessageProcessing(ctx, msg.id);
    expect(processing.status).toBe('processing');

    /* confirm send — first time */
    const externalId = `waha-ext-${randomUUID()}`;
    const sent = await svc.confirmWorkerSend(ctx, msg.id, externalId);
    expect(sent.status).toBe('sent');
    expect(sent.externalMessageId).toBe(externalId);

    /* counter check — via RLS-scoped channel read */
    const ch1 = await svc.validateChannelScope(ctx, channelId);
    expect(ch1.sentTodayCount).toBe(1);

    /* duplicate success — no second increment */
    const dup = await svc.confirmWorkerSend(ctx, msg.id, externalId);
    expect(dup.externalMessageId).toBe(externalId);
    const ch2 = await svc.validateChannelScope(ctx, channelId);
    expect(ch2.sentTodayCount).toBe(1);

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-org worker DENIED: Org B worker cannot see Org A message', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, channelId, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildService(db);

    const msg = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
      const [row] = await tx.insert(waMessages).values({
        orgId: ORG_A, branchId: b1, channelId, conversationId,
        direction: 'out', senderType: 'human', body: 'T2 cross-org', status: 'queued',
      }).returning();
      return row as unknown as { id: string };
    });

    const ctxB = workerCtx(ORG_B, b1);
    await expect(svc.markMessageProcessing(ctxB, msg.id)).rejects.toThrow();

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('cross-branch worker DENIED: Org A / Branch b2 cannot see Org A / Branch b1 channel', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b2, channelId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildService(db);

    /* validateChannelScope with wrong branch */
    const ctxWrongBranch = workerCtx(ORG_A, b2);
    await expect(svc.validateChannelScope(ctxWrongBranch, channelId)).rejects.toThrow();

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('auto-pause blocks worker send; resume clears it', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, channelId, conversationId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildService(db);
    const ctx = workerCtx(ORG_A, b1);

    /* Set channel to auto-paused (via HQ service path) */
    const hqP = { staffId: '00000000-0000-0000-0000-000000000001', username: 'hq', role: 'hq', orgId: ORG_A, branchId: null, doctorId: null };
    await svc.hqUpdateChannel(hqP, channelId, { autoPausedAt: new Date() });

    const msg = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.role', 'hq', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${ORG_A}, true)`);
      const [row] = await tx.insert(waMessages).values({
        orgId: ORG_A, branchId: b1, channelId, conversationId,
        direction: 'out', senderType: 'human', body: 'T2 paused', status: 'queued',
      }).returning();
      return row as unknown as { id: string };
    });

    /* Worker confirm should throw (auto-paused) */
    await expect(svc.confirmWorkerSend(ctx, msg.id, 'ext-1')).rejects.toThrow(/auto-paused/i);

    /* Resume via human endpoint (HQ) */
    const hq = { staffId: '00000000-0000-0000-0000-000000000001', username: 'hq', role: 'hq', orgId: ORG_A, branchId: null, doctorId: null };
    await svc.resumeAutoPause(hq, channelId);

    /* Now confirm works */
    const sent = await svc.confirmWorkerSend(ctx, msg.id, 'ext-1');
    expect(sent.status).toBe('sent');

    await close(); await purge(admin.db); await admin.close();
  });

  dbIt('N6-3: auto-resume after 15 min clears pause (worker path)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const { b1, channelId } = await seed(admin.db);
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const svc = buildService(db);
    const ctx = workerCtx(ORG_A, b1);

    /* Set auto_paused_at to 16 minutes before the service's mock nowFn (2026-08-17T10:00:00+08:00) */
    const hqP2 = { staffId: '00000000-0000-0000-0000-000000000001', username: 'hq', role: 'hq', orgId: ORG_A, branchId: null, doctorId: null };
    const mockNow = new Date('2026-08-17T10:00:00+08:00');
    const sixteenMinAgo = new Date(mockNow.getTime() - 16 * 60_000);
    await svc.hqUpdateChannel(hqP2, channelId, { autoPausedAt: sixteenMinAgo });

    const resumed = await svc.autoResumeExpiredChannels(ctx);
    expect(resumed).toBe(1);

    const ch3 = await svc.validateChannelScope(ctx, channelId);
    expect(ch3.autoPausedAt).toBeNull();
    expect(ch3.autoPauseResumedAt).not.toBeNull();

    await close(); await purge(admin.db); await admin.close();
  });
});
