import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { staff, refreshTokens } from '../../infrastructure/database/schema';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { PrincipalResolver } from './principal.resolver';
import { Principal } from './principal';
import { DbContextService } from './db-context.service';
import { UnauthorizedError } from '../../shared/errors/errors';

/** Safe login response — NEVER includes password/hash/secrets. */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    staffId: string;
    username: string;
    name: string;
    role: string;
    branchId: string | null;
    doctorId: string | null;
  };
}

const ORG_ID = '00000000-0000-0000-0000-000000000001'; /* single org */

/**
 * AuthService — login flow (Part 14):
 *   credentials → find staff → verify password (timing-safe) → check status →
 *   derive Principal (role/branch/doctor from DB) → issue JWT → safe response.
 *
 * No user enumeration: unknown user and wrong password return the SAME 401
 * message, and unknown users still run a dummy verify to equalize timing.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database | null,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly principals: PrincipalResolver,
    private readonly dbCtx: DbContextService,
  ) {}

  async login(username: string, password: string): Promise<{ result: LoginResult; principal: Principal }> {
    if (!this.db) throw new UnauthorizedError('Authentication unavailable');

    const rows = await this.db
      .select()
      .from(staff)
      .where(and(eq(staff.orgId, ORG_ID), eq(staff.username, username)))
      .limit(1);
    const member = rows[0];

    /* Timing-safe verify (works even when member is undefined). */
    const ok = await this.passwords.verifyLogin(member?.passwordHash ?? null, password);
    if (!member || !ok) {
      throw new UnauthorizedError('Invalid username or password'); /* single message — no enumeration */
    }

    /* Account status (Part 15): suspended/deactivated cannot authenticate. */
    if (member.status !== 'Active' || member.deletedAt) {
      throw new UnauthorizedError('Invalid username or password'); /* same message — do not leak status */
    }

    /* Derive the trusted Principal from DB (role/branch/doctor). */
    const principal = await this.principals.resolve(member.id, member.orgId);
    if (!principal) throw new UnauthorizedError('Invalid username or password');

    const accessToken = this.tokens.signAccess({
      sub: principal.staffId,
      username: principal.username,
      orgId: principal.orgId,
    });

    /* S10 T1: issue refresh token (secure storage + rotation + revocation). */
    const { rawToken: refreshToken } = await this.refreshTokens.issueRefreshToken(principal);

    const result: LoginResult = {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        staffId: principal.staffId,
        username: principal.username,
        name: member.name,
        role: principal.role,
        branchId: principal.branchId,
        doctorId: principal.doctorId,
      },
    };
    return { result, principal };
  }

  /** Refresh: rotate the refresh token, issue a new access token.
   *  Runs the lookup + rotation inside the resolved principal's RLS context
   *  (the refresh_tokens org-isolation RESTRICTIVE requires app_org_id). */
  async refresh(rawRefreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    if (!this.db) throw new UnauthorizedError('Authentication unavailable');

    /* The refresh token is opaque — resolve the owning staff via a system
     * worker context (org-isolation RESTRICTIVE applies to every query). */
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const ORG = '00000000-0000-0000-0000-000000000001';
    const found = await this.dbCtx.runAsWorker(
      { orgId: ORG, branchIds: [], correlationId: 'auth-refresh', source: 'system_worker' },
      async (tx) => {
        const rows = await tx
          .select({ staffId: refreshTokens.staffId, orgId: refreshTokens.orgId })
          .from(refreshTokens)
          .where(and(
            eq(refreshTokens.tokenHash, tokenHash),
            isNull(refreshTokens.revokedAt),
            isNull(refreshTokens.rotatedTo),
          ))
          .limit(1);
        return rows[0] ?? null;
      },
    );
    if (!found) throw new UnauthorizedError('Invalid or expired refresh token');

    const principal = await this.principals.resolve(found.staffId, found.orgId);
    if (!principal) throw new UnauthorizedError('Invalid refresh token');

    /* Rotate: revoke old, issue new (inside the principal's context). */
    const { rawToken: newRefreshToken } = await this.refreshTokens.rotate(rawRefreshToken, principal);
    const accessToken = this.tokens.signAccess({
      sub: principal.staffId,
      username: principal.username,
      orgId: principal.orgId,
    });

    return { accessToken, refreshToken: newRefreshToken, expiresIn: 900 };
  }

  /** Logout: revoke the refresh token server-side. */
  async logout(rawRefreshToken: string, principal: Principal): Promise<void> {
    await this.refreshTokens.revoke(rawRefreshToken, principal);
  }
}
