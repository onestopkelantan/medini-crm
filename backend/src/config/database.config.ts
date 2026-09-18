import { registerAs } from '@nestjs/config';

/**
 * Database configuration (MySQL migration branch). No credentials in source.
 *
 *  - url        : migration/admin connection — DATABASE_URL.
 *  - runtimeUrl : application runtime connection — DATABASE_RUNTIME_URL.
 *                 Falls back to DATABASE_URL when a separate runtime user is
 *                 not configured. Prefer a least-privilege MySQL runtime user.
 */
export default registerAs('database', () => ({
  url: process.env.DATABASE_URL ?? '',
  runtimeUrl: process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ?? '',
}));
