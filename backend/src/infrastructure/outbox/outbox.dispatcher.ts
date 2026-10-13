import { Injectable } from '@nestjs/common';
import { QueueRegistry } from '../queue/queue.registry';
import { ScopedOutboxEvent, assertScopedOutboxEvent } from './outbox.types';

/** Dispatches only a known, trusted event scope. It never scans organisations. */
@Injectable()
export class ScopedOutboxDispatcher {
  constructor(private readonly queues: QueueRegistry) {}

  async dispatch(event: ScopedOutboxEvent): Promise<void> {
    assertScopedOutboxEvent(event);
    await this.queues.enqueue('domain-events', 'process-event', { ...event }, event.eventId);
  }
}
