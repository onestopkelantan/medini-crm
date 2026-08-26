import { z } from 'zod';

/**
 * Environment validation schema. Fails fast on boot if required config is
 * missing or malformed. Secrets are validated for presence/shape, never logged.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('v1'),

  DATABASE_URL: z.string().default(''),
  DATABASE_RUNTIME_URL: z.string().default(''),
  REDIS_URL: z.string().default(''),

  JWT_SECRET: z.string().default(''),
  JWT_REFRESH_SECRET: z.string().default(''),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),

  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),

  WAHA_BASE_URL: z.string().default(''),
  WAHA_API_KEY: z.string().default(''),
  BUKKU_BASE_URL: z.string().default(''),
  BUKKU_API_KEY: z.string().default(''),
  BUKKU_COMPANY_SUBDOMAIN: z.string().default(''),
  AI_PROVIDER_BASE_URL: z.string().default(''),
  AI_PROVIDER_API_KEY: z.string().default(''),

  /* S10 GLM R3: invitation link origin — server config ONLY (never request
   * Host header / body). Defaults to the dev frontend. */
  APP_PUBLIC_BASE_URL: z.string().default('http://localhost:5173'),
  /* S10 GLM trust-proxy remediation: comma-separated IPs/CIDRs allowed to
   * supply X-Forwarded-For for rate limiting. Empty = trust nobody (XFF
   * ignored; socket peer used). Must list the Caddy/edge proxy in prod. */
  TRUSTED_PROXIES: z.string().default(''),

  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  /* Production hard rule: real secrets must be present & non-placeholder. */
  if (env.NODE_ENV === 'production') {
    const weak = ['dev_only_insecure_jwt_secret_change_me', 'dev_only_insecure_refresh_secret_change_me'];
    if (!env.JWT_SECRET || weak.includes(env.JWT_SECRET)) {
      throw new Error('JWT_SECRET must be a real secret in production');
    }
    if (!env.JWT_REFRESH_SECRET || weak.includes(env.JWT_REFRESH_SECRET)) {
      throw new Error('JWT_REFRESH_SECRET must be a real secret in production');
    }
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
    if (!env.REDIS_URL) throw new Error('REDIS_URL is required in production');

    /* GLM R1/R2 + Part 10/23/24: production runtime DB identity must be the
     * non-owner RLS-subject role (medini_app), never the table owner, and never
     * the development default credential. */
    const runtimeUrl = env.DATABASE_RUNTIME_URL || env.DATABASE_URL;
    if (!env.DATABASE_RUNTIME_URL) {
      throw new Error('DATABASE_RUNTIME_URL (non-owner medini_app) is required in production');
    }
    if (/medini_app_password/i.test(runtimeUrl)) {
      throw new Error('DATABASE_RUNTIME_URL must not use the development default medini_app credential in production');
    }
    if (/postgres:\/\/medini:/i.test(runtimeUrl)) {
      throw new Error('DATABASE_RUNTIME_URL must use the non-owner runtime role, not the table owner "medini"');
    }
  }
  return env;
}
