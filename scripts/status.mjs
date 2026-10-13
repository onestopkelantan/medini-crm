#!/usr/bin/env node
/**
 * ============================================================================
 * status.mjs — generate STATUS.md from REAL gate output
 * ============================================================================
 *
 * WHY THIS EXISTS
 *
 * Progress on this project was being tracked in hand-written markdown and
 * hand-maintained score tables (`kira-jurang.py`). Hand-written status is drift
 * by design: it describes what someone believed at the time it was typed, and it
 * silently goes stale. It also cannot be trusted by a reviewer, because there is
 * no way to tell a measured number from a remembered one.
 *
 * This script measures instead. Every number in STATUS.md comes from a command
 * that was actually run, and each line carries its raw result so it can be
 * checked. If a gate cannot run (e.g. Docker is down), the line says so instead
 * of inventing a value.
 *
 * USAGE
 *   node scripts/status.mjs            # measure, write STATUS.md at repo root
 *   node scripts/status.mjs --check    # measure, FAIL if STATUS.md is out of date
 *
 * The --check mode is what makes it a drift guard for the status itself: CI (or a
 * pre-push hook) can refuse a STATUS.md that no longer matches reality.
 *
 * SCOPE
 *   Deliberately shallow: version control, build/type gates, test counts,
 *   migrations, and the live AI roster if a database is reachable. It does NOT
 *   try to score feature completeness — any such score would be an opinion, and
 *   opinions are exactly what this file exists to remove.
 * ============================================================================
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* This file lives at <repo>/scripts/status.mjs, so the repo root is ONE level up. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'backend');
const APP = join(ROOT, 'app');
const CHECK_MODE = process.argv.includes('--check');

/* ---------------------------------------------------------------- exec helpers */

