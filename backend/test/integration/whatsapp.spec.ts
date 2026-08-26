import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';
import { DbContextService } from '@core/auth/db-context.service';
import { AuditService, InMemoryAuditAdapter } from '@shared/audit/audit.service';
import { PatientsReadPort } from '@shared/ports/patients.read-port';
import { WhatsappRepository } from '@modules/whatsapp/infrastructure/whatsapp.repository';
import { WhatsappService } from '@modules/whatsapp/application/whatsapp.service';
import { ForbiddenError, ConflictError, ValidationError } from '@shared/errors/errors';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const TEST_ORG = 'aaaaaaaa-5a5a-4a5a-8a5a-000000000601';
const probe = pingDatabase(ADMIN_URL).then((ok) => ok);
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}
const hq = { staffId: '60d1f1a1-0000-4000-8000-0000000000aa', username: 'hq', role: 'hq', orgId: TEST_ORG, branchId: '60d1f1a1-0000-4000-8000-0000000000ff', doctorId: null };
const bm = (branchId: string) => ({ staffId: '60d1f1a1-0000-4000-8000-0000000000bb', username: 'bm', role: 'branch_manager', orgId: TEST_ORG, branchId, doctorId: null });
const ba = (branchId: string) => ({ staffId: '60d1f1a1-0000-4000-8000-0000000000cc', username: 'ba', role: 'branch_admin', orgId: TEST_ORG, branchId, doctorId: null });
const doc = (branchId: string) => ({ staffId: '60d1f1a1-0000-4000-8000-0000000000dd', username: 'dr', role: 'doctor', orgId: TEST_ORG, branchId, doctorId: '60d1f1a1-0000-4000-8000-0000000000dd' });

/* Fixed instant inside the 09:00–18:00 MYT sending window so safety-gate
 * evaluation is deterministic regardless of when the suite runs. */
