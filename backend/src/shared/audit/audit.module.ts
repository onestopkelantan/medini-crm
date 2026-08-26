import { Global, Module } from '@nestjs/common';
import { AuditService, InMemoryAuditAdapter, AUDIT_PORT } from './audit.service';
import { DbAuditAdapter } from '../../infrastructure/database/db-audit.adapter';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';

/**
 * AuditModule — global audit wiring (Sprint 1 Task 2 / D1 fix).
 *
 * GLM D1: the app previously bound AUDIT_PORT to InMemoryAuditAdapter, so login
 * events were never persisted to audit_log. We now bind AUDIT_PORT to
 * DbAuditAdapter (PostgreSQL, append-only) whenever a runtime DB is available.
 * When no DB is configured (unit tests, DB-less boot) we fall back to the
 * in-memory adapter so the app still starts honestly.
 *
 * This does NOT create a second audit system — it uses the existing
 * AuditPort / AuditService / DbAuditAdapter / audit_log architecture.
 */
@Global()
@Module({
  providers: [
    InMemoryAuditAdapter,
    {
      provide: AUDIT_PORT,
      inject: [DATABASE, InMemoryAuditAdapter],
      useFactory: (db: Database | null, mem: InMemoryAuditAdapter) =>
        db ? new DbAuditAdapter(db) : mem,
    },
    AuditService,
  ],
  exports: [AuditService, AUDIT_PORT],
})
export class AuditModule {}
