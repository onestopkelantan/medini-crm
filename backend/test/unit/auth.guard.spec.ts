import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '@core/auth/token.service';
import { AuthGuard } from '@core/auth/auth.guard';
import { UnauthorizedError } from '@shared/errors/errors';
import type { Principal } from '@core/auth/principal';

type ConfigLike = { get: (k: string) => unknown };

function cfg(secret = 'test-secret-0123456789abcdef', ttl = 900): ConfigLike {
  return { get: (k: string) => (k === 'jwt.secret' ? secret : k === 'jwt.accessTtl' ? ttl : undefined) };
}

function makeTokens(secret: string, ttl = 900): TokenService {
  return new TokenService(new JwtService({}), cfg(secret, ttl) as never);
}

function makeGuard(resolve: (id: string, orgId: string) => Promise<Principal | null>) {
  const reflector = new Reflector();
  const tokens = makeTokens('test-secret-0123456789abcdef');
  const principals = { resolve } as never;
  const guard = new AuthGuard(reflector, tokens, principals, {} as never);
  return { guard, tokens };
}

interface FakeReq { headers: Record<string, string>; principal?: Principal }
function httpCtx(req: FakeReq): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const staff: Principal = { staffId: 's1', username: 'hq', role: 'hq', orgId: 'org-1', branchId: null, doctorId: null };

describe('AuthGuard (authentication gate)', () => {
  it('401 when no Authorization header', async () => {
    const { guard } = makeGuard(async () => staff);
    await expect(guard.canActivate(httpCtx({ headers: {} }))).rejects.toThrow(UnauthorizedError);
  });

  it('401 when malformed token', async () => {
    const { guard } = makeGuard(async () => staff);
    await expect(guard.canActivate(httpCtx({ headers: { authorization: 'Bearer not-a-jwt' } }))).rejects.toThrow(UnauthorizedError);
  });

  it('401 when token signed with wrong secret (tampered)', async () => {
    const { guard } = makeGuard(async () => staff);
    const forged = makeTokens('other-secret-0123456789abcdef')
      .signAccess({ sub: 's1', username: 'hq', orgId: 'org-1' });
    await expect(guard.canActivate(httpCtx({ headers: { authorization: `Bearer ${forged}` } }))).rejects.toThrow(UnauthorizedError);
  });

  it('401 when Principal cannot be resolved (fail-closed)', async () => {
    const { guard, tokens } = makeGuard(async () => null);
    const token = tokens.signAccess({ sub: 'ghost', username: 'x', orgId: 'org-1' });
    await expect(guard.canActivate(httpCtx({ headers: { authorization: `Bearer ${token}` } }))).rejects.toThrow(UnauthorizedError);
  });

  it('resolves true for a valid token', async () => {
    const { guard, tokens } = makeGuard(async () => staff);
    const token = tokens.signAccess({ sub: 's1', username: 'hq', orgId: 'org-1' });
    await expect(guard.canActivate(httpCtx({ headers: { authorization: `Bearer ${token}` } }))).resolves.toBe(true);
  });

  it('bypasses (returns true) for @Public routes', async () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = (() => true) as never;
    const g2 = new AuthGuard(reflector, makeTokens('test-secret-0123456789abcdef'), { resolve: async () => null } as never, {} as never);
    await expect(g2.canActivate(httpCtx({ headers: {} }))).resolves.toBe(true);
  });
});
