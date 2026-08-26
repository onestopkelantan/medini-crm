import { Injectable } from '@nestjs/common';
import { AuditPort, AuditEvent } from '../../shared/audit/audit.port';
import { Database } from './database';
import { auditLog } from './schema';

/**
 * Persistent audit adapter (PostgreSQL) — append-only audit_log.
 * Swaps the Sprint 0 in-memory adapter without changing the AuditService interface.
 */
@Injectable()
export class DbAuditAdapter extends AuditPort {
  constructor(private readonly db: Database) {
    super();
  }

  /**
   * Write the audit row on the SAME transaction connection as the business
   * mutation when `tx` is provided (Blocker 1 fix: no second pool connection
   * per request → no pool exhaustion under concurrency; atomic commit/rollback
   * with the mutation). Falls back to the pool client only when no tx exists
   * (e.g. login audit before any transaction).
   */
  async record(event: AuditEvent, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as Database;
    await db.insert(auditLog).values({
      orgId: event.orgId,
      branchId: event.branchId,
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      entity: event.entity,
      entityId: event.entityId,
      before: event.before ?? null,
      after: event.after ?? null,
      source: event.source,
      correlationId: event.correlationId,
      createdAt: new Date(event.timestamp),
    });
  }
}
