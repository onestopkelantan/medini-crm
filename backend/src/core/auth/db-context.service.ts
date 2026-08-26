import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
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
 * DbContextService — establishes the trusted per-request PostgreSQL security
 * context (GUCs) consumed by the RLS policies (Part 11/12).
 *
 * Context is DERIVED FROM THE AUTHENTICATED PRINCIPAL, never from client input:
 *   app.role       ← principal.role
 *   app.branch_ids ← principal.branchId (hq → all branches)
 *   app.doctor_id  ← principal.doctorId
 * A client CANNOT forge these — they come from the DB-resolved Principal.
 *
 * Connection-pool safety (Part 12, security-critical): values are set with
 * `set_config(..., is_local = true)` inside `db.transaction(...)` so they are
 * TRANSACTION-LOCAL and reset automatically at COMMIT/ROLLBACK. Request A's
 * branch context can never leak into Request B on the same pooled connection.
 *
 * hq needs the full branch list for `app_branch_ids()`; it is read from the
 * branches table (admin path) once per call.
 */
@Injectable()
export class DbContextService {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  /** True when a runtime DB is configured. */
  get available(): boolean {
    return this.db != null;
  }

  /**
   * Run `fn` inside a transaction with the principal's security context applied.
   * The GUCs are transaction-local — they cannot leak across pooled requests.
   */
  async runAs<T>(principal: Principal, fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database not configured');
    const db = this.db;

    return db.transaction(async (tx: unknown) => {
      const t = tx as Database;
      const role = principal.role;

      /* D2 fix (GLM): establish the trusted context FIRST, before querying any
       * RLS-protected scoped data. Under FORCE RLS a query issued before the
       * GUC is set returns 0 rows. Sequence:
       *   BEGIN → SET LOCAL app.role → query branches (now sees HQ context) →
       *   SET LOCAL app.branch_ids/app.doctor_id → run operation → COMMIT. */
      await t.execute(sql`SELECT set_config('app.role', ${role}, true)`);
      await t.execute(sql`SELECT set_config('app.org_id', ${principal.orgId}, true)`);

      let branchIds: string[] = [];
      if (role === 'hq') {
        /* HQ needs the full branch list for app_branch_ids(); safe to read now
         * that app.role = 'hq' is active in THIS transaction. */
        const rows = await t.execute(sql`SELECT id::text AS id FROM branches WHERE deleted_at IS NULL`);
        branchIds = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
      } else if (principal.branchId) {
        branchIds = [principal.branchId];
      }

      /* set_config(name, value, is_local=true) → scoped to THIS transaction. */
      await t.execute(sql`SELECT set_config('app.branch_ids', ${branchIds.join(',')}, true)`);
      await t.execute(
        sql`SELECT set_config('app.doctor_id', ${principal.doctorId ?? ''}, true)`,
      );
      /* S10 GLM: staff identity for least-privilege self-scoped RLS (refresh_tokens). */
      await t.execute(sql`SELECT set_config('app.staff_id', ${principal.staffId}, true)`);

      return fn(t);
    });
  }

  /** Executes trusted queued work without a human staff identity. Scope is
   * supplied by the persisted event/job envelope, never by HTTP input. */
  async runAsWorker<T>(context: ScopedSystemWorkerContext, fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database not configured');
    if (!context.orgId || context.branchIds.some((id) => !id)) throw new Error('Invalid system worker scope');
    return this.db.transaction(async (tx: unknown) => {
      const t = tx as Database;
      await t.execute(sql`SELECT set_config('app.role', 'system_worker', true)`);
      await t.execute(sql`SELECT set_config('app.org_id', ${context.orgId}, true)`);
      await t.execute(sql`SELECT set_config('app.branch_ids', ${context.branchIds.join(',')}, true)`);
      await t.execute(sql`SELECT set_config('app.doctor_id', '', true)`);
      /* S10 GLM: refresh_tokens worker policy needs app.staff_id set (empty for worker). */
      await t.execute(sql`SELECT set_config('app.staff_id', '', true)`);
      return fn(t);
    });
  }
}
