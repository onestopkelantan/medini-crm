import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedError } from '../../shared/errors/errors';

/**
 * Claims carried in the access JWT. MINIMUM only — identity pointers, never
 * secrets/password hashes. Role/branch/doctor are NOT trusted from the token;
 * they are re-derived from the DB on each request (see PrincipalResolver), so
 * a tampered/stale role claim cannot elevate privileges.
 */
export interface AccessClaims {
  sub: string;        /* staff.id */
  username: string;   /* display/audit only */
  orgId: string;
}

/**
 * TokenService — JWT issue + verify. Secret/expiry/issuer/audience/algorithm
 * all come from environment config; nothing hardcoded. Production rejects
 * placeholder secrets at boot (env.validation).
 */
@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly accessTtl: number;
  private readonly issuer = 'medini-crm-backend';
  private readonly audience = 'medini-crm-client';

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('jwt.secret') ?? '';
    this.accessTtl = config.get<number>('jwt.accessTtl') ?? 900;
  }

  /** Issue an access token for an authenticated staff member. */
  signAccess(claims: AccessClaims): string {
    return this.jwt.sign(
      { sub: claims.sub, username: claims.username, orgId: claims.orgId },
      {
        secret: this.secret,
        expiresIn: this.accessTtl,
        issuer: this.issuer,
        audience: this.audience,
        algorithm: 'HS256',
      },
    );
  }

  /**
   * Verify + decode an access token. Rejects malformed, expired, wrong-sig,
   * wrong issuer/audience — all surface as 401 (no detail leak).
   */
  verifyAccess(token: string): AccessClaims {
    try {
      const payload = this.jwt.verify<AccessClaims & { iss?: string; aud?: string }>(token, {
        secret: this.secret,
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['HS256'],
      });
      if (!payload?.sub || !payload?.orgId) throw new Error('missing claims');
      return { sub: payload.sub, username: payload.username, orgId: payload.orgId };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}

export { UnauthorizedException };
