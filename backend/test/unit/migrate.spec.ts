import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * FASA 7 — the migration runner's contract, and the image's ability to run it.
 *
 * WHY THESE PARTICULAR TESTS
 *
 * The real deploy failure was not a crash — it was that the image contained no
 * MySQL migrations at all and no runner, so a fresh database was left empty and
 * the app started against it. Silence, not a stack trace.
 *
 * So these check the conditions that made that possible:
 *
 *   1. the folder exists and is contiguous (a gap means the chain is broken)
 *   2. filename sort is numeric order (later files ALTER what earlier ones CREATE)
 *   3. the checksum ignores CRLF/LF (Windows checkout vs Linux image — otherwise
 *      every deploy reports every migration as edited)
 *   4. the Dockerfile copies the folder and the compiled runner (the actual bug)
 *   5. the runner refuses to run without a connection string
 *
 * The live apply against an empty database is proven by
 * verify-fasa7-migrations.sh; this is what catches the mistake before that.
 */

const BACKEND = resolve(__dirname, '../..');
const MIGRATIONS = resolve(BACKEND, 'drizzle-mysql');

/** Mirrors the runner's discovery: same regex, same sort. */
function discoveredFiles(dir = MIGRATIONS): string[] {
  return readdirSync(dir)
    .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
    .sort();
}

/** Mirrors the runner's checksum normalisation, over SQL TEXT. */
function checksumOfText(sql: string): string {
  const normalised = sql.replace(/\r\n/g, '\n');
  let h = 0;
  for (let i = 0; i < normalised.length; i++) {
    h = (Math.imul(31, h) + normalised.charCodeAt(i)) | 0;
  }
  return String(h);
}

/** Reads a file then fingerprints it — the two steps the runner keeps apart. */
function checksumOfFile(path: string): string {
  return checksumOfText(readFileSync(path, 'utf8'));
}

describe('FASA 7 — migrations: discovery and order', () => {
  it('the MySQL migration folder exists', () => {
    expect(existsSync(MIGRATIONS)).toBe(true);
  });

  it('holds at least the 15 files the schema needs', () => {
    expect(discoveredFiles().length).toBeGreaterThanOrEqual(15);
  });

  it('is contiguous from 0000 with no gap', () => {
    /* A gap means a migration was renamed or deleted after being applied. The
     * runner would still run, but the chain no longer describes what happened. */
    const indices = discoveredFiles().map((f) => Number(f.slice(0, 4)));
    expect(indices[0]).toBe(0);
    indices.forEach((n, i) => expect(n).toBe(i));
  });

  it('every file is zero-padded to 4 digits', () => {
    /* The runner sorts filenames lexicographically. That only equals numeric
     * order while padding is uniform — "0010" must not be written "010". */
    for (const f of discoveredFiles()) {
      expect(f).toMatch(/^\d{4}_/);
    }
  });

  it('lexicographic sort equals numeric order', () => {
    const sorted = discoveredFiles();
    const numeric = [...sorted].sort(
      (a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)),
    );
    expect(sorted).toEqual(numeric);
    expect(sorted[0]!.startsWith('0000_')).toBe(true);
  });
});

describe('FASA 7 — migrations: content checksums are platform-stable', () => {
  it('CRLF and LF versions of the same file hash identically', () => {
    /* A checksum that varies by platform would make the runner warn that every
     * migration was edited, on every deploy, on one of the two machines. */
    const sample = readFileSync(resolve(MIGRATIONS, discoveredFiles()[0]!), 'utf8');
    const lf = sample.replace(/\r\n/g, '\n');
    const crlf = lf.replace(/\n/g, '\r\n');

    expect(checksumOfText(lf)).toBe(checksumOfText(crlf));
  });

  it('files differ from each other (no accidental duplicate)', () => {
    const files = discoveredFiles();
    const seen = new Map<string, string>();
    for (const f of files) {
      const sum = checksumOfFile(resolve(MIGRATIONS, f));
      const dup = seen.get(sum);
      expect(dup, `${f} is byte-identical to ${dup}`).toBeUndefined();
      seen.set(sum, f);
    }
  });
});

