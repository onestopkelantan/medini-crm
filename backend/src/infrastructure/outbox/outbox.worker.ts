import { Injectable } from '@nestjs/common';
import { DbContextService, ScopedSystemWorkerContext } from '../../core/auth/db-context.service';
import { runWithCorrelation } from '../../shared/correlation/correlation';
import { OutboxRepository } from './outbox.repository';
import { ScopedOutboxEvent, assertScopedOutboxEvent } from './outbox.types';

export type OutboxHandler = (event: ScopedOutboxEvent) => Promise<void>;

/** Event-id scoped worker. It cannot discover work across organisations. */
@Injectable()
export class OutboxWorker {
  constructor(private readonly dbCtx: DbContextService, private readonly repo: OutboxRepository) {}

  async process(event: ScopedOutboxEvent, handler: OutboxHandler): Promise<'processed' | 'duplicate'> {
    assertScopedOutboxEvent(event);
    const scope: ScopedSystemWorkerContext = {
      orgId: event.orgId,
      branchIds: event.branchId ? [event.branchId] : [],
      correlationId: event.correlationId,
      source: 'system_worker',
    };
    return runWithCorrelation({ correlationId: event.correlationId }, async () => this.dbCtx.runAsWorker(scope, async (tx) => {
      const stored = await this.repo.findScopedEvent(tx, event);
      if (!stored) throw new Error('Scoped outbox event not found or RLS denied');
      if (await this.repo.wasProcessed(tx, 'outbox-worker', event)) return 'duplicate';
      await handler(event);
      await this.repo.markProcessed(tx, 'outbox-worker', event);
      await this.repo.markPublished(tx, event);
      return 'processed';
    }));
  }
}
