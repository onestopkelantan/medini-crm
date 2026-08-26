import { describe, it, expect } from 'vitest';
import { validateEnv } from '@config/env.validation';

describe('configuration — env validation', () => {
  it('applies safe defaults in development', () => {
    const env = validateEnv({ NODE_ENV: 'development' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.API_VERSION).toBe('v1');
  });

  it('rejects malformed values', () => {
    expect(() => validateEnv({ NODE_ENV: 'nope' })).toThrow();
    expect(() => validateEnv({ PORT: -1 })).toThrow();
  });

  it('requires real secrets in production (no placeholders)', () => {
    expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'dev_only_insecure_jwt_secret_change_me', DATABASE_URL: 'x', REDIS_URL: 'y' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'real', JWT_REFRESH_SECRET: 'real2', DATABASE_URL: '', REDIS_URL: 'y' })).toThrow(/DATABASE_URL/);
  });

  it('rejects production without a non-owner runtime DB role (DATABASE_RUNTIME_URL)', () => {
    expect(() => validateEnv({
      NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32),
      DATABASE_URL: 'postgres://medini:ownerpw@db/medini', REDIS_URL: 'redis://y',
    })).toThrow(/DATABASE_RUNTIME_URL/);
  });

  it('rejects production runtime URL that uses the owner role or the dev default password', () => {
    /* owner role "medini" forbidden at runtime */
    expect(() => validateEnv({
      NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32),
      DATABASE_URL: 'postgres://medini:ownerpw@db/medini',
      DATABASE_RUNTIME_URL: 'postgres://medini:ownerpw@db/medini', REDIS_URL: 'redis://y',
    })).toThrow(/non-owner runtime role/);
    /* dev default credential forbidden */
    expect(() => validateEnv({
      NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32),
      DATABASE_URL: 'postgres://medini:ownerpw@db/medini',
      DATABASE_RUNTIME_URL: 'postgres://medini_app:medini_app_password@db/medini', REDIS_URL: 'redis://y',
    })).toThrow(/development default medini_app credential/);
  });

  it('accepts a complete production config', () => {
    const env = validateEnv({
      NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32),
      DATABASE_URL: 'postgres://medini:ownerpw@db/medini',
      DATABASE_RUNTIME_URL: 'postgres://medini_app:real-runtime-secret@db/medini',
      REDIS_URL: 'redis://y',
    });
    expect(env.NODE_ENV).toBe('production');
  });
});
