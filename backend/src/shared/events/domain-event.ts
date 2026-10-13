/**
 * Domain event contract + outbox-ready emitter abstraction.
 * Naming: DomainEntityAction (past tense) — matches locked CROSS_DOMAIN_EVENTS.
 */
import { CROSS_DOMAIN_EVENTS } from '../architecture/architecture.contract';

export interface DomainEvent<T = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string; // ISO 8601
  readonly orgId: string;
  readonly branchId: string | null;
  readonly correlationId: string;
  readonly data: T;
  readonly version: number;
}

/** Emits events to the transactional outbox (implemented in DB sprint). */
export abstract class DomainEventBus {
  abstract publish<T>(event: DomainEvent<T>): Promise<void> | void;
}

/** True if the event type is part of the locked cross-domain contract. */
export function isContractEvent(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(CROSS_DOMAIN_EVENTS, eventType);
}
