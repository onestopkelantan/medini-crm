/**
 * FASA 7 — apply pending MySQL migrations before the app serves traffic.
 *
 * WHY THIS EXISTS
 *
 * The production image shipped no migration runner and did not even contain the
 * MySQL migration folder: `Dockerfile.prod` copied `drizzle/` (the retired
 * legacy database set) and then started the app directly. A deploy against an empty
 * database therefore started against a schema that did not exist, and every
 * request failed. The schema only ever existed because it was applied by hand
 * during development — which is not a deploy strategy.
 *
 * WHAT IT DOES
 *
 *   1. Reads `drizzle-mysql/*.sql` in filename order (0000, 0001, ...).
 *   2. Records what has been applied in `medini_schema_migrations`, so a restart
 *      does not re-run everything.
 *   3. Applies only what is missing, in order, each file in one connection.
 *
 * WHY ONE CONNECTION, NOT A POOL
 *
 * Several migrations are not pure DDL. They set session variables (`SET @db`,
 * `@sql`) and run `PREPARE`/`EXECUTE`. Those live in the SESSION, so the
 * statements must reach the same connection — a pool would hand them out
 * separately and the migration would fail nondeterministically. The whole run
 * therefore borrows exactly one connection.
 *
 * WHY `multipleStatements: true`
 *
 * Each file is one long script. Sending it statement-by-statement would mean
 * re-implementing SQL parsing (delimiters, quoted semicolons, comments), which
 * is a reliable way to corrupt data. mysql2 can send the file whole.
 *
 * IDEMPOTENCE
 *
 * Individual migrations are written to be safe to re-run (guarded `ALTER TABLE`
 * via information_schema checks), and the tracking table means they normally are
 * not. Both layers are kept: the tracking table is the contract, the guards are
 * what keeps a partially-failed deploy recoverable.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mysql from 'mysql2/promise';

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle-mysql');

/** Bookkeeping table. Deliberately not the drizzle-kit one: these files were
 * never journalized, and claiming otherwise would be untrue. */
const TRACKING_TABLE = 'medini_schema_migrations';

type Connection = mysql.Connection;

function log(msg: string): void {
  // Plain stdout: this runs before the Nest logger exists.
  console.log(`[migrate] ${msg}`);
}

/** Migration files in apply order. Exported so the contract (discovery, order,
 * zero-padding) can be tested without a database. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
    .sort();
}

/**
 * Strip drizzle-kit statement markers before sending SQL to MySQL.
 *
 * THE BUG THIS FIXES (found by replaying onto an empty database)
 *
 * `0000_omniscient_marvex.sql` is drizzle-kit output and contains 369 marker
 * occurrences. That marker is a legacy database-era convention: the old pipeline
 * stripped it with sed. MySQL has no idea what it is — it is a syntax error at
 * line 15, which aborts the rest of the file. The result on a fresh database was
 * 5 tables instead of 81, and every later migration then failed against a schema
 * that had never been created.
 *
 * TWO FORMS, AND A `\r` TRAP
 *
 * The markers are not all on their own line. 81 are, but 288 sit at the END of a
 * statement: `...;--> statement-breakpoint`. And the files are checked out with
 * CRLF, so a `$`-anchored pattern silently misses them — which is exactly how the
 * first attempt at this fix matched 81 of 369 and looked like it worked.
 *
 * So the pattern is not line-anchored at all, and it consumes optional trailing
 * whitespace including `\r`. It only ever removes the marker itself.
 *
 * Stripping here rather than rewriting the files keeps drizzle-kit as the source
 * of truth for those two files; a regenerated migration would reintroduce them.
 */
export function prepareSql(sql: string): string {
  return sql.replace(/--> statement-breakpoint[ \t\r]*/g, '');
}

/**
 * Stable fingerprint of a migration's CONTENT.
 *
 * Line endings are normalised first: the repo is checked out CRLF on Windows and
 * LF inside the image, so without this the same file hashes differently per
 * platform and every deploy would report every migration as edited.
 */
export function checksum(sql: string): string {
  const normalised = sql.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

async function ensureTrackingTable(conn: Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      name        VARCHAR(191) NOT NULL,
      checksum    CHAR(16)     NOT NULL,
      applied_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedChecksums(conn: Connection): Promise<Map<string, string>> {
  const [rows] = await conn.query(
    `SELECT name, checksum FROM ${TRACKING_TABLE}`,
  );
  return new Map(
    (rows as Array<{ name: string; checksum: string }>).map((r) => [
      r.name,
      r.checksum,
    ]),
  );
}

export async function runMigrations(
  connectionString: string,
  opts: { verbose?: boolean } = {},
): Promise<{ applied: string[]; skipped: string[]; edited: string[] }> {
  if (!connectionString) {
    throw new Error('runMigrations: no connection string (DATABASE_URL unset)');
  }

  const files = migrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    throw new Error(
      `runMigrations: no migrations found in ${MIGRATIONS_DIR} — the image is missing its migration folder`,
    );
  }

  const conn = await mysql.createConnection({
    uri: connectionString,
    multipleStatements: true,
    timezone: 'Z',
  });

  const applied: string[] = [];
  const skipped: string[] = [];
  const edited: string[] = [];

  try {
    await ensureTrackingTable(conn);
    const done = await appliedChecksums(conn);

    for (const file of files) {
      const name = file.replace(/\.sql$/, '');
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(sql);

      const previous = done.get(name);

      if (previous !== undefined) {
        if (previous !== sum) {
          /* An already-applied migration changed on disk. Applying it again
           * could corrupt data; ignoring it means the database and the file
           * disagree. Neither is safe to do silently, so this is loud. */
          edited.push(name);
          log(
            `WARNING: ${name} was applied as ${previous} but is now ${sum}. ` +
              `NOT re-running. The database and this file disagree — investigate.`,
          );
        }
        skipped.push(name);
        continue;
      }

      if (opts.verbose) log(`applying ${name} ...`);
      try {
        await conn.query(prepareSql(sql));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `migration ${name} FAILED: ${message}\n` +
            `Database is now partially migrated. Fix the migration or restore ` +
            `from backup before retrying — do not start the app.`,
        );
      }

      await conn.query(
        `INSERT INTO ${TRACKING_TABLE} (name, checksum) VALUES (?, ?)`,
        [name, sum],
      );
      applied.push(name);
      log(`applied ${name}`);
    }
  } finally {
    await conn.end();
  }

  return { applied, skipped, edited };
}

/** CLI entry: `node dist/infrastructure/database/migrate.js` */
async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ??
    process.env.MYSQL_DATABASE_URL ??
    '';

  if (!url) {
    console.error('[migrate] DATABASE_URL is not set — refusing to run');
    process.exit(1);
  }

  try {
    const { applied, skipped, edited } = await runMigrations(url, {
      verbose: true,
    });
    log(
      `done — ${applied.length} applied, ${skipped.length} already present` +
        (edited.length ? `, ${edited.length} EDITED SINCE APPLY` : ''),
    );
  } catch (err) {
    console.error(`[migrate] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/* Only run when executed directly, not when imported by a test. */
if (require.main === module) {
  void main();
}
