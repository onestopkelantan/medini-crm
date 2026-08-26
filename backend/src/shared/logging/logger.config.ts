/**
 * Pino logger configuration. Structured JSON logs, correlation ID injection,
 * aggressive secret/PII redaction. Categories via child loggers.
 */
export const LOG_CATEGORIES = ['app', 'security', 'audit', 'api', 'integration', 'worker'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

/** Paths that must NEVER appear in logs (secrets + credentials). */
export const REDACT_PATHS = [
  'password',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.secretKey',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.jwt',
  '*.bukkuApiKey',
  '*.wahaApiKey',
  '*.aiApiKey',
  'err.config.headers.Authorization',
  'err.config.headers.authorization',
];

export function buildPinoOptions(level: string, isProd: boolean) {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'medini-crm-backend' },
    timestamp: true,
    /* pretty print only in local dev for readability */
    transport: !isProd && process.env.NODE_ENV !== 'test'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  };
}
