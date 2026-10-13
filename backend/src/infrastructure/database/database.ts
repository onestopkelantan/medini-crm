import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/mysql-core';
import mysql, { type Pool } from 'mysql2/promise';
import * as schema from './schema';

/**
 * MySQL compatibility database facade.
 *
 * This migration branch still contains a number of legacy database-era repository
 * calls such as `.returning()` and `.onConflictDoNothing()`. MySQL does not
 * support those APIs natively, so the facade below emulates them while the
 * repositories are migrated incrementally:
 *
 *  - INSERT ... returning() -> MySQL `$returningId()` + SELECT by generated id
 *  - UPDATE ... returning() -> lock matching ids, UPDATE, then SELECT by id
 *  - DELETE ... returning() -> lock/read matching rows, DELETE, return snapshot
 *  - onConflictDoNothing()  -> ON DUPLICATE KEY UPDATE id = id
 *  - onConflictDoUpdate()   -> ON DUPLICATE KEY UPDATE <set>
 *  - execute()              -> legacy database-like `{ rows, affectedRows }` shape
 *
 * IMPORTANT: this is a migration compatibility layer, not a reason to keep
 * legacy database-specific repository code forever. Remove it after the MySQL
 * repository refactor and regression tests are complete.
 */

type RawDb = MySql2Database<typeof schema>;
type DbTable = Parameters<RawDb['insert']>[0];
/** Table handle as seen by the facade: the drizzle table plus its (optional) id. */
type CompatTable = DbTable & { id?: unknown };

/**
 * Type-only declaration merging.
 *
 * Drizzle's MySQL builders do not declare the legacy database-era methods the Proxy
 * facade below emulates at runtime, so we restore them here on the builder types
 * instead of weakening every call site to `any`. This is types only — it emits
 * no runtime code, and it is scoped to builders produced by this facade (no
 * other module instantiates raw drizzle on its own).
 */
declare module 'drizzle-orm/mysql-core' {
  interface MySqlInsertBase<TTable, TQueryResult, TPreparedQueryHKT, TReturning, TDynamic, TExcludedMethods> {
    returning(fields?: unknown): Promise<Array<TTable extends { $inferSelect: infer S } ? S : unknown>>;
    onConflictDoNothing(config?: unknown): MySqlInsertBase<TTable, TQueryResult, TPreparedQueryHKT, TReturning, TDynamic, TExcludedMethods>;
    onConflictDoUpdate(config: { set: Record<string, unknown> }): MySqlInsertBase<TTable, TQueryResult, TPreparedQueryHKT, TReturning, TDynamic, TExcludedMethods>;
  }
  interface MySqlUpdateBase<TTable, TQueryResult, TPreparedQueryHKT, TDynamic, TExcludedMethods> {
    returning(fields?: unknown): Promise<Array<TTable extends { $inferSelect: infer S } ? S : unknown>>;
    /*
     * Merging requires the same type-parameter list as drizzle's declaration;
     * these are referenced here only so the merge is well-formed (type-only —
     * the property never exists at runtime on the facade's Proxy builders).
     */
    readonly __compatParams?: [TQueryResult, TPreparedQueryHKT, TDynamic, TExcludedMethods];
  }
  interface MySqlDeleteBase<TTable, TQueryResult, TPreparedQueryHKT, TDynamic, TExcludedMethods> {
    returning(fields?: unknown): Promise<Array<TTable extends { $inferSelect: infer S } ? S : unknown>>;
    /* See MySqlUpdateBase.__compatParams — merge well-formedness only. */
    readonly __compatParams?: [TQueryResult, TPreparedQueryHKT, TDynamic, TExcludedMethods];
  }
}

export interface Database {
  transaction<T>(
    callback: (tx: Database) => Promise<T>,
    config?: unknown,
  ): Promise<T>;

  execute(query: unknown): Promise<CompatExecuteResult>;

  insert: RawDb['insert'];
  update: RawDb['update'];
  delete: RawDb['delete'];
  select: RawDb['select'];

  [key: string]: unknown;
}

let pool: Pool | null = null;

type CompatExecuteResult = {
  rows: unknown[];
  affectedRows: number;
  insertId: number | string | null;
  raw: unknown;
};

/** Members the facade drives by name on the wrapped drizzle builders. */
interface InsertTarget {
  $returningId(): Promise<Array<{ id?: unknown }> | null>;
  onDuplicateKeyUpdate(config: { set: Record<string, unknown> }): object;
}

interface WhereableBuilder {
  where(condition: SQL): object;
}

/** The select query the returning() emulations build, lock and await. */
interface CompatSelect {
  where(condition: SQL): CompatSelect;
  for(strength: 'update'): CompatSelect;
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1>;
}

function normalizeExecuteResult(result: unknown): CompatExecuteResult {
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    const shaped = result as { rows: unknown[]; rowCount?: number; affectedRows?: number; insertId?: number | string | null };
    return {
      rows: shaped.rows,
      affectedRows: Number(shaped.rowCount ?? shaped.affectedRows ?? shaped.rows.length ?? 0),
      insertId: shaped.insertId ?? null,
      raw: result,
    };
  }

  // drizzle-orm/mysql2 returns the mysql2 tuple: [rowsOrHeader, fields]
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) {
      return { rows: first, affectedRows: first.length, insertId: null, raw: result };
    }
    if (first && typeof first === 'object') {
      const header = first as { affectedRows?: number; insertId?: number | string | null };
      return {
        rows: [],
        affectedRows: Number(header.affectedRows ?? 0),
        insertId: header.insertId ?? null,
        raw: result,
      };
    }
  }

  return { rows: [], affectedRows: 0, insertId: null, raw: result };
}

