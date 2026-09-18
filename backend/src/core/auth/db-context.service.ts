import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { Principal } from './principal';

export interface ScopedSystemWorkerContext {
  readonly orgId: string;
  readonly branchIds: readonly string[];
  readonly correlationId: string;
  readonly source: 'system_worker';
}

/** Non-human identity used only by trusted outbox/queue code. */
export const SYSTEM_WORKER_PRINCIPAL = {
  staffId: '00000000-0000-0000-0000-000000000000',
  username: 'system-worker',
  role: 'system_worker',
  doctorId: null,
} as const;

/**
 * DbContextService — MySQL migration edition.
 *
 * PostgreSQL GUC + RLS context (`set_config`, `app.role`, etc.) has no direct
 * MySQL equivalent. The application already passes org/branch/doctor scope to
 * its repositories, so the MySQL path keeps the transaction boundary while
 * relying on those explicit predicates.
 *
 * SECURITY: MySQL has no PostgreSQL-style RLS here. Do not ship the migration
 * to production until org/branch isolation integration tests pass for every
 * repository that handles patient/clinical/finance/WhatsApp data.
 */
@Injectable()
export class DbContextService {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  get available(): boolean {
    return this.db != null;
  }

  async runAs<T>(principal: Principal, fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database not configured');
    if (!principal.orgId || !principal.staffId) throw new Error('Invalid authenticated database scope');
    return this.db.transaction(async (tx: Database) => fn(tx));
  }

  async runAsWorker<T>(context: ScopedSystemWorkerContext, fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database not configured');
    if (!context.orgId || context.branchIds.some((id) => !id)) throw new Error('Invalid system worker scope');
    return this.db.transaction(async (tx: Database) => fn(tx));
  }
}
