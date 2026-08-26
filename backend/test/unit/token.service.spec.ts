import { describe, it, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '@core/auth/token.service';
import { UnauthorizedError } from '@shared/errors/errors';

function makeTokenService(secret = 'test-secret-0123456789abcdef'): TokenService {
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'jwt.secret' ? secret : k === 'jwt.accessTtl' ? 900 : undefined) } as never;
  return new TokenService(jwt, config);
}

describe('TokenService (JWT)', () => {
  const svc = makeTokenService();

  it('issues a token that verifies back to the same claims', () => {
    const token = svc.signAccess({ sub: 'staff-1', username: 'hq', orgId: 'org-1' });
    const claims = svc.verifyAccess(token);
    expect(claims.sub).toBe('staff-1');
    expect(claims.username).toBe('hq');
    expect(claims.orgId).toBe('org-1');
  });

  it('rejects a malformed token', () => {
    expect(() => svc.verifyAccess('not-a-jwt')).toThrow(UnauthorizedError);
  });

  it('rejects a token signed with a different secret', () => {
    const other = makeTokenService('other-secret-0123456789abcdef');
    const token = other.signAccess({ sub: 'staff-1', username: 'hq', orgId: 'org-1' });
    expect(() => svc.verifyAccess(token)).toThrow(UnauthorizedError);
  });

  it('rejects a tampered token (modified payload)', () => {
    const token = svc.signAccess({ sub: 'staff-1', username: 'hq', orgId: 'org-1' });
    /* flip a character in the payload segment */
    const parts = token.split('.');
    const seg = parts[1] ?? '';
    parts[1] = seg.slice(0, -1) + (seg.endsWith('A') ? 'B' : 'A');
    expect(() => svc.verifyAccess(parts.join('.'))).toThrow(UnauthorizedError);
  });

  it('rejects an expired token', async () => {
    const jwt = new JwtService({});
    const config = { get: (k: string) => (k === 'jwt.secret' ? 'test-secret-0123456789abcdef' : k === 'jwt.accessTtl' ? -1 : undefined) } as never;
    const short = new TokenService(jwt, config);
    const token = short.signAccess({ sub: 'staff-1', username: 'hq', orgId: 'org-1' });
    /* expiresIn -1 → already expired */
    await new Promise((r) => setTimeout(r, 10));
    expect(() => short.verifyAccess(token)).toThrow(UnauthorizedError);
  });

  it('rejects a token missing required claims', () => {
    const jwt = new JwtService({});
    const config = { get: (k: string) => (k === 'jwt.secret' ? 'test-secret-0123456789abcdef' : k === 'jwt.accessTtl' ? 900 : undefined) } as never;
    const svc2 = new TokenService(jwt, config);
    const token = jwt.sign({ username: 'x' }, { secret: 'test-secret-0123456789abcdef', algorithm: 'HS256', issuer: 'medini-crm-backend', audience: 'medini-crm-client' });
    expect(() => svc2.verifyAccess(token)).toThrow(UnauthorizedError);
  });
});
