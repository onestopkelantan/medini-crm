import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * S10 F-01 — Self-contained replay fixture (GLM 5.3 final audit condition #2).
 *
 * Two S10 specs boot the compiled app against `medini_replay_current`, a clean
 * database replayed from ALL migrations (0000→current). Tier 4: originally
 * pinned to 0000→0028/294 policies at the S10 checkpoint; Tier 2 added
 * 0029/0030, so the fixture now replays the full range and asserts 296 == dev. Before this helper existed the
 * DB had to be created MANUALLY — the 561/561 claim was not reproducible in a
 * fresh environment. This helper makes the suite self-contained:
 *
 *   1. Existence check (pg_database) — no destructive DROP/CREATE races.
 *   2. Cross-process advisory lock (pg_advisory_lock) so concurrent vitest
 *      workers / parallel spec files serialize the create+replay window.
 *   3. Migrations applied ONLY to a database created by this helper, in
 *      drizzle file order (0000…0028), with `--> statement-breakpoint`
 *      stripped — the exact same mechanism the CI replay step uses.
 *   4. After replay the policy count is asserted (294) — a partial/corrupt
 *      replay FAILS LOUDLY instead of silently passing with wrong RLS.
 *   5. Deterministic + idempotent: an already-correct fixture is reused
 *      untouched; a corrupt one (exists but wrong policy count) is rebuilt.
 *
 * Local dev (5433) and CI (5432) both work — the admin URL comes from the
 * caller (DATABASE_URL), only the database NAME is switched.
 */

export const REPLAY_DB = 'medini_replay_current';

/** Expected policy count after replaying ALL migrations (302 at hardening pass;
 *  == dev, verified after F-02 migration 0031 added 6 restrictive policies). */
export const EXPECTED_POLICY_COUNT = 308;

/** Cross-process advisory lock key (arbitrary stable constant). */
const ADVISORY_KEY = 0x5331_3028; /* "S10(" — fixture create window */

/** Postgres server-level URL derived from any database URL. */
function postgresDbUrl(anyDbUrl: string): string {
  const u = new URL(anyDbUrl);
  u.pathname = '/postgres';
  return u.toString();
}

/** Swap only the database name, preserving user/password/host/port. */
export function withDbName(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function databaseExists(client: Client, name: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return rows.length > 0;
}

async function policyCount(adminUrl: string): Promise<number> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM pg_policies');
    return rows[0].n as number;
  } finally {
    await client.end();
  }
}

/** Split a migration into executable statements, dollar-quote aware.
 *  The pg driver wraps each query() in an implicit transaction, and a
 *  whole-file single call fails on `ALTER TYPE … ADD VALUE 'developer'` used
 *  later in the same transaction. Splitting must NOT break inside function
 *  bodies ($$ … $$ or $tag$ … $tag$) — a naïve `;` split does. This scanner
 *  tracks dollar-quote open/close so function bodies stay intact, while
 *  top-level `;` boundaries split. Line/block comments are skipped so a `;`
 *  inside a comment can't split wrongly. BEGIN/COMMIT wrappers are dropped
 *  (each statement commits separately — matching psql replay semantics). */
