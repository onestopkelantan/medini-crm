import { Injectable } from '@nestjs/common';
import { DbContextService, ScopedSystemWorkerContext } from '../../core/auth/db-context.service';
import { ScopedOutboxDispatcher } from './outbox.dispatcher';
import { OutboxRepository } from './outbox.repository';

/** Repairs only a caller-supplied organisation and one branch. There is no
 * global unpublished-event scan; callers must already hold trusted scope. */
@Injectable()
export class ScopedOutboxRecovery {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: OutboxRepository,
    private readonly dispatcher: ScopedOutboxDispatcher,
  ) {}

  async reconcile(context: ScopedSystemWorkerContext): Promise<number> {
    if (context.branchIds.length !== 1) throw new Error('Outbox recovery requires one explicit branch scope');
    const events = await this.dbCtx.runAsWorker(context, (tx) =>
      this.repo.listUnpublishedForScope(tx, context.orgId, context.branchIds));
    for (const event of events) {
      await this.dispatcher.dispatch({
        eventId: event.id, eventType: event.eventType, orgId: event.orgId,
        branchId: event.branchId, correlationId: event.correlationId ?? context.correlationId,
        source: 'domain', payload: event.payload as Record<string, unknown>,
      });
    }
    return events.length;
  }
}
