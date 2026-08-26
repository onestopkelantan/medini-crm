import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdministrationService } from '@modules/administration/application/administration.service';

/**
 * S10 GLM R3 — invitation link baseUrl security.
 * The invite link origin must come ONLY from APP_PUBLIC_BASE_URL (server env),
 * never from the request (Host header / body). Fail-closed on bad config.
 */

/* The resolver is pure config logic (no DI) — invoke it on a bare instance. */
type Service = { resolvePublicBaseUrl: () => string };
const svc = Object.create(AdministrationService.prototype) as Service;

function setEnv(v?: string) {
  if (v === undefined) delete process.env.APP_PUBLIC_BASE_URL;
  else process.env.APP_PUBLIC_BASE_URL = v;
}

describe('S10 GLM R3 — invitation link baseUrl (config-only origin)', () => {
  beforeEach(() => setEnv(undefined));
  afterEach(() => setEnv(undefined));

  it('defaults to the dev frontend origin when unset', () => {
    expect(svc.resolvePublicBaseUrl()).toBe('http://localhost:5173');
  });

  it('uses the configured origin (https) exactly, ignoring any path', () => {
    setEnv('https://app.medini.example/some/path');
    expect(svc.resolvePublicBaseUrl()).toBe('https://app.medini.example');
  });

  it('rejects non-http(s) schemes fail-closed', () => {
    setEnv('javascript:alert(1)');
    expect(() => svc.resolvePublicBaseUrl()).toThrow(/APP_PUBLIC_BASE_URL/);
    setEnv('ftp://files.example');
    expect(() => svc.resolvePublicBaseUrl()).toThrow(/APP_PUBLIC_BASE_URL/);
    setEnv('data:text/html,hello');
    expect(() => svc.resolvePublicBaseUrl()).toThrow(/APP_PUBLIC_BASE_URL/);
  });

  it('rejects malformed values fail-closed', () => {
    setEnv('not a url');
    expect(() => svc.resolvePublicBaseUrl()).toThrow(/APP_PUBLIC_BASE_URL/);
  });

  it('client input can never influence the origin (no request-derived host)', () => {
    /* The controller signature no longer accepts any baseUrl input — the only
     * source is env. Normalized origin, nothing else appended. */
    setEnv('https://trusted.example');
    expect(svc.resolvePublicBaseUrl()).toMatch(/^https:\/\/trusted\.example$/);
  });
});
