import { drizzle } from 'drizzle-orm/mysql2';
import { inArray, sql, type SQL } from 'drizzle-orm';
import mysql, { type Pool } from 'mysql2/promise';
import * as schema from './schema';

/**
 * MySQL compatibility database facade.
 *
 * This migration branch still contains a number of PostgreSQL-era repository
 * calls such as `.returning()` and `.onConflictDoNothing()`. MySQL does not
 * support those APIs natively, so the facade below emulates them while the
 * repositories are migrated incrementally:
 *
 *  - INSERT ... returning() -> MySQL `$returningId()` + SELECT by generated id
 *  - UPDATE ... returning() -> lock matching ids, UPDATE, then SELECT by id
 *  - DELETE ... returning() -> lock/read matching rows, DELETE, return snapshot
 *  - onConflictDoNothing()  -> ON DUPLICATE KEY UPDATE id = id
 *  - onConflictDoUpdate()   -> ON DUPLICATE KEY UPDATE <set>
 *  - execute()              -> PostgreSQL-like `{ rows, affectedRows }` shape
 *
 * IMPORTANT: this is a migration compatibility layer, not a reason to keep
 * PostgreSQL-specific repository code forever. Remove it after the MySQL
 * repository refactor and regression tests are complete.
 */
export type Database = any;

let pool: Pool | null = null;

type CompatExecuteResult = {
  rows: any[];
  affectedRows: number;
  insertId: number | string | null;
  raw: unknown;
};

function normalizeExecuteResult(result: any): CompatExecuteResult {
  if (result && typeof result === 'object' && Array.isArray(result.rows)) {
    return {
      rows: result.rows,
      affectedRows: Number(result.rowCount ?? result.affectedRows ?? result.rows.length ?? 0),
      insertId: result.insertId ?? null,
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
      return {
        rows: [],
        affectedRows: Number((first as any).affectedRows ?? 0),
        insertId: (first as any).insertId ?? null,
        raw: result,
      };
    }
  }

  return { rows: [], affectedRows: 0, insertId: null, raw: result };
}

function wrapInsert(db: any, table: any, builder: any): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') return target.then?.bind(target);

      if (prop === 'returning') {
        return async (fields?: Record<string, unknown>) => {
          const ids = await target.$returningId();
          const values = (ids ?? []).map((row: any) => row?.id).filter(Boolean);
          if (!values.length || !table?.id) return [];
          const q = fields ? db.select(fields).from(table) : db.select().from(table);
          return q.where(inArray(table.id, values));
        };
      }

      if (prop === 'onConflictDoNothing') {
        return (_opts?: unknown) => {
          const next = target.onDuplicateKeyUpdate({ set: { id: sql`${table.id}` } });
          return wrapInsert(db, table, next);
        };
      }

      if (prop === 'onConflictDoUpdate') {
        return (opts: { set: Record<string, unknown> }) => {
          const next = target.onDuplicateKeyUpdate({ set: opts.set as any });
          return wrapInsert(db, table, next);
        };
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const next = value.apply(target, args);
        if (next && typeof next === 'object') return wrapInsert(db, table, next);
        return next;
      };
    },
  });
}

function wrapUpdate(db: any, table: any, builder: any, state: { where?: SQL } = {}): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') return target.then?.bind(target);

      if (prop === 'where') {
        return (condition: SQL) => {
          const next = target.where(condition);
          return wrapUpdate(db, table, next, { ...state, where: condition });
        };
      }

      if (prop === 'returning') {
        return async (fields?: Record<string, unknown>) => {
          // Capture the target ids BEFORE the update. This preserves optimistic
          // locking predicates that may stop matching after the UPDATE.
          let idQuery = db.select({ id: table.id }).from(table);
          if (state.where) idQuery = idQuery.where(state.where);
          if (typeof idQuery.for === 'function') idQuery = idQuery.for('update');
          const before = await idQuery;
          const ids = (before ?? []).map((row: any) => row?.id).filter(Boolean);
          if (!ids.length) return [];

          await target;

          const q = fields ? db.select(fields).from(table) : db.select().from(table);
          return q.where(inArray(table.id, ids));
        };
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const next = value.apply(target, args);
        if (next && typeof next === 'object') return wrapUpdate(db, table, next, state);
        return next;
      };
    },
  });
}

function wrapDelete(db: any, table: any, builder: any, state: { where?: SQL } = {}): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') return target.then?.bind(target);

      if (prop === 'where') {
        return (condition: SQL) => {
          const next = target.where(condition);
          return wrapDelete(db, table, next, { ...state, where: condition });
        };
      }

      if (prop === 'returning') {
        return async (fields?: Record<string, unknown>) => {
          // MySQL has no DELETE ... RETURNING. Read the rows while holding a
          // row lock, delete them, then return the pre-delete projection.
          let q = fields ? db.select(fields).from(table) : db.select().from(table);
          if (state.where) q = q.where(state.where);
          if (typeof q.for === 'function') q = q.for('update');
          const rows = await q;
          if (!rows?.length) return [];

          await target;
          return rows;
        };
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const next = value.apply(target, args);
        if (next && typeof next === 'object') return wrapDelete(db, table, next, state);
        return next;
      };
    },
  });
}

function wrapDatabase(rawDb: any): Database {
  let proxy: any;
  proxy = new Proxy(rawDb, {
    get(target, prop) {
      if (prop === 'insert') {
        return (table: any) => wrapInsert(proxy, table, target.insert(table));
      }
      if (prop === 'update') {
        return (table: any) => wrapUpdate(proxy, table, target.update(table));
      }
      if (prop === 'delete') {
        return (table: any) => wrapDelete(proxy, table, target.delete(table));
      }
      if (prop === 'execute') {
        return async (query: unknown) => normalizeExecuteResult(await target.execute(query));
      }
      if (prop === 'transaction') {
        return async (callback: (tx: Database) => Promise<unknown>, config?: unknown) =>
          target.transaction((tx: any) => callback(wrapDatabase(tx)), config as any);
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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