/** Run a shell command line, never throw. Returns { code, out }. */
function run(command, opts = {}) {
  try {
    const out = execSync(command, {
      cwd: opts.cwd ?? ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout ?? 300_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out: (out || '').trim() };
  } catch (error) {
    const out = `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim();
    return { code: error?.status ?? 1, out };
  }
}

/* ------------------------------------------------------------------- measures */

function gitInfo() {
  const branch = run('git rev-parse --abbrev-ref HEAD').out;
  const short = run('git rev-parse --short HEAD').out;
  const dirty = run('git status --porcelain').out.split('\n').filter(Boolean).length;
  const unpushed = run('git rev-list --count origin/main..HEAD').out || '0';
  const behind = run('git rev-list --count HEAD..origin/main').out || '0';
  const tags = run('git tag').out.split('\n').filter(Boolean).length;
  const last = run('git log -1 --format=%s').out;
  const lastDate = run('git log -1 --format=%cI').out;
  return { branch, short, dirty, unpushed, behind, tags, last, lastDate };
}

function typecheck() {
  const be = run('npm run typecheck --silent', { cwd: BACKEND });
  const fe = run('npx tsc -b --force', { cwd: APP });
  return {
    backend: { pass: be.code === 0, detail: be.code === 0 ? '0 errors' : firstError(be.out) },
    frontend: { pass: fe.code === 0, detail: fe.code === 0 ? '0 errors' : firstError(fe.out) },
  };
}

function lint() {
  const be = run('npm run lint --silent', { cwd: BACKEND });
  const fe = run('npm run lint --silent', { cwd: APP });
  return {
    backend: { pass: be.code === 0, detail: countProblems(be.out) },
    frontend: { pass: fe.code === 0, detail: countProblems(fe.out) },
  };
}

/** Parse vitest's summary line: "Tests  N passed | M failed | K skipped (T)". */
function parseVitest(out) {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const line = clean.split('\n').reverse().find((l) => /^\s*Tests\s+/.test(l));
  if (!line) return null;
  const grab = (label) => {
    const m = line.match(new RegExp(`(\\d+)\\s+${label}`));
    return m ? Number(m[1]) : 0;
  };
  /* Name the failing spec files so a reader sees WHICH tests fail, not just how
   * many. A bare count invites "someone will look at it"; a path does not. */
  const failing = [...clean.matchAll(/FAIL\s+(\S+\.spec\.ts)/g)].map((m) => m[1]);
  return { passed: grab('passed'), failed: grab('failed'), skipped: grab('skipped'), files: [...new Set(failing)] };
}

function tests() {
  const dir = join(BACKEND, 'test');
  const countFiles = (sub) => {
    const p = join(dir, sub);
    if (!existsSync(p)) return 0;
    return readdirSync(p).filter((f) => f.endsWith('.spec.ts')).length;
  };
  const files = { unit: countFiles('unit'), contract: countFiles('contract'), architecture: countFiles('architecture'), integration: countFiles('integration') };
  const out = run('npx vitest run test/unit test/contract test/architecture', { cwd: BACKEND, timeout: 600_000 }).out;
  return { files, result: parseVitest(out), raw: out };
}

function migrations() {
  const p = join(BACKEND, 'drizzle-mysql');
  if (!existsSync(p)) return { count: 0, latest: '-' };
  const files = readdirSync(p).filter((f) => /^0\d{3}_.*\.sql$/.test(f)).sort();
  return { count: files.length, latest: files[files.length - 1] ?? '-' };
}

function docker() {
  const out = run('docker ps --format "{{.Names}}|{{.Status}}"', { env: dockerEnv() });
  /* Availability is the EXIT CODE, not output length — a failed lookup prints an
   * error message, and treating that as "reachable" is how a stack that is down
   * gets reported as up. */
  if (out.code !== 0) return { available: false, running: 0, healthy: 0 };
  const lines = out.out.split('\n').filter(Boolean).filter((l) => l.includes('medini-'));
  const healthy = lines.filter((l) => /healthy/.test(l)).length;
  return { available: true, running: lines.length, healthy };
}

/**
 * Docker Desktop installs its CLI outside the default PATH on Windows, so a
 * plain `docker` call from Node fails on a machine where Docker plainly works.
 * Prepend the standard locations (and keep any that already exist).
 */
function dockerEnv() {
  const extra = [
    'C:\\Program Files\\Docker\\Docker\\resources\\bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  const sep = process.platform === 'win32' ? ';' : ':';
  const current = process.env.PATH ?? '';
  const parts = [...extra, ...current.split(sep)].filter(Boolean);
  return { ...process.env, PATH: parts.join(sep) };
}

/** Live AI roster — measured from the DB inside the running container. */
function liveRoster() {
  const db = process.env.MYSQL_DATABASE ?? 'medini_prod';
  const sql = 'SELECT JSON_ARRAYAGG(JSON_OBJECT("key",`key`,"domain",owner_domain,"status",status)) FROM ai_agents WHERE deleted_at IS NULL;';
  const out = run(
    `docker exec medini-prod-mysql-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "${sql}" ${db} 2>/dev/null'`,
    { timeout: 60_000, env: dockerEnv() },
  );
  if (out.code !== 0) return null;
  const jsonLine = out.out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('[')).pop();
  if (!jsonLine) return null;
  try { return JSON.parse(jsonLine); } catch { return null; }
}

/* ------------------------------------------------------------------- rendering */

function tick(ok) { return ok ? 'PASS' : 'FAIL'; }

