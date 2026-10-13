export interface ScopedOutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly orgId: string;
  readonly branchId: string | null;
  readonly correlationId: string;
  readonly source: 'domain';
  readonly payload: Record<string, unknown>;
}

export function assertScopedOutboxEvent(event: ScopedOutboxEvent): void {
  if (!event.eventId || !event.eventType || !event.orgId || !event.correlationId) {
    throw new Error('Outbox event is missing trusted scope');
  }
  if (event.branchId === '') throw new Error('Outbox branch scope is invalid');
}
