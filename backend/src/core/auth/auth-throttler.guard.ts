import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerRequest } from '@nestjs/throttler';

/**
 * AuthThrottlerGuard — S10-05 rate limiting on the pre-auth attack surface.
 *
 * Scope: ONLY the @Public() auth endpoints (login / refresh / register).
 * Authenticated business routes are unaffected — shouldSkip() returns true
 * for any route without an explicit @Throttle(...) named-limit override.
 *
 * Trusted-proxy model (GLM 5.3 remediation, D-07 trust proxy):
 *   The backend MUST sit behind a trusted reverse proxy (Caddy) in
 *   production. Client-supplied X-Forwarded-For is UNTRUSTED by default:
 *   an attacker can prepend arbitrary IPs, so "leftmost XFF entry" lets
 *   them rotate buckets and bypass the rate limit.
 *
 *   TRUSTED_PROXIES (comma-separated CIDRs/IPs, env) defines which direct
 *   peers are allowed to supply forwarding headers:
 *     - empty/unset (default): X-Forwarded-For is IGNORED entirely — the
 *       socket address is the tracker. Safe behind an unlisted proxy too
 *       (all proxy clients then share ONE bucket — fail-safe, not fail-open).
 *     - set: the header is honored ONLY when the socket peer is listed;
 *       the RIGHTMOST entry is then the real client (the proxy puts the
 *       peer it observed there; anything left of it is client-supplied).
 *
 *   This repo's Caddyfile REPLACES X-Forwarded-For outright
 *   (`header_up X-Forwarded-For {remote_host}` — verified in Caddyfile),
 *   discarding any client-supplied value, so the single/rightmost entry is
 *   exactly the address Caddy observed — immune to left-side spoofing. The
 *   rightmost rule additionally stays correct for proxies that append.
 *
 * Named limits (see AuthController decorators):
 *   auth-login    : 5 requests / minute / IP
 *   auth-refresh  : 10 requests / minute / IP
 *   auth-register : 3 requests / minute / IP
 *
 * Tests/dev: rate limiting stays ACTIVE (the guard is the behaviour under
 * test in S10-05); E2E tests that need many rapid calls opt out explicitly
 * via @SkipThrottle(). Production and test behaviour are identical.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  /** Only throttle routes that declare a named throttler via @Throttle(). */
  protected async shouldSkip(_context: ExecutionContext): Promise<boolean> {
    const handler = _context.getHandler();
    const classRef = _context.getClass();
    for (const named of this.throttlers) {
      const limit = this.reflector.getAllAndOverride<number | undefined>(
        `THROTTLER:LIMIT${named.name}`,
        [handler, classRef],
      );
      if (limit !== undefined) return false; /* route opts in → throttle it */
    }
    return true; /* no @Throttle on this route → skip */
  }

  /**
   * Parse TRUSTED_PROXIES into a list of exact IPs / IPv4 CIDRs. Cached —
   * env is read once per process. Empty string → [] (trust nobody).
   */
  private static readonly trustedProxies: readonly string[] = (() => {
    const raw = (process.env.TRUSTED_PROXIES ?? '').trim();
    if (!raw) return [];
    return raw.split(',').map((e) => e.trim()).filter(Boolean);
  })();

  /** Exact IP or IPv4 CIDR membership test. */
  private static peerIsTrusted(peer: string, proxies: readonly string[]): boolean {
    if (!peer) return false;
    /* Normalize IPv6-mapped IPv4 (::ffff:10.0.0.1 → 10.0.0.1). */
    const ip = peer.startsWith('::ffff:') ? peer.slice(7) : peer;
    for (const entry of proxies) {
      if (entry === ip) return true;
      if (entry.includes('/')) {
        const [base, bitsStr] = entry.split('/');
        const bits = Number(bitsStr);
        if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
        const toInt = (v: string): number | null => {
          const parts = v.split('.');
          if (parts.length !== 4) return null;
          let n = 0;
          for (const p of parts) {
            const o = Number(p);
            if (!Number.isInteger(o) || o < 0 || o > 255) return null;
            n = (n << 8) | o;
          }
          return n >>> 0;
        };
        const a = toInt(ip);
        const b = toInt(base);
        if (a === null || b === null) continue;
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        if ((a & mask) === (b & mask)) return true;
      }
    }
    return false;
  }

  /** Resolve the real client IP under the trusted-proxy model. */
  /** Minimal shape of an inbound HTTP request used by the tracker. */
  private static resolveClientIp(req: {
    socket?: { remoteAddress?: string };
    headers?: Record<string, unknown>;
  }): string {
    const peer: string = req.socket?.remoteAddress ?? '';
    const proxies = AuthThrottlerGuard.trustedProxies;
    const xff = ((req.headers?.['x-forwarded-for'] ?? '') as string).trim();
    if (proxies.length === 0 || !xff) {
      /* No trusted proxies configured (or no header): use the socket peer.
       * Behind an unconfigured proxy this means one shared bucket —
       * fail-safe: attacks are still limited, legit users unaffected per-IP
       * only when the proxy is listed. */
      return peer || 'unknown';
    }
    if (!AuthThrottlerGuard.peerIsTrusted(peer, proxies)) {
      /* Header present but the direct peer is NOT trusted → ignore the
       * header (spoofing attempt or unlisted proxy). */
      return peer || 'unknown';
    }
    /* Peer is trusted: take the RIGHTMOST entry — the address the trusted
     * proxy actually observed. Left-side entries may be client-forged. */
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1]! : peer || 'unknown';
  }

  /** IP-based tracker; trusted-proxy-aware, prefixed for bucketing. */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return `auth:${AuthThrottlerGuard.resolveClientIp(req as { socket?: { remoteAddress?: string }; headers?: Record<string, unknown> })}`;
  }

  /** v6 hook: pass through to the base implementation. Exposed for clarity. */
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest(requestProps);
  }
}