const TEST_NOW = () => new Date('2026-08-17T10:00:00+08:00');
function build(db: ReturnType<typeof createFreshDatabase>['db'], audit: InMemoryAuditAdapter, nowFn: () => Date = TEST_NOW) {
  const ctx = new DbContextService(db);
  return new WhatsappService(ctx, new WhatsappRepository(), new PatientsReadPort(db), new AuditService(audit), nowFn);
}
async function purge(admin: ReturnType<typeof createFreshDatabase>['db']) {
  for (const t of ['wa_safety_decisions','wa_assignments','wa_messages','wa_templates','wa_conversations','wa_channels','patients','staff']) {
    await admin.execute(sql.raw(`DELETE FROM ${t} WHERE org_id='${TEST_ORG}'`));
  }
}
async function seed(admin: ReturnType<typeof createFreshDatabase>['db']) {
  await admin.execute(sql`INSERT INTO staff (org_id, branch_id, name, username, role, status) VALUES (${TEST_ORG}, NULL, 'HQ Tester', 'hq-s6', 'hq', 'Active') ON CONFLICT (org_id, username) DO NOTHING`);
  const rows = await admin.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 2`);
  const [b1, b2] = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  /* Fixed principal staff IDs (FK targets for assignments/actors). staff_pkey
   * is globally unique (no org scoping) — drop any stale rows from a previous
   * interrupted run first, then insert deterministically. IDs are S6-namespaced
   * (60d1f1a1-…) so they NEVER collide with other suites' principals. */
  await admin.execute(sql`DELETE FROM staff WHERE id IN ('60d1f1a1-0000-4000-8000-0000000000aa','60d1f1a1-0000-4000-8000-0000000000bb','60d1f1a1-0000-4000-8000-0000000000cc','60d1f1a1-0000-4000-8000-0000000000dd')`);
  await admin.execute(sql`INSERT INTO staff (id, org_id, branch_id, name, username, role, status) VALUES
    ('60d1f1a1-0000-4000-8000-0000000000aa', ${TEST_ORG}, NULL, 'HQ Fixed', 'hq-s6-fixed', 'hq', 'Active'),
    ('60d1f1a1-0000-4000-8000-0000000000bb', ${TEST_ORG}, ${b1}, 'BM Fixed', 'bm-s6-fixed', 'branch_manager', 'Active'),
    ('60d1f1a1-0000-4000-8000-0000000000cc', ${TEST_ORG}, ${b1}, 'BA Fixed', 'ba-s6-fixed', 'branch_admin', 'Active'),
    ('60d1f1a1-0000-4000-8000-0000000000dd', ${TEST_ORG}, ${b1}, 'DR Fixed', 'dr-s6-fixed', 'doctor', 'Active')`);
  /* patient phones: b1 unique 60111111111 · b1+b2 shared 60222222222 (ambiguity) · variants */
  await admin.execute(sql`INSERT INTO patients (org_id, branch_id, mrn, name, phone, whatsapp) VALUES
    (${TEST_ORG}, ${b1}, 'MDN-S601', 'S6 P1', '012-1111111', NULL),
    (${TEST_ORG}, ${b1}, 'MDN-S602', 'S6 P2', NULL, '0222222222'),
    (${TEST_ORG}, ${b2}, 'MDN-S603', 'S6 P3', '02-2222 2222', NULL)`);
  return { b1: b1!, b2: b2! };
}
/** Channel ready to send: working + health 80 (safe defaults inside window). */
async function makeChannel(svc: WhatsappService, branchId: string, phone = '+60300000001') {
  const ch = await svc.createChannel(hq, { branchId, phone });
  await svc.transitionChannel(hq, ch.id, { status: 'starting' });
  await svc.transitionChannel(hq, ch.id, { status: 'working' });
  await svc.updateChannelHealth(hq, ch.id, { healthScore: 80 });
  return ch;
}
/** Reset the channel send-cooldown between logical messages in a test (the
 * 60s RATE_LIMIT gate is per-channel, shared across conversations — correct
 * engine behaviour; tests advance the clock by clearing last_sent_at). */
async function resetCooldown(admin: ReturnType<typeof createFreshDatabase>['db']) {
  await admin.execute(sql`UPDATE wa_channels SET last_sent_at = NULL, sent_today_count = 0 WHERE org_id = ${TEST_ORG}`);
}

describe('S6 WhatsApp — RBAC (D1: doctor = NONE) + RLS + lifecycle + safety (unique org per suite)', () => {
  dbIt('HQ full flow: channel → working; BM branch list only; BM foreign-branch channel hidden by RLS', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch1 = await makeChannel(svc, s.b1);
    const ch2 = await makeChannel(svc, s.b2, '+60300000002');
    /* makeChannel returns the row at creation; read back the transitioned state */
    const ch1After = await svc.listChannels(hq, s.b1);
    expect(ch1After.find((c) => c.id === ch1.id)?.status).toBe('working');
    const bmOwn = await svc.listChannels(bm(s.b1));
    expect(bmOwn.map((c) => c.id)).toContain(ch1.id);
    expect(bmOwn.map((c) => c.id)).not.toContain(ch2.id);
    /* channel mutation is HQ-controlled even for BM */
    await expect(svc.transitionChannel(bm(s.b1), ch1.id, { status: 'stopped' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.createChannel(bm(s.b1), { branchId: s.b1, phone: '+60399999999' })).rejects.toBeInstanceOf(ForbiddenError);
    /* illegal channel transition */
    await expect(svc.transitionChannel(hq, ch1.id, { status: 'starting' })).rejects.toBeInstanceOf(ConflictError);
    /* one active channel per branch */
    await expect(svc.createChannel(hq, { branchId: s.b1, phone: '+60388888888' })).rejects.toBeInstanceOf(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('doctor = NONE on every whatsapp capability (D1) — service scope + RLS double denial', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    const conv = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0190000001' })).conversation;
    const d = doc(s.b1);
    await expect(svc.listChannels(d)).resolves.toEqual([]);               /* RLS: zero rows */
    await expect(svc.listConversations(d, {})).resolves.toEqual([]);
    /* RLS fail-closed at DB layer: row invisible → repo NotFound (equivalent
     * denial to 403; doctor never reaches the branch check). Both accepted. */
    await expect(svc.getConversation(d, conv.id)).rejects.toThrowError(/not found|denied|Forbidden/i);
    await expect(svc.listMessages(d, conv.id)).rejects.toThrowError(/not found|denied|Forbidden/i);
    await expect(svc.createMessage(d, conv.id, { body: 'hi', idempotencyKey: 'doc-key-0001' })).rejects.toThrowError(/not found|denied|Forbidden/i);
    await expect(svc.assignConversation(d, conv.id, { staffId: d.staffId })).rejects.toThrowError(/not found|denied|Forbidden/i);
    await expect(svc.handoffConversation(d, conv.id)).rejects.toThrowError(/not found|denied|Forbidden/i);
    await expect(svc.resolveConversation(d, conv.id)).rejects.toThrowError(/not found|denied|Forbidden/i);
    await expect(svc.createTemplate(d, { branchId: s.b1, name: 'T', body: 'B' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.listTemplates(d)).resolves.toEqual([]);
    await expect(svc.listSafetyDecisions(d)).resolves.toEqual([]);
    /* direct DB probe: doctor context sees zero wa rows (RLS fail-closed) */
    await db.execute(sql`SELECT set_config('app.role', 'doctor', true)`);
    await db.execute(sql`SELECT set_config('app.branch_ids', ${s.b1}, true)`);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM wa_channels WHERE org_id = ${TEST_ORG}`);
    expect((rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('conversation identity: deterministic reuse of ACTIVE; archived terminal → new conversation', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    const c1 = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '012-999 0001' })).conversation;
    const again = await svc.createConversation(hq, { channelId: ch.id, contactPhone: '+60129990001' });
    expect(again.reused).toBe(true);
    expect(again.conversation.id).toBe(c1.id); /* phone variants → same contact */
    /* lifecycle: new→open (assign) → resolved → archived; archived is terminal */
    await svc.assignConversation(bm(s.b1), c1.id, { staffId: bm(s.b1).staffId });
    await svc.resolveConversation(bm(s.b1), c1.id);
    await svc.archiveConversation(hq, c1.id);
    await expect(svc.reopenConversation(hq, c1.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createMessage(hq, c1.id, { body: 'x', idempotencyKey: 'arch-key-001' })).rejects.toBeInstanceOf(ConflictError);
    /* same contact returns after archival → NEW conversation, old preserved */
    const c2 = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0129990001' })).conversation;
    expect(c2.id).not.toBe(c1.id);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('patient phone matching: unique match links; ambiguity does NOT auto-link; audit recorded', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    /* unique match on phone digits (012-1111111 → 60121111111) */
    const c1 = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '+60121111111' })).conversation;
    expect(c1.patientId).not.toBeNull();
    /* ambiguous (shared 0222222222 across two patients) → NO link */
    const c2 = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0222222222' })).conversation;
    expect(c2.patientId).toBeNull();
    const actions = audit.events.map((e) => e.action);
    expect(actions).toContain('wa_conversation_patient_linked');
    expect(actions).toContain('wa_patient_match_ambiguous');
    /* branch visibility: BM(b2) view of c1 (b1 conversation) denied (RLS hides row) */
    await expect(svc.getConversation(bm(s.b2), c1.id)).rejects.toThrowError(/not found|denied|Forbidden/i);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('message idempotency: same key replay returns original; same key different body → 409; backstop unique', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    const conv = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0195550001' })).conversation;
    const m1 = await svc.createMessage(hq, conv.id, { body: 'Hello', idempotencyKey: 'msg-key-000001' });
    expect(m1.status).toBe('queued');
    const replay = await svc.createMessage(hq, conv.id, { body: 'Hello', idempotencyKey: 'msg-key-000001' });
    expect(replay.id).toBe(m1.id); /* no duplicate row */
    await expect(svc.createMessage(hq, conv.id, { body: 'DIFFERENT', idempotencyKey: 'msg-key-000001' })).rejects.toBeInstanceOf(ConflictError);
    /* missing key → validation error (mandatory idempotency) */
    await expect(svc.createMessage(hq, conv.id, { body: 'no key' })).rejects.toBeInstanceOf(ValidationError);
    /* different key → new logical message allowed (cooldown reset: 60s gate) */
    await resetCooldown(admin.db);
    const m2 = await svc.createMessage(hq, conv.id, { body: 'Hello', idempotencyKey: 'msg-key-000002' });
    expect(m2.id).not.toBe(m1.id);
    const msgs = await svc.listMessages(hq, conv.id);
    expect(msgs.length).toBe(2);
    /* conversation auto-opened + first response stamped */
    const after = await svc.getConversation(hq, conv.id);
    expect(after.status).toBe('open');
    expect(after.firstResponseAt).not.toBeNull();
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('safety engine live: blocked send persists wa_safety_decisions + audit, no message row', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await svc.createChannel(hq, { branchId: s.b1, phone: '+60300000003' });
    /* channel stopped (not working) → gate 1 CHANNEL_UNAVAILABLE */
    const conv = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0197770001' })).conversation;
    await expect(svc.createMessage(hq, conv.id, { body: 'x', idempotencyKey: 'blk-key-00001' })).rejects.toBeInstanceOf(ForbiddenError);
    /* HQ read of safety decisions: HQ sees ALL branches via RLS (app_branch_ids
     * = full list) — query without explicit branch filter to avoid scoping. */
    const decisions = await svc.listSafetyDecisions(hq);
    expect(decisions.length).toBe(1);
    expect(decisions[0]!.decision).toBe('blocked');
    expect(decisions[0]!.blockedReason).toBe('CHANNEL_UNAVAILABLE');
    expect(audit.events.map((e) => e.action)).toContain('wa_message_blocked');
    expect((await svc.listMessages(hq, conv.id)).length).toBe(0);
    /* health < 70 → gate 2 LOW_HEALTH */
    await svc.transitionChannel(hq, ch.id, { status: 'starting' });
    await svc.transitionChannel(hq, ch.id, { status: 'working' });
    await svc.updateChannelHealth(hq, ch.id, { healthScore: 50 });
    await expect(svc.createMessage(hq, conv.id, { body: 'x', idempotencyKey: 'blk-key-00002' })).rejects.toBeInstanceOf(ForbiddenError);
    const d2 = await svc.listSafetyDecisions(hq, s.b1);
    expect(d2[0]!.blockedReason).toBe('LOW_HEALTH');
    /* health snapshot band */
    const health = await svc.getChannelHealth(hq, ch.id);
    expect(health.band).toBe('warming');
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('handoff / return-to-ai: deterministic AI↔HUMAN + append-only assignment history', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    const conv = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0198880001' })).conversation;
    await svc.startAiQueue(hq, conv.id);
    const hand = await svc.handoffConversation(bm(s.b1), conv.id);
    expect(hand.status).toBe('escalated');
    expect(hand.assignedTo).toBe(bm(s.b1).staffId);
    expect(hand.aiQueueState).toBe('handoff');
    const back = await svc.returnToAiConversation(hq, conv.id);
    expect(back.status).toBe('open');
    expect(back.assignedTo).toBeNull();
    /* receptionist cannot assign/unassign */
    await expect(svc.assignConversation(ba(s.b1), conv.id, { staffId: ba(s.b1).staffId })).rejects.toBeInstanceOf(ForbiddenError);
    /* AI queue lifecycle: received→buffering→ready→processing; illegal jump denied */
    await svc.startAiQueue(hq, conv.id);
    await svc.transitionAiQueue(hq, conv.id, { state: 'buffering' });
    await svc.transitionAiQueue(hq, conv.id, { state: 'ready' });
    await expect(svc.transitionAiQueue(hq, conv.id, { state: 'responded' })).rejects.toBeInstanceOf(ConflictError);
    await svc.transitionAiQueue(hq, conv.id, { state: 'processing' });
    await svc.transitionAiQueue(hq, conv.id, { state: 'responded' });
    await svc.transitionAiQueue(hq, conv.id, { state: 'closed' });
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('templates CRUD scoped: BM/BA own branch; duplicate name → 409; foreign branch denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const t1 = await svc.createTemplate(bm(s.b1), { branchId: s.b1, name: 'Greeting', body: 'Hi {name}', category: 'general' });
    await expect(svc.createTemplate(bm(s.b1), { branchId: s.b1, name: 'Greeting', body: 'Dup' })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createTemplate(bm(s.b1), { branchId: s.b2, name: 'X', body: 'Y' })).rejects.toBeInstanceOf(ForbiddenError);
    const bmList = await svc.listTemplates(bm(s.b1));
    expect(bmList.map((t) => t.id)).toContain(t1.id);
    await svc.updateTemplate(bm(s.b1), t1.id, { active: false });
    const baList = await svc.listTemplates(ba(s.b1));
    expect(baList.length).toBe(1);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('concurrency: two simultaneous handoffs converge to one deterministic state (row lock)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const a1 = new InMemoryAuditAdapter(); const a2 = new InMemoryAuditAdapter();
    const c1 = createFreshDatabase(RUNTIME_URL); const c2 = createFreshDatabase(RUNTIME_URL);
    const svc1 = build(c1.db, a1); const svc2 = build(c2.db, a2);
    const ch = await makeChannel(svc1, s.b1);
    const conv = (await svc1.createConversation(hq, { channelId: ch.id, contactPhone: '0196660001' })).conversation;
    const [r1, r2] = await Promise.allSettled([
      svc1.handoffConversation(bm(s.b1), conv.id),
      svc2.handoffConversation(hq, conv.id),
    ]);
    const okCount = [r1, r2].filter((r) => r.status === 'fulfilled').length;
    expect(okCount).toBeGreaterThanOrEqual(1);
    const final = await svc1.getConversation(hq, conv.id);
    expect(final.status).toBe('escalated');
    expect(final.assignedTo).not.toBeNull();
    /* concurrent duplicate message creation with same key → exactly one row */
    const [m1, m2] = await Promise.allSettled([
      svc1.createMessage(hq, conv.id, { body: 'same', idempotencyKey: 'race-key-00001' }),
      svc2.createMessage(hq, conv.id, { body: 'same', idempotencyKey: 'race-key-00001' }),
    ]);
    const ids = [m1, m2].filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    const msgs = await svc1.listMessages(hq, conv.id);
    expect(msgs.length).toBe(1);
    if (ids.length === 2) expect(ids[0]).toBe(ids[1]);
    await purge(admin.db); await admin.close(); await c1.close(); await c2.close();
  });

  dbIt('audit: every mutation recorded in-transaction (channel/conversation/message/template/assignment)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    const conv = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0194440001' })).conversation;
    await svc.createMessage(hq, conv.id, { body: 'audit me', idempotencyKey: 'aud-key-00001' });
    await svc.assignConversation(hq, conv.id, { staffId: hq.staffId });
    await svc.createTemplate(hq, { branchId: s.b1, name: 'T1', body: 'B1' });
    const actions = audit.events.map((e) => e.action);
    for (const expected of ['wa_channel_created', 'wa_channel_working', 'wa_channel_health_updated', 'wa_conversation_created', 'wa_message_created', 'wa_conversation_assign', 'wa_template_created']) {
      expect(actions).toContain(expected);
    }
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('pagination: bounded lists honour limit/offset (no unbounded queries)', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    for (let i = 0; i < 5; i++) {
      await svc.createConversation(hq, { channelId: ch.id, contactPhone: `01933000${10 + i}` });
    }
    const page1 = await svc.listConversations(hq, { branchId: s.b1, limit: '2', offset: '0' });
    const page2 = await svc.listConversations(hq, { branchId: s.b1, limit: '2', offset: '2' });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
    const filtered = await svc.listConversations(hq, { branchId: s.b1, status: 'new', unassigned: 'true' });
    expect(filtered.length).toBe(5);
    await purge(admin.db); await admin.close(); await close();
  });

  dbIt('message lifecycle (simulated delivery states): queued→sent→delivered→read; illegal jump denied', async () => {
    const admin = createFreshDatabase(ADMIN_URL); await purge(admin.db);
    const s = await seed(admin.db);
    const audit = new InMemoryAuditAdapter();
    const { db, close } = createFreshDatabase(RUNTIME_URL); const svc = build(db, audit);
    const ch = await makeChannel(svc, s.b1);
    const conv = (await svc.createConversation(hq, { channelId: ch.id, contactPhone: '0192220001' })).conversation;
    const m = await svc.createMessage(hq, conv.id, { body: 'track me', idempotencyKey: 'trk-key-00001' });
    await expect(svc.transitionMessage(hq, m.id, { status: 'read' })).rejects.toBeInstanceOf(ConflictError);
    await svc.transitionMessage(hq, m.id, { status: 'sent' });
    await svc.transitionMessage(hq, m.id, { status: 'delivered' });
    const done = await svc.transitionMessage(hq, m.id, { status: 'read' });
    expect(done.readAt).not.toBeNull();
    await resetCooldown(admin.db); /* 60s per-channel cooldown between logical sends */
    const failed = await svc.createMessage(hq, conv.id, { body: 'fail me', idempotencyKey: 'trk-key-00002' });
    await svc.transitionMessage(hq, failed.id, { status: 'failed' });
    await expect(svc.transitionMessage(hq, failed.id, { status: 'sent' })).rejects.toBeInstanceOf(ConflictError);
    await purge(admin.db); await admin.close(); await close();
  });
});
