import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * RA-1 — MySQL schema-drift protection.
 *
 * Proves:
 *  1. drizzle-mysql/meta/_journal.json is the authoritative migration list.
 *  2. Journal entries are contiguous and match migration files 1:1.
 *  3. The active migration dialect is MySQL.
 *  4. The expected MySQL compatibility migrations are present.
 *  5. MySQL migrations do not accidentally contain PostgreSQL RLS/GUC syntax.
 */

const DRIZZLE_DIR = resolve(
  __dirname,
  '../../drizzle-mysql',
);

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    tag: string;
  }>;
};

async function readJournal(): Promise<Journal> {
  return JSON.parse(
    await readFile(
      resolve(
        DRIZZLE_DIR,
        'meta/_journal.json',
      ),
      'utf8',
    ),
  ) as Journal;
}

describe(
  'RA-1 - MySQL schema-drift protection',
  () => {
    it(
      'journal declares MySQL dialect',
      async () => {
        const journal =
          await readJournal();

        expect(
          journal.dialect,
        ).toBe('mysql');
      },
    );

    it(
      'journal indexes are contiguous',
      async () => {
        const journal =
          await readJournal();

        journal.entries.forEach(
          (entry, index) => {
            expect(
              entry.idx,
            ).toBe(index);
          },
        );
      },
    );

    it(
      'journal tags match migration files 1:1 and in order',
      async () => {
        const journal =
          await readJournal();

        const journalTags =
          [...journal.entries]
            .sort(
              (a, b) =>
                a.idx - b.idx,
            )
            .map(
              (entry) =>
                entry.tag,
            );

        const files =
          (await readdir(
            DRIZZLE_DIR,
          ))
            .filter(
              (file) =>
                /^0\d{3}_.*\.sql$/.test(
                  file,
                ),
            )
            .sort()
            .map(
              (file) =>
                file.replace(
                  /\.sql$/,
                  '',
                ),
            );

        expect(files).toEqual(
          journalTags,
        );
      },
    );

    it(
      'current MySQL migration checkpoint reaches 0002',
      async () => {
        const journal =
          await readJournal();

        expect(
          journal.entries.map(
            (entry) =>
              entry.tag,
          ),
        ).toEqual([
          '0000_omniscient_marvex',
          '0001_mysql-partial-unique-compat',
          '0002_whatsapp-bot-prompts-created-at',
        ]);
      },
    );

    it(
      'MySQL migrations contain no PostgreSQL RLS or GUC syntax',
      async () => {
        const files =
          (await readdir(
            DRIZZLE_DIR,
          )).filter(
            (file) =>
              /^0\d{3}_.*\.sql$/.test(
                file,
              ),
          );

        for (const file of files) {
          const sql =
            await readFile(
              resolve(
                DRIZZLE_DIR,
                file,
              ),
              'utf8',
            );

          expect(sql).not.toMatch(
            /\bCREATE\s+POLICY\b/i,
          );

          expect(sql).not.toMatch(
            /\bROW\s+LEVEL\s+SECURITY\b/i,
          );

          expect(sql).not.toMatch(
            /\bset_config\s*\(/i,
          );

          expect(sql).not.toMatch(
            /\bcurrent_setting\s*\(/i,
          );

          expect(sql).not.toMatch(
            /\bSECURITY\s+DEFINER\b/i,
          );
        }
      },
    );
  },
);
