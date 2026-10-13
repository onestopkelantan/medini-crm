import { registerAs } from '@nestjs/config';

/**
 * Application configuration. Values come from the environment / secrets
 * manager — never hardcoded credentials. Safe dev placeholders only.
 */
export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  apiVersion: process.env.API_VERSION ?? 'v1',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
  /** Comma-separated allowed CORS origins (production frontend). Empty = same-origin only. */
  corsOrigin: process.env.CORS_ORIGIN ?? '',
}));
