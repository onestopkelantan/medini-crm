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
 * DbContextService — MySQL transaction and scope boundary.
 *
 * The application passes org/branch/doctor scope explicitly to repositories;
 * every data access path must enforce those predicates inside this transaction.
 * Security tests in the MySQL CI profile verify the supported repositories.
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