function selectQuery(db: Database, table: CompatTable, fields?: SelectedFields): CompatSelect {
  const q = fields ? db.select(fields).from(table) : db.select().from(table);
  return q as unknown as CompatSelect;
}

function wrapInsert(db: Database, table: CompatTable, builder: object): object {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') return (target as { then?: (...args: unknown[]) => unknown }).then?.bind(target);

      if (prop === 'returning') {
        return async (fields?: SelectedFields) => {
          const ids = await (target as unknown as InsertTarget).$returningId();
          const values = (ids ?? []).map((row) => row?.id).filter(Boolean);
          if (!values.length || !table?.id) return [];
          const q = selectQuery(db, table, fields);
          return q.where(inArray(table.id as unknown as SQLWrapper, values));
        };
      }

      if (prop === 'onConflictDoNothing') {
        return (_opts?: unknown) => {
          const next = (target as unknown as InsertTarget).onDuplicateKeyUpdate({ set: { id: sql`${table.id}` } });
          return wrapInsert(db, table, next);
        };
      }

      if (prop === 'onConflictDoUpdate') {
        return (opts: { set: Record<string, unknown> }) => {
          const next = (target as unknown as InsertTarget).onDuplicateKeyUpdate({ set: opts.set });
          return wrapInsert(db, table, next);
        };
      }

      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const next = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (next && typeof next === 'object') return wrapInsert(db, table, next);
        return next;
      };
    },
  });
}

function wrapUpdate(db: Database, table: CompatTable, builder: object, state: { where?: SQL } = {}): object {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') return (target as { then?: (...args: unknown[]) => unknown }).then?.bind(target);

      if (prop === 'where') {
        return (condition: SQL) => {
          const next = (target as WhereableBuilder).where(condition);
          return wrapUpdate(db, table, next, { ...state, where: condition });
        };
      }

      if (prop === 'returning') {
        return async (fields?: SelectedFields) => {
          // Capture the target ids BEFORE the update. This preserves optimistic
          // locking predicates that may stop matching after the UPDATE.
          let idQuery = selectQuery(db, table, { id: table.id } as unknown as SelectedFields);
          if (state.where) idQuery = idQuery.where(state.where);
          if (typeof idQuery.for === 'function') idQuery = idQuery.for('update');
          const before = await idQuery;
          const ids = (before ?? []).map((row) => (row as { id?: unknown })?.id).filter(Boolean);
          if (!ids.length) return [];

          await target;

          const q = selectQuery(db, table, fields);
          return q.where(inArray(table.id as unknown as SQLWrapper, ids));
        };
      }

      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const next = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (next && typeof next === 'object') return wrapUpdate(db, table, next, state);
        return next;
      };
    },
  });
}

function wrapDelete(db: Database, table: CompatTable, builder: object, state: { where?: SQL } = {}): object {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') return (target as { then?: (...args: unknown[]) => unknown }).then?.bind(target);

      if (prop === 'where') {
        return (condition: SQL) => {
          const next = (target as WhereableBuilder).where(condition);
          return wrapDelete(db, table, next, { ...state, where: condition });
        };
      }

      if (prop === 'returning') {
        return async (fields?: SelectedFields) => {
          // MySQL has no DELETE ... RETURNING. Read the rows while holding a
          // row lock, delete them, then return the pre-delete projection.
          let q = selectQuery(db, table, fields);
          if (state.where) q = q.where(state.where);
          if (typeof q.for === 'function') q = q.for('update');
          const rows = await q;
          if (!rows?.length) return [];

          await target;
          return rows;
        };
      }

      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const next = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (next && typeof next === 'object') return wrapDelete(db, table, next, state);
        return next;
      };
    },
  });
}

function wrapDatabase(rawDb: RawDb): Database {
  const proxy = new Proxy(rawDb, {
    get(target, prop) {
      if (prop === 'insert') {
        return (table: CompatTable) => wrapInsert(proxy, table, target.insert(table));
      }
      if (prop === 'update') {
        return (table: CompatTable) => wrapUpdate(proxy, table, target.update(table));
      }
      if (prop === 'delete') {
        return (table: CompatTable) => wrapDelete(proxy, table, target.delete(table));
      }
      if (prop === 'execute') {
        return async (query: unknown) => normalizeExecuteResult(await target.execute(query as SQLWrapper));
      }
      if (prop === 'transaction') {
        return async (callback: (tx: Database) => Promise<unknown>, config?: unknown) =>
          target.transaction((tx) => callback(wrapDatabase(tx as unknown as RawDb)), config as never);
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as Database;
  return proxy;
}

function makePool(connectionString: string, max: number): Pool {
  return mysql.createPool({
    uri: connectionString,
    connectionLimit: max,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
    // Helps UPDATE-returning compatibility: matched rows count as affected.
    flags: ['FOUND_ROWS'],
  });
}

export function createDatabase(connectionString: string): Database {
  pool = makePool(connectionString, 10);
  const raw = drizzle({ client: pool, schema, mode: 'default' });
  return wrapDatabase(raw);
}

export function createFreshDatabase(connectionString: string) {
  const p = makePool(connectionString, 4);
  const raw = drizzle({ client: p, schema, mode: 'default' });
  return {
    db: wrapDatabase(raw),
    close: async () => {
      await p.end().catch(() => undefined);
    },
  };
}

export async function pingDatabase(connectionString: string): Promise<boolean> {
  const p = makePool(connectionString, 1);
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
