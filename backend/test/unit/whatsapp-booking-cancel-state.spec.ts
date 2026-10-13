import { describe, it, expect, vi } from 'vitest';
import { WhatsappWebhookController } from '../../src/modules/ai-manager/presentation/whatsapp-webhook.controller';

/**
 * The private controller surface this spec drives directly. Typed as a plain
 * interface (rather than the class) so the private members stay reachable from
 * the test without widening everything to `any`.
 */
type RedisStub = {
  get?: (...args: unknown[]) => Promise<unknown>;
  del?: (...args: unknown[]) => Promise<unknown>;
  set?: (...args: unknown[]) => Promise<unknown>;
};

type ControllerStub = {
  redis: RedisStub | null;
  setBookingMemory: (chatId: string, memory: Record<string, unknown>) => Promise<void>;
  handleAppointmentAction: (
    scope: unknown,
    chatId: string,
    text: string,
    payload: unknown,
  ) => Promise<boolean>;
  resolvePhone: (chatId: string, payload: unknown) => Promise<string>;
  sendText: (sessionName: string, chatId: string, text: string) => Promise<void>;
};

function makeController(dbCtx: unknown = {}): ControllerStub {
  const oldRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;

  const controller = new WhatsappWebhookController(
    {} as never,
    dbCtx as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    /* WaBranchResolverService — routing is covered by wa-branch-resolver.spec.ts.
     * WaOptOutService — the STOP gate is covered by wa-opt-out.spec.ts.
     * NotificationService — the bell is covered by notification.spec.ts.
     * AiPolicyPort — policy is covered by ai-control-agent-paused.spec.ts.
     * All are stubs here because this spec exercises booking/cancellation state. */
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    /* WahaAdapter — A2 send pre-flight is covered by the pure guard spec
     * (waha-session-guard.spec.ts); stubbed here so the constructor arity
     * stays honest. */
    { assertSendable: async () => ({ allowed: true, shouldLock: false }) } as never,
  ) as unknown as ControllerStub;

  if (oldRedisUrl !== undefined) {
    process.env.REDIS_URL = oldRedisUrl;
  }

  return controller;
}

/* Branch scope for these calls. Routing itself is covered by
 * wa-branch-resolver.spec.ts; this spec exercises booking/cancellation state. */
const TEST_SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  branchId: 'af0a0841-0786-40b2-9b4e-30ed9270a659',
  branchName: 'Setia Tropika',
  sessionName: 'medini-setia-tropika',
};

describe('WhatsApp booking/cancellation state isolation', () => {
  it('clears stale cancellation state when booking memory is saved', async () => {
    const controller = makeController();

    const redis = {
      del: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
    };

    controller.redis = redis;

    await controller.setBookingMemory('60123456789@c.us', {
      name: 'Test Patient',
      date: '2026-09-22',
      time: '10:00',
      treatment: 'Scaling',
      branch: 'Setia Tropika',
      salutation: 'Encik',
    });

    expect(redis.del).toHaveBeenCalledWith(
      'medini:whatsapp:appointment-action:60123456789@c.us',
    );

    expect(redis.set).toHaveBeenCalledWith(
      'medini:whatsapp:booking:60123456789@c.us',
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('clears booking memory when cancellation flow begins', async () => {
    const dbCtx = {
      runAsWorker: vi.fn(async () => ({
        rows: [
          {
            id: 'appointment-test-id',
            patient_name: 'Test Patient',
            booking_date: '2026-09-22',
            scheduled_time: '10:00:00',
          },
        ],
      })),
    };

    const controller = makeController(dbCtx);

    const redis = {
      get: vi.fn(async () => null),
      del: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
    };

    controller.redis = redis;
    controller.resolvePhone = vi.fn(async () => '60123456789');
    controller.sendText = vi.fn(async () => undefined);

    const handled = await controller.handleAppointmentAction(
      TEST_SCOPE,
      '60123456789@c.us',
      'batal',
      {},
    );

    expect(handled).toBe(true);

    expect(redis.del).toHaveBeenCalledWith(
      'medini:whatsapp:booking:60123456789@c.us',
    );

    expect(redis.set).toHaveBeenCalledWith(
      'medini:whatsapp:appointment-action:60123456789@c.us',
      'appointment-test-id',
      'EX',
      600,
    );
  });

  it('does not auto-select when multiple active appointments exist', async () => {
    const dbCtx = {
      runAsWorker: vi.fn(async () => ({
        rows: [
          {
            id: 'appointment-1',
            code: 'APT-0065',
            patient_name: 'Patient One',
            booking_date: '2026-09-22',
            scheduled_time: '10:00:00',
          },
          {
            id: 'appointment-2',
            code: 'APT-0066',
            patient_name: 'Audit Test',
            booking_date: '2026-09-22',
            scheduled_time: '10:30:00',
          },
        ],
      })),
    };

    const controller = makeController(dbCtx);

    const redis = {
      get: vi.fn(async () => null),
      del: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
    };

    controller.redis = redis;
    controller.resolvePhone =
      vi.fn(async () => '60123456789');
    controller.sendText =
      vi.fn(async () => undefined);

    const handled =
      await controller.handleAppointmentAction(
        TEST_SCOPE,
        '60123456789@c.us',
        'saya nak cancel',
        {},
      );

    expect(handled).toBe(true);

    expect(redis.set).not.toHaveBeenCalled();

    /* sendText is session-scoped: replies go out on the branch's own number. */
    expect(controller.sendText).toHaveBeenCalledWith(
      TEST_SCOPE.sessionName,
      '60123456789@c.us',
      expect.stringContaining('APT-0065'),
    );

    expect(controller.sendText).toHaveBeenCalledWith(
      TEST_SCOPE.sessionName,
      '60123456789@c.us',
      expect.stringContaining('APT-0066'),
    );
  });

  it('selects the requested appointment code for cancellation', async () => {
    const dbCtx = {
      runAsWorker: vi.fn(async () => ({
        rows: [
          {
            id: 'appointment-0066',
            code: 'APT-0066',
            patient_name: 'Audit Test',
            booking_date: '2026-09-22',
            scheduled_time: '10:30:00',
          },
        ],
      })),
    };

    const controller = makeController(dbCtx);

    const redis = {
      get: vi.fn(async () => null),
      del: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
    };

    controller.redis = redis;
    controller.resolvePhone =
      vi.fn(async () => '60123456789');
    controller.sendText =
      vi.fn(async () => undefined);

    const handled =
      await controller.handleAppointmentAction(
        TEST_SCOPE,
        '60123456789@c.us',
        'cancel APT-0066',
        {},
      );

    expect(handled).toBe(true);

    expect(redis.set).toHaveBeenCalledWith(
      'medini:whatsapp:appointment-action:60123456789@c.us',
      'appointment-0066',
      'EX',
      600,
    );

    expect(controller.sendText).toHaveBeenCalledWith(
      TEST_SCOPE.sessionName,
      '60123456789@c.us',
      expect.stringContaining('APT-0066'),
    );
  });

});
