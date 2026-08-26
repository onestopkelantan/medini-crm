import { registerAs } from '@nestjs/config';

/**
 * Database configuration (PostgreSQL). No credentials in source.
 *
 *  - url        : admin/owner connection (migrations, seed) — DATABASE_URL.
 *  - runtimeUrl : application runtime connection — DATABASE_RUNTIME_URL.
 *                 MUST be the non-owner, RLS-subject role (medini_app), never
 *                 the table owner (medini). Falls back to `url` only in dev.
 */
export default registerAs('database', () => ({
  url: process.env.DATABASE_URL ?? '',
  runtimeUrl: process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? '',
}));
