import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditPort, AuditEvent, AuditSource } from './audit.port';
import { getCorrelationId } from '../correlation/correlation';

/** In-memory audit adapter — used at Sprint 0 and in tests. */
@Injectable()
export class InMemoryAuditAdapter extends AuditPort {
  readonly events: AuditEvent[] = [];
  record(event: AuditEvent, _tx?: unknown): void {
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
  }
}

export const AUDIT_PORT = 'AUDIT_PORT';

export interface RecordAuditInput {
  actorId: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  orgId?: string;
  branchId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  source?: AuditSource;
}

/**
 * AuditService — single entry point for immutable audit records. View-only
 * actions must NOT be recorded (per locked behavior); callers record only
 * state-changing actions (and provable blocked/rejected actions).
 */
@Injectable()
export class AuditService {
  constructor(@Optional() @Inject(AUDIT_PORT) private readonly port?: AuditPort) {}

  async record(input: RecordAuditInput, tx?: unknown): Promise<AuditEvent> {
    const event: AuditEvent = {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      orgId: input.orgId ?? 'medini-dental-group',
      branchId: input.branchId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      source: input.source ?? 'api',
      correlationId: getCorrelationId(),
      timestamp: new Date().toISOString(),
    };
    /* Pass the request transaction through (Blocker 1 fix) so the audit row
     * commits/rolls back WITH the business mutation on the SAME connection. */
    await this.port?.record(event, tx);
    return event;
  }
}
