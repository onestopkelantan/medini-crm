import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

let pool: Pool | null = null;

/**
 * Create a Drizzle database client backed by a pooled pg connection.
 * Connection is established lazily; callers must handle unreachable DB honestly.
 *
 * NOTE: this registers a module-level singleton pool (closed by closeDatabase).
 * For independent pools (e.g. multiple integration specs in one vitest run),
 * use createFreshDatabase — it does NOT touch the singleton, so concurrent
 * specs never race on closeDatabase().
 */
export function createDatabase(connectionString: string) {
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return drizzle(pool, { schema });
}

/** Independent (non-singleton) pool client — safe for parallel test specs. */
export function createFreshDatabase(connectionString: string) {
  const p = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  const client = drizzle(p, { schema });
  return { db: client, close: async () => { await p.end().catch(() => undefined); } };
}

/** Honest liveness probe — runs a trivial query; throws/false if unreachable. */
export async function pingDatabase(connectionString: string): Promise<boolean> {
  const p = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await p.end().catch(() => undefined);
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
  }
}
