#!/usr/bin/env node
/**
 * FASA 7 — CLI wrapper for the migration runner.
 *
 * Runs the COMPILED runner (dist/...) rather than the TypeScript source, because
 * that is exactly what a container has: no dev dependencies, no ts-node. Running
 * the compiled file in tests means the thing we test is the thing that ships.
 *
 * Usage:
 *   node scripts/run-migrations.cjs              # apply pending migrations
 *
 * Env:
 *   DATABASE_URL    required — MySQL connection string
 *   MIGRATIONS_DIR  optional — defaults to <cwd>/drizzle-mysql
 *
 * Exits non-zero on any failure so a deploy stops instead of starting the app
 * against an unknown schema.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const compiled = resolve(__dirname, '../dist/infrastructure/database/migrate.js');

if (!existsSync(compiled)) {
  console.error(
    `[migrate] ${compiled} not found — run \`npm run build\` first. ` +
      'Refusing to continue: silently applying nothing would start the app ' +
      'against a schema that may not exist.',
  );
  process.exit(1);
}

const { runMigrations } = require(compiled);

const url = process.env.DATABASE_URL ?? process.env.MYSQL_DATABASE_URL ?? '';

if (!url) {
  console.error('[migrate] DATABASE_URL is not set — refusing to run');
  process.exit(1);
}

runMigrations(url, { verbose: true })
  .then(({ applied, skipped, edited }) => {
    console.log(
      `[migrate] done — ${applied.length} applied, ${skipped.length} already present` +
        (edited.length ? `, ${edited.length} EDITED SINCE APPLY` : ''),
    );
  })
  .catch((err) => {
    console.error(`[migrate] ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
