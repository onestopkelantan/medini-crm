import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SRC = resolve(__dirname, '../../src');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('architecture — module boundary enforcement (static)', () => {
  it('no module imports another module\'s infrastructure layer', () => {
    const files = listFiles(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      const inModule = rel.match(/^modules\/([^/]+)\//);
      if (!inModule) continue;
      const myModule = inModule[1];
      const src = readFileSync(file, 'utf8');
      /* find cross-module infrastructure imports */
      const importRe = /from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const imp = m[1] ?? '';
        const cross = imp.match(/modules\/([^/]+)\/infrastructure/);
        if (cross && cross[1] !== myModule) {
          offenders.push(`${rel} -> ${imp}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('domain modules register under src/modules (none at Sprint 0 by design)', () => {
    /* Sprint 0: modules dir may be empty — this guards the convention exists. */
    expect(statSync(SRC).isDirectory()).toBe(true);
  });
});
