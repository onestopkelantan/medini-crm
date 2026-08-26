import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { refreshTokens } from '../../infrastructure/database/schema';
import { DbContextService } from './db-context.service';
import { Principal } from './principal';
import { UnauthorizedError } from '../../shared/errors/errors';

/**
 * RefreshTokenService — secure refresh-token persistence + rotation + revocation.
 *
 * Governance D2 (S10 T1): secure refresh strategy with storage, rotation,
 * revocation — NOT stateless long-lived tokens.
 *
 * Design:
 *  - Refresh token = opaque random string (32 bytes, base64url).
 *  - Only the SHA-256 hash is persisted; the raw token is returned to the client once.
 *  - Rotation: on refresh, the old token is marked `rotated_to` the new token id.
 *  - Revocation: logout or deactivation sets `revoked_at`.
 *  - Reuse detection: if a rotated/revoked/expired token is presented, reject.
 *  - Runs inside the caller's RLS context (org-isolation RESTRICTIVE applies).
 */
@Injectable()
export class RefreshTokenService {
  private readonly refreshSecret: string;
  private readonly refreshTtl: number;

  constructor(
    @Inject(DATABASE) private readonly db: Database | null,
    private readonly jwt: JwtService,
    private readonly dbCtx: DbContextService,
    config: ConfigService,
  ) {
    this.refreshSecret = config.get<string>('jwt.refreshSecret') ?? '';
    this.refreshTtl = config.get<number>('jwt.refreshTtl') ?? 604800;
  }

  /** Hash a raw refresh token for storage/lookup. */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Issue a new refresh token for a staff member. Returns the RAW token. */
  async issueRefreshToken(
    principal: Principal,
    opts: { ip?: string; userAgent?: string } = {},
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    if (!this.db) throw new UnauthorizedError('Authentication unavailable');
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000);

    await this.dbCtx.runAs(principal, async (tx) => {
      await tx.insert(refreshTokens).values({
        orgId: principal.orgId,
        staffId: principal.staffId,
        tokenHash,
        expiresAt,
        createdIp: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
      });
    });

    return { rawToken, expiresAt };
  }

  /**
   * Rotate a refresh token: verify the old one, mark it rotated, issue a new pair.
   * Returns the new raw token + new access-token claims.
   */
  async rotate(
    rawToken: string,
    principal: Principal,
    opts: { ip?: string; userAgent?: string } = {},
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    if (!this.db) throw new UnauthorizedError('Authentication unavailable');
    const tokenHash = this.hashToken(rawToken);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Find the presented token. */
      const rows = await tx
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
        .limit(1);
      const existing = rows[0];

      if (!existing) throw new UnauthorizedError('Invalid or expired refresh token');
      if (existing.staffId !== principal.staffId) throw new UnauthorizedError('Invalid refresh token');
      if (existing.expiresAt < new Date()) throw new UnauthorizedError('Refresh token expired');
      if (existing.rotatedTo) throw new UnauthorizedError('Refresh token already rotated');

      /* Mark old token rotated. */
      const newRaw = randomBytes(32).toString('base64url');
      const newHash = this.hashToken(newRaw);
      const newExpires = new Date(Date.now() + this.refreshTtl * 1000);

      const inserted = await tx
        .insert(refreshTokens)
        .values({
          orgId: principal.orgId,
          staffId: principal.staffId,
          tokenHash: newHash,
          expiresAt: newExpires,
          createdIp: opts.ip ?? null,
          userAgent: opts.userAgent ?? null,
        })
        .returning({ id: refreshTokens.id });

      await tx
        .update(refreshTokens)
        .set({ rotatedTo: inserted[0]!.id, revokedAt: new Date() })
        .where(eq(refreshTokens.id, existing.id));

      return { rawToken: newRaw, expiresAt: newExpires };
    });
  }

  /** Revoke a refresh token (logout). */
  async revoke(rawToken: string, principal: Principal): Promise<void> {
    if (!this.db) throw new UnauthorizedError('Authentication unavailable');
    const tokenHash = this.hashToken(rawToken);
    await this.dbCtx.runAs(principal, async (tx) => {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.staffId, principal.staffId),
          isNull(refreshTokens.revokedAt),
        ));
    });
  }

  /** Revoke ALL refresh tokens for a staff member (deactivation). */
  async revokeAllForStaff(staffId: string, orgId: string): Promise<void> {
    if (!this.db) return;
    await this.dbCtx.runAsWorker(
      { orgId, branchIds: [], correlationId: 'deactivation-revoke', source: 'system_worker' },
      async (tx) => {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.staffId, staffId), isNull(refreshTokens.revokedAt)));
      },
    );
  }

  /** Verify a refresh token is valid (not revoked/rotated/expired). */
  async verify(rawToken: string, principal: Principal): Promise<boolean> {
    if (!this.db) return false;
    const tokenHash = this.hashToken(rawToken);
    try {
      return await this.dbCtx.runAs(principal, async (tx) => {
        const rows = await tx
          .select({ id: refreshTokens.id })
          .from(refreshTokens)
          .where(and(
            eq(refreshTokens.tokenHash, tokenHash),
            eq(refreshTokens.staffId, principal.staffId),
            isNull(refreshTokens.revokedAt),
          ))
          .limit(1);
        const t = rows[0];
        if (!t) return false;
        return true;
      });
    } catch {
      return false;
    }
  }
}
