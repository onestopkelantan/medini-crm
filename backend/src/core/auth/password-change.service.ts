import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { DbContextService } from './db-context.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { Principal } from './principal';
import { AuditService } from '../../shared/audit/audit.service';
import { ValidationError } from '../../shared/errors/errors';
import { staff } from '../../infrastructure/database/schema';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8, 'password must be at least 8 characters').max(256),
});

/**
 * PasswordChangeService — authenticated self-service password change.
 *
 * Security:
 *  - operates ONLY on the caller's own staff row (principal.staffId) — never a
 *    target from the body. (Staff RLS permits any human to write staff rows, so
 *    the self-scope guard lives here at the app layer.)
 *  - verifies the current password (Argon2id, constant-time) before changing.
 *  - never logs or returns password material.
 *  - revokes all refresh tokens on success so other sessions must re-authenticate.
 */
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
  ) {}

  async changePassword(principal: Principal, raw: unknown): Promise<{ ok: true }> {
    const parsed = changePasswordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      throw new ValidationError({ newPassword: ['New password must differ from the current password'] });
    }

    await this.dbCtx.runAs(principal, async (tx) => {
      const rows = await tx
        .select({ passwordHash: staff.passwordHash })
        .from(staff)
        .where(and(eq(staff.id, principal.staffId), eq(staff.orgId, principal.orgId)))
        .limit(1);
      const current = rows[0];
      if (!current) throw new ValidationError({ currentPassword: ['Account not found'] });

      const ok = await this.passwords.verify(current.passwordHash ?? '', currentPassword);
      if (!ok) throw new ValidationError({ currentPassword: ['Current password is incorrect'] });

      const newHash = await this.passwords.hash(newPassword);
      await tx
        .update(staff)
        .set({ passwordHash: newHash, updatedAt: new Date(), updatedBy: principal.staffId })
        .where(and(eq(staff.id, principal.staffId), eq(staff.orgId, principal.orgId)));

      await this.audit.record(
        {
          actorId: principal.staffId, actorRole: principal.role,
          action: 'auth_password_changed', entity: 'staff', entityId: principal.staffId,
          orgId: principal.orgId, branchId: principal.branchId, source: 'api',
        },
        tx,
      );
    });

    /* Force re-auth on every other session (own worker context internally). */
    await this.refreshTokens.revokeAllForStaff(principal.staffId, principal.orgId);
    return { ok: true };
  }
}
