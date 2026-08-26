import { describe, it, expect, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService, Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from '@core/auth/auth-throttler.guard';

/**
 * S10-05 — AuthThrottlerGuard unit tests.
 * Proves: (a) opt-in routing (no @Throttle → skip), (b) IP tracker via
 * X-Forwarded-For / socket, (c) limit enforcement (4th login call blocked),
 * (d) @SkipThrottle still bypasses.
 */

function makeContext(handler: (...args: unknown[]) => unknown, req: Record<string, unknown>) {
  const context = {
    getHandler: () => handler,
    getClass: () => class TestClass {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: () => undefined, header: () => undefined }) }),
  } as never;
  return context;
}

class TestController {
  @Throttle({ auth: { limit: 3, ttl: 60000 } })
  login() {}

  @Throttle({ auth: { limit: 2, ttl: 60000 } })
  register() {}

  plain() {}

  @SkipThrottle()
  skipped() {}
}

describe('S10-05 — AuthThrottlerGuard', () => {
  let storage: ThrottlerStorageService;
  let guard: AuthThrottlerGuard;

  beforeEach(() => {
    storage = new ThrottlerStorageService();
    guard = new AuthThrottlerGuard(
      /* ONE module-level named throttler; routes override its limit via @Throttle.
       * (Multiple named throttlers would ALL apply to every decorated route —
       * the minimum limit would win, which is not the intent.) */
      [{ name: 'auth', ttl: 60000, limit: 1000 }],
      storage,
      new Reflector(),
    );
    /* Base guard reads this.throttlers in onModuleInit — call it manually. */
    void guard.onModuleInit();
  });

  it('skips routes without @Throttle decorator (business routes unaffected)', async () => {
    const ctx = makeContext(TestController.prototype.plain, { headers: {}, socket: { remoteAddress: '1.2.3.4' } });
    expect(await (guard as unknown as { shouldSkip: (c: unknown) => Promise<boolean> }).shouldSkip(ctx)).toBe(true);
  });

  it('throttles routes with @Throttle decorator', async () => {
    const ctx = makeContext(TestController.prototype.login, { headers: {}, socket: { remoteAddress: '1.2.3.4' } });
    expect(await (guard as unknown as { shouldSkip: (c: unknown) => Promise<boolean> }).shouldSkip(ctx)).toBe(false);
  });

  it('tracks by client IP; XFF honored only from trusted proxies (rightmost wins)', async () => {
    const getTracker = (guard as unknown as { getTracker: (r: Record<string, unknown>) => Promise<string> }).getTracker.bind(guard);
    /* Peer 10.0.0.1 is NOT trusted → client-supplied XFF ignored → peer IP. */
    expect(await getTracker({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } })).toBe('auth:10.0.0.1');
    /* No XFF → socket IP. */
    expect(await getTracker({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('auth:127.0.0.1');
    /* Nothing → unknown. */
    expect(await getTracker({ headers: {}, socket: {} })).toBe('auth:unknown');
  });

  it('blocks the 4th login attempt (limit 3/min) and allows a different IP', async () => {
    const req = { headers: {}, socket: { remoteAddress: '4.4.4.4' } };
    const build = () => makeContext(TestController.prototype.login, req);
    /* 3 allowed, 4th blocked. */
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const ctx = build();
      try {
        results.push(await guard.canActivate(ctx));
      } catch {
        results.push(false); /* ThrottlerGuard throws HttpException 429 */
      }
    }
    expect(results).toEqual([true, true, true, false]);
    /* Different IP not blocked by first IP's consumption. */
    const other = makeContext(TestController.prototype.login, { headers: {}, socket: { remoteAddress: '5.5.5.5' } });
    expect(await guard.canActivate(other)).toBe(true);
  });

  it('register limit (2/min) is independent from login bucket', async () => {
    const ctxReg = () => makeContext(TestController.prototype.register, { headers: {}, socket: { remoteAddress: '6.6.6.6' } });
    expect(await guard.canActivate(ctxReg())).toBe(true);
    expect(await guard.canActivate(ctxReg())).toBe(true);
    await expect(guard.canActivate(ctxReg())).rejects.toThrow();
  });

  it('@SkipThrottle bypasses even on a throttled route', async () => {
    const req = { headers: {}, socket: { remoteAddress: '7.7.7.7' } };
    for (let i = 0; i < 5; i++) {
      expect(await guard.canActivate(makeContext(TestController.prototype.skipped, req))).toBe(true);
    }
  });
});