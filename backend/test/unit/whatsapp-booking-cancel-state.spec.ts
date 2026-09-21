import { describe, it, expect, vi } from 'vitest';
import { WhatsappWebhookController } from '../../src/modules/ai-manager/presentation/whatsapp-webhook.controller';

function makeController(dbCtx: any = {}) {
  const oldRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;

  const controller = new WhatsappWebhookController(
    {} as any,
    dbCtx as any,
    {} as any,
    {} as any,
  ) as any;

  if (oldRedisUrl !== undefined) {
    process.env.REDIS_URL = oldRedisUrl;
  }

  return controller;
}

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
        '60123456789@c.us',
        'saya nak cancel',
        {},
      );

    expect(handled).toBe(true);

    expect(redis.set).not.toHaveBeenCalled();

    expect(controller.sendText).toHaveBeenCalledWith(
      '60123456789@c.us',
      expect.stringContaining('APT-0065'),
    );

    expect(controller.sendText).toHaveBeenCalledWith(
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
      '60123456789@c.us',
      expect.stringContaining('APT-0066'),
    );
  });

});
