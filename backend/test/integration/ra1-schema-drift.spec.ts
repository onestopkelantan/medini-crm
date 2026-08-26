import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * RA-1 — CI schema-drift protection (static, no DB required).
 *
 * Proves the replay/migration infrastructure cannot silently drift:
 *   1. The drizzle journal is the authoritative migration list.
 *   2. Journal entries are contiguous (idx 0..N) and match on-disk files 1:1.
 *   3. No hardcoded migration total is baked into the fixture (the pre-RA-1
 *      CI list stopped at 0028 while the schema had already reached 0031).
 *   4. The replay fixture asserts a policy count that matches the CURRENT
 *      expected fingerprint (302 after F-02), not a stale S10-era number.
 */

const DRIZZLE_DIR = resolve(__dirname, '../../drizzle');

describe('RA-1 — schema-drift protection (journal authoritative)', () => {
  it('journal idx is contiguous 0..N', async () => {
    const journal = JSON.parse(await readFile(resolve(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
  });

  it('journal tags == on-disk migration files (1:1, ordered)', async () => {
    const journal = JSON.parse(await readFile(resolve(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const journalTags = journal.entries.sort((a, b) => a.idx - b.idx).map((e) => e.tag);
    const files = (await readdir(DRIZZLE_DIR))
      .filter((f) => /^0\d{3}_.*\.sql$/.test(f))
      .sort()
      .map((f) => f.replace(/\.sql$/, ''));
    expect(files.length).toBe(journalTags.length);
    expect(files).toEqual(journalTags);
  });

  it('current migration range reaches 0034 (not a stale list)', async () => {
    const journal = JSON.parse(await readFile(resolve(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const last = journal.entries[journal.entries.length - 1];
    expect(last?.tag).toBe('0034_finance_config');
    expect(journal.entries.length).toBe(34);
  });

  it('replay fixture has NO hardcoded migration total (journal-derived)', async () => {
    const fixture = await readFile(resolve(__dirname, './_replay-fixture.ts'), 'utf8');
    // The fixture must derive the set from the journal, not a literal number.
    expect(fixture).toContain('meta/_journal.json');
    expect(fixture).not.toMatch(/expected 28 migrations/);
    expect(fixture).not.toMatch(/files\.length !== 28/);
    // Policy count is the current fingerprint (F-02 era), asserted post-replay.
    expect(fixture).toContain('EXPECTED_POLICY_COUNT = 308');
  });

  it('replay fixture never silently reuses a partial/corrupt DB', async () => {
    const fixture = await readFile(resolve(__dirname, './_replay-fixture.ts'), 'utf8');
    // Reuse path requires an exact policy-count match; anything else rebuilds.
    expect(fixture).toContain('if (n === EXPECTED_POLICY_COUNT) return');
    expect(fixture).toContain('DROP DATABASE');
    // And a rebuilt DB that still mismatches fails loudly.
    expect(fixture).toContain('replayed but policy count is');
  });
});