function build(g) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const { git, type, lintRes, testRes, mig, dock, roster } = g;

  const rosterLines = roster
    ? roster.map((a) => `| \`${a.key}\` | ${a.domain} | ${a.status} |`).join('\n')
    : '| _(database not reachable — run with the Docker stack up)_ | | |';

  return `# STATUS — Medini CRM

> **Generated file — do not edit by hand.** Produced by \`node scripts/status.mjs\`.
> Every number below was measured by a command; none is remembered. Re-run to refresh.

**Generated:** ${now} · **Branch:** \`${git.branch}\` · **HEAD:** \`${git.short}\`

---

## 1. Version control

| Fact | Value |
|---|---|
| Last commit | ${git.last} |
| Committed at | ${git.lastDate} |
| Working tree | ${git.dirty === 0 ? 'clean' : `${git.dirty} uncommitted path(s)`} |
| Unpushed commits | ${git.unpushed} |
| Commits behind origin | ${git.behind} |
| Checkpoint tags | ${git.tags} |

## 2. Build & type gates

| Gate | Result | Detail |
|---|---|---|
| Backend typecheck (\`tsc --noEmit\`) | ${tick(type.backend.pass)} | ${type.backend.detail} |
| Frontend typecheck (\`tsc -b\`) | ${tick(type.frontend.pass)} | ${type.frontend.detail} |

## 3. Lint gates

| Gate | Result | Detail |
|---|---|---|
| Backend lint | ${tick(lintRes.backend.pass)} | ${lintRes.backend.detail} |
| Frontend lint | ${tick(lintRes.frontend.pass)} | ${lintRes.frontend.detail} |

## 4. Tests (offline: unit + contract + architecture)

| Layer | Spec files |
|---|---|
| unit | ${testRes.files.unit} |
| contract | ${testRes.files.contract} |
| architecture | ${testRes.files.architecture} |
| integration (needs a DB; not in this run) | ${testRes.files.integration} |

${testRes.result
  ? `**Result:** ${testRes.result.passed} passed · ${testRes.result.failed} failed · ${testRes.result.skipped} skipped`
  : '**Result:** could not parse test output'}
${testRes.result && testRes.result.files.length > 0
  ? `\n**Failing specs:**\n${testRes.result.files.map((f) => `- \`${f}\``).join('\n')}`
  : ''}

## 5. Database migrations

| Fact | Value |
|---|---|
| MySQL migrations | ${mig.count} |
| Latest | \`${mig.latest}\` |

## 6. Local stack

| Fact | Value |
|---|---|
| Docker reachable | ${dock.available ? 'yes' : 'no'} |
| medini-* containers running | ${dock.running} |
| of which healthy | ${dock.healthy} |

## 7. Live AI agent roster (measured from the running database)

| Agent key | Owner domain | Status |
|---|---|---|
${rosterLines}

${roster && roster.length > 0 ? `_${roster.length} live agents. The locked canon is 8 — see \`backend/test/contract/ai-governance.contract.spec.ts\`, which fails if this drifts._` : ''}

---

## How to use this

- **Refresh:** \`node scripts/status.mjs\`
- **Fail if stale:** \`node scripts/status.mjs --check\` (exits 1 when STATUS.md no longer matches reality)
- **What it does NOT measure:** feature completeness, or business priority. Those are decisions, not measurements — see \`NEXT-STEPS.md\`.
`;
}

function firstError(out) {
  const line = out.split('\n').find((l) => /error TS\d+/.test(l));
  return line ? line.trim().slice(0, 100) : 'non-zero exit';
}

function countProblems(out) {
  const m = out.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/);
  if (m) return `${m[2]} errors, ${m[3]} warnings`;
  return out.includes('0 problems') ? '0 problems' : 'failing';
}

/* ----------------------------------------------------------------------- main */

function main() {
  process.stderr.write('[status] measuring git …\n');
  const git = gitInfo();
  process.stderr.write('[status] measuring typecheck …\n');
  const type = typecheck();
  process.stderr.write('[status] measuring lint …\n');
  const lintRes = lint();
  process.stderr.write('[status] measuring tests …\n');
  const testRes = tests();
  process.stderr.write('[status] measuring migrations + stack + roster …\n');
  const mig = migrations();
  const dock = docker();
  const roster = dock.available ? liveRoster() : null;

  const markdown = build({ git, type, lintRes, testRes, mig, dock, roster });
  const target = join(ROOT, 'STATUS.md');

  if (CHECK_MODE) {
    if (!existsSync(target)) {
      console.error('[status] STATUS.md is missing — run: node scripts/status.mjs');
      process.exit(1);
    }
    const current = readFileSync(target, 'utf8');
    /* Compare ignoring the timestamp line, which always changes. */
    const strip = (s) => s.replace(/^\*\*Generated:\*\*.*$/m, '');
    if (strip(current) !== strip(markdown)) {
      console.error('[status] STATUS.md is OUT OF DATE — run: node scripts/status.mjs');
      process.exit(1);
    }
    console.log('[status] STATUS.md is up to date.');
    return;
  }

  writeFileSync(target, markdown, 'utf8');
  console.log(`[status] wrote ${target}`);
  console.log(`[status] gates: typecheck be=${tick(type.backend.pass)} fe=${tick(type.frontend.pass)} · lint be=${tick(lintRes.backend.pass)} fe=${tick(lintRes.frontend.pass)}`);
  if (testRes.result) console.log(`[status] tests: ${testRes.result.passed} passed, ${testRes.result.failed} failed`);
  console.log(`[status] agents(live): ${roster ? roster.length : 'n/a'}`);
}

main();
