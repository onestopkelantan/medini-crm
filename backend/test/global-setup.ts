/**
 * Vitest global setup — deterministic test environment (Tier 3, STEP 5).
 *
 * Integration specs read DATABASE_URL / DATABASE_RUNTIME_URL (with safe
 * placeholder defaults). Previously the suite only reached the real dev DB
 * when the operator manually ran `set -a && . ./.env && set +a` first —
 * undocumented, non-deterministic, and caused silent skips.
 *
 * This setup loads `backend/.env` (if present) into process.env BEFORE any
 * spec runs, WITHOUT overriding already-set vars (so CI's explicit env wins).
 * No secrets are written here — it only reads the existing local .env the
 * repo already uses for dev. If .env is absent, specs fall back to their
 * documented placeholder defaults and self-skip honestly when the DB is
 * unreachable.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    /* strip surrounding quotes */
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    /* Do NOT override explicitly-set environment (CI / caller). */
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function setup(): void {
  loadDotEnv(resolve(__dirname, '../.env'));
}
