import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { domainEvents, processedEvents } from '../database/schema';
import { Database } from '../database/database';
import { ScopedOutboxEvent } from './outbox.types';

@Injectable()
export class OutboxRepository {
  async findScopedEvent(tx: Database, event: ScopedOutboxEvent) {
    const rows = await tx.select().from(domainEvents).where(and(
      eq(domainEvents.id, event.eventId), eq(domainEvents.orgId, event.orgId),
      event.branchId ? eq(domainEvents.branchId, event.branchId) : isNull(domainEvents.branchId),
    )).limit(1);
    return rows[0] ?? null;
  }

  async wasProcessed(tx: Database, consumer: string, event: ScopedOutboxEvent): Promise<boolean> {
    const rows = await tx.select().from(processedEvents).where(and(
      eq(processedEvents.consumer, consumer), eq(processedEvents.eventId, event.eventId),
      eq(processedEvents.orgId, event.orgId),
    )).limit(1);
    return rows.length > 0;
  }

  async markProcessed(tx: Database, consumer: string, event: ScopedOutboxEvent): Promise<void> {
    await tx.insert(processedEvents).values({ consumer, eventId: event.eventId, orgId: event.orgId, branchId: event.branchId });
  }

  async markPublished(tx: Database, event: ScopedOutboxEvent): Promise<void> {
    await tx.update(domainEvents).set({ publishedAt: new Date() }).where(and(
      eq(domainEvents.id, event.eventId), eq(domainEvents.orgId, event.orgId),
      event.branchId ? eq(domainEvents.branchId, event.branchId) : isNull(domainEvents.branchId),
    ));
  }

  async listUnpublishedForScope(tx: Database, orgId: string, branchIds: readonly string[]) {
    if (branchIds.length !== 1) throw new Error('Scoped reconciliation requires exactly one branch');
    return tx.select().from(domainEvents).where(and(eq(domainEvents.orgId, orgId), eq(domainEvents.branchId, branchIds[0]!), isNull(domainEvents.publishedAt)));
  }
}
