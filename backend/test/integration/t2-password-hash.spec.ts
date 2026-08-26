import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createDatabase, closeDatabase } from '@infrastructure/database/database';
import { AdministrationRepository } from '@modules/administration/infrastructure/administration.repository';

/**
 * Tier 2 (T2-B / FAMILY-4) — password_hash / credential-column exposure.
 *
 * The AdministrationRepository staff READ surface must NEVER return
 * password_hash, mfa_secret, or invite_token — these are credential material
 * that must not travel into DTOs / API responses. Authentication internals
 * (PrincipalResolver / PasswordService) read them via dedicated auth queries,
 * not through this repo.
 *
 * Proves at the repository layer (the exact methods the admin API uses):
 *   - listStaff / findStaff / findStaffByUsername rows contain NO credential
 *     columns, while retaining the legitimate identity fields.
 *   - login path is unaffected (covered by the auth suite).
 */
const RUNTIME_URL = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? 'postgres://medini_app:***@localhost:5433/medini_dev';
const probe = pingDatabase(RUNTIME_URL).then((ok) => {
  if (!ok) console.warn('[t2-password-hash] PostgreSQL not reachable — SKIPPING.');
  return ok;
});
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => { if (!(await probe)) { ctx.skip(); return; } await fn(); });
}

const CANON = '00000000-0000-0000-0000-000000000001';
const CREDENTIAL_KEYS = ['passwordHash', 'password_hash', 'mfaSecret', 'mfa_secret', 'inviteToken', 'invite_token'];

function assertNoCredentials(row: Record<string, unknown> | null | undefined): void {
  expect(row).toBeTruthy();
  for (const k of CREDENTIAL_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(row, k), `must not expose ${k}`).toBe(false);
  }
}

describe('T2-B — admin staff read surface excludes credential columns (live PG)', () => {
  dbIt('listStaff returns rows WITHOUT password_hash / mfa_secret / invite_token', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const repo = new AdministrationRepository();
      /* listStaff runs inside a runAs context in prod; here we call the repo
       * directly with the runtime connection (RLS applies via no-GUC = login
       * path, which can read staff). */
      const rows = await repo.listStaff(db as never, CANON, {}, 50, 0);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) assertNoCredentials(r as unknown as Record<string, unknown>);
      /* legitimate fields still present */
      expect(rows[0]).toHaveProperty('id');
      expect(rows[0]).toHaveProperty('username');
      expect(rows[0]).toHaveProperty('role');
      expect(rows[0]).toHaveProperty('status');
    } finally { await closeDatabase(); }
  });

  dbIt('findStaff by id returns a row WITHOUT credential columns', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const repo = new AdministrationRepository();
      const anyRow = await db.execute(sql`SELECT id FROM staff WHERE org_id = ${CANON} AND deleted_at IS NULL LIMIT 1`);
      const id = String((anyRow as unknown as { rows?: Array<{ id: string }> }).rows?.[0]?.id ?? '');
      expect(id).not.toBe('');
      const row = await repo.findStaff(db as never, CANON, id);
      assertNoCredentials(row as unknown as Record<string, unknown>);
      expect(row?.id).toBe(id);
    } finally { await closeDatabase(); }
  });

  dbIt('findStaffByUsername returns a row WITHOUT credential columns', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const repo = new AdministrationRepository();
      const anyRow = await db.execute(sql`SELECT username FROM staff WHERE org_id = ${CANON} AND deleted_at IS NULL LIMIT 1`);
      const username = String((anyRow as unknown as { rows?: Array<{ username: string }> }).rows?.[0]?.username ?? '');
      expect(username).not.toBe('');
      const row = await repo.findStaffByUsername(db as never, CANON, username);
      assertNoCredentials(row as unknown as Record<string, unknown>);
      expect(row?.username).toBe(username);
    } finally { await closeDatabase(); }
  });

  dbIt('serialization: JSON of an admin staff row contains no credential keys', async () => {
    const db = createDatabase(RUNTIME_URL);
    try {
      const repo = new AdministrationRepository();
      const rows = await repo.listStaff(db as never, CANON, {}, 5, 0);
      const json = JSON.stringify(rows);
      expect(json).not.toContain('password_hash');
      expect(json).not.toContain('passwordHash');
      expect(json).not.toContain('mfa_secret');
      expect(json).not.toContain('mfaSecret');
      expect(json).not.toContain('invite_token');
      expect(json).not.toContain('inviteToken');
      expect(json).not.toContain('$argon2');
    } finally { await closeDatabase(); }
  });
});