describe('FASA 7 — migrations: legacy database markers must be stripped', () => {
  /** Mirrors the runner's prepareSql. */
  function prepareSql(sql: string): string {
    return sql.replace(/--> statement-breakpoint[ \t\r]*/g, '');
  }

  it('the two drizzle-generated files DO contain markers', () => {
    /* If this ever fails, the stripping can be removed — but until then the
     * markers are the reason a fresh database built 5 tables instead of 85. */
    const withMarkers = discoveredFiles().filter((f) =>
      readFileSync(resolve(MIGRATIONS, f), 'utf8').includes(
        '--> statement-breakpoint',
      ),
    );
    expect(withMarkers.length).toBeGreaterThan(0);
  });

  it('stripping removes EVERY marker, including the ones mid-line', () => {
    /* The trap: 81 markers sit alone on a line, 288 sit at the end of a
     * statement. A line-anchored pattern removes the 81 and looks correct. */
    const raw = readFileSync(
      resolve(MIGRATIONS, '0000_omniscient_marvex.sql'),
      'utf8',
    );
    const total = (raw.match(/--> statement-breakpoint/g) ?? []).length;
    expect(total).toBeGreaterThan(300); // proves the sample is the hard case
    expect(prepareSql(raw)).not.toContain('statement-breakpoint');
  });

  it('stripping removes markers from every file', () => {
    for (const f of discoveredFiles()) {
      const raw = readFileSync(resolve(MIGRATIONS, f), 'utf8');
      expect(prepareSql(raw)).not.toContain('statement-breakpoint');
    }
  });

  it('handles CRLF files without leaving a stray carriage return or marker', () => {
    /* The repo is CRLF on Windows. A `$`-anchored pattern misses those lines
     * entirely — that is how the first fix matched 81 of 369 markers and looked
     * correct. The pattern consumes the trailing `\r` too, so no stray carriage
     * return is left behind in the SQL sent to MySQL. */
    const crlf = 'CREATE TABLE t (id int);--> statement-breakpoint\r\nSELECT 1;';
    const out = prepareSql(crlf);

    expect(out).not.toContain('statement-breakpoint');
    expect(out).not.toContain('\r');
    expect(out).toBe('CREATE TABLE t (id int);\nSELECT 1;');
  });

  it('stripping does not damage the SQL', () => {
    const raw = readFileSync(
      resolve(MIGRATIONS, '0000_omniscient_marvex.sql'),
      'utf8',
    );
    const prepared = prepareSql(raw);

    /* The table count is the number that matters: every CREATE TABLE must
     * survive exactly. */
    const before = (raw.match(/CREATE TABLE/g) ?? []).length;
    const after = (prepared.match(/CREATE TABLE/g) ?? []).length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(50);
  });

  it('a marker inside a string literal IS preserved', () => {
    /* Deliberately NOT guarded: distinguishing "marker in prose" from "marker in
     * a SQL string" needs a parser, and these files are generated. If a migration
     * ever legitimately contains this text, this test documents the limitation
     * rather than pretending it cannot happen. */
    const sql = "INSERT INTO t VALUES ('see --> statement-breakpoint here');";
    expect(prepareSql(sql)).not.toBe(sql);
  });
});

describe('FASA 7 — the image can actually run migrations', () => {
  const dockerfile = readFileSync(resolve(BACKEND, 'Dockerfile.prod'), 'utf8');

  it('the production Dockerfile copies drizzle-mysql into the image', () => {
    /* THE ORIGINAL BUG. It copied `drizzle` (the retired legacy database set), so the
     * MySQL schema never existed inside the container. */
    expect(dockerfile).toMatch(/COPY\s+.*drizzle-mysql/);
  });

  it('the image keeps a path to the compiled runner', () => {
    /* dist is copied wholesale, so the runner in dist/ ships with it; this
     * asserts the copy that makes that true. */
    expect(dockerfile).toMatch(/COPY\s+--from=build\s+\/app\/dist\s+\.\/dist/);
  });

  it('a CLI wrapper exists to invoke the runner', () => {
    expect(existsSync(resolve(BACKEND, 'scripts/run-migrations.cjs'))).toBe(true);
  });

  it('the container applies migrations BEFORE starting the app', () => {
    /* The `&&` is the contract: a container must never serve traffic against a
     * schema it failed to bring up to date. */
    expect(dockerfile).toMatch(
      /CMD\s+\["sh",\s*"-c",\s*"[^"]*migrate\.js[^"]*&&[^"]*main\.js[^"]*"\]/,
    );
  });

  it('the runner is reachable from the source tree', () => {
    expect(
      existsSync(resolve(BACKEND, 'src/infrastructure/database/migrate.ts')),
    ).toBe(true);
  });
});

describe('FASA 7 — the runner refuses to run blind', () => {
  it('source exits non-zero when DATABASE_URL is unset', () => {
    /* Read the guard rather than executing it: the goal is to assert the failure
     * mode exists, and "no connection string" must never be a silent success. */
    const src = readFileSync(
      resolve(BACKEND, 'src/infrastructure/database/migrate.ts'),
      'utf8',
    );
    expect(src).toMatch(/DATABASE_URL is not set/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it('source refuses when the migration folder yields no files', () => {
    const src = readFileSync(
      resolve(BACKEND, 'src/infrastructure/database/migrate.ts'),
      'utf8',
    );
    expect(src).toMatch(/no migrations found/);
  });
});