function splitStatements(sqlText: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = sqlText.length;
  let dollarTag: string | null = null; /* e.g. '$$' or '$func$' when open */
  while (i < n) {
    /* Inside a dollar-quoted body: copy verbatim until the closing tag. */
    if (dollarTag !== null) {
      if (sqlText.startsWith(dollarTag, i)) {
        cur += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        cur += sqlText[i];
        i += 1;
      }
      continue;
    }
    /* Line comment: skip to end of line. */
    if (sqlText.startsWith('--', i)) {
      while (i < n && sqlText[i] !== '\n') i += 1;
      continue;
    }
    /* Block comment: skip to closer. */
    if (sqlText.startsWith('/*', i)) {
      const end = sqlText.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    /* Dollar-quote opener: $$ or $tag$. */
    const m = /^\$[A-Za-z_]*\$/.exec(sqlText.slice(i, i + 40));
    if (m) {
      dollarTag = m[0];
      cur += m[0];
      i += m[0].length;
      continue;
    }
    /* Single-quoted string literal: '' escapes a quote; `;` inside must not
     * split the statement. */
    if (sqlText[i] === "'") {
      cur += "'";
      i += 1;
      while (i < n) {
        if (sqlText[i] === "'" && sqlText[i + 1] === "'") { cur += "''"; i += 2; continue; }
        if (sqlText[i] === "'") { cur += "'"; i += 1; break; }
        cur += sqlText[i];
        i += 1;
      }
      continue;
    }
    /* Double-quoted identifier: similar escape rule (""). */
    if (sqlText[i] === '"') {
      cur += '"';
      i += 1;
      while (i < n) {
        if (sqlText[i] === '"' && sqlText[i + 1] === '"') { cur += '""'; i += 2; continue; }
        if (sqlText[i] === '"') { cur += '"'; i += 1; break; }
        cur += sqlText[i];
        i += 1;
      }
      continue;
    }
    /* Top-level statement boundary. */
    if (sqlText[i] === ';') {
      const stmt = cur.trim();
      if (stmt && stmt.toLowerCase() !== 'begin' && stmt.toLowerCase() !== 'commit') out.push(stmt);
      cur = '';
      i += 1;
      continue;
    }
    cur += sqlText[i];
    i += 1;
  }
  const tail = cur.trim();
  if (tail && tail.toLowerCase() !== 'begin' && tail.toLowerCase() !== 'commit') out.push(tail);
  return out;
}

/** Replay all migrations in file order (0000…0028) into a fresh database. */
async function replayMigrations(adminUrl: string): Promise<void> {
  const dir = resolve(__dirname, '../../drizzle');
  const files = (await readdir(dir)).filter((f) => /^0\d{3}_.*\.sql$/.test(f)).sort();
  /* Tier 4: derive the expected set from the drizzle journal instead of a
   * hardcoded total — adding 0031+ will not silently break this fixture;
   * a journal/file mismatch still fails loudly. */
  const journal = JSON.parse(await readFile(resolve(dir, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const journalTags: string[] = journal.entries.map((e) => e.tag);
  if (journalTags.length !== files.length) {
    throw new Error(`replay fixture: journal has ${journalTags.length} entries but ${files.length} migration files in ${dir}`);
  }
  files.forEach((file, i) => {
    const fileTag = file.replace(/\.sql$/, '');
    const journalTag = journalTags[i];
    if (journalTag === undefined || journalTag !== fileTag) {
      throw new Error(`replay fixture: journal[${i}]=${journalTag ?? '(missing)'} != file ${fileTag}`);
    }
  });
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const file of files) {
      const raw = await readFile(resolve(dir, file), 'utf8');
      const statements = splitStatements(raw.replace(/--> statement-breakpoint/g, ''));
      for (const stmt of statements) {
        await client.query(stmt).catch((err: unknown) => {
          throw new Error(`replay fixture: migration ${file} failed: ${(err as Error).message}`);
        });
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Ensure `medini_replay_current` exists and is a VALID full replay (296 policies).
 * Safe to call concurrently: only one caller creates/replays; others wait on
 * the advisory lock and then observe the completed fixture.
 *
 * @param adminUrl  owner connection URL for ANY database on the target server.
 */
export async function ensureReplayFixture(adminUrl: string): Promise<void> {
  const server = new Client({ connectionString: postgresDbUrl(adminUrl) });
  await server.connect();
  try {
    /* Cross-process serialization of the create+replay window. */
    await server.query('SELECT pg_advisory_lock($1)', [ADVISORY_KEY]);
    try {
      const replayAdmin = withDbName(adminUrl, REPLAY_DB);
      if (await databaseExists(server, REPLAY_DB)) {
        /* Fixture exists — validate completeness; rebuild if partial/corrupt. */
        const n = await policyCount(replayAdmin);
        if (n === EXPECTED_POLICY_COUNT) return; /* reuse — no destructive churn */
        await server.query(`DROP DATABASE ${REPLAY_DB}`); /* corrupt → rebuild */
      }
      /* Fresh create + deterministic replay. */
      await server.query(`CREATE DATABASE ${REPLAY_DB}`);
      await replayMigrations(replayAdmin);
      const n = await policyCount(replayAdmin);
      if (n !== EXPECTED_POLICY_COUNT) {
        throw new Error(`replay fixture: replayed but policy count is ${n}, expected ${EXPECTED_POLICY_COUNT}`);
      }
    } finally {
      await server.query('SELECT pg_advisory_unlock($1)', [ADVISORY_KEY]);
    }
  } finally {
    await server.end();
  }
}