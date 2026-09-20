import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { DbContextService } from './db-context.service';
import { PasswordService } from './password.service';
import { staff } from '../../infrastructure/database/schema';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors/errors';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * StaffRegistrationService — HQ-controlled staff self-registration.
 *
 * Governance model:
 *   HQ invites -> status='Invited'
 *   -> staff receives a single-use invitation token
 *   -> staff completes registration
 *   -> status='Pending'
 *   -> HQ approves
 *   -> status='Active'.
 *
 * Security invariants:
 *  - No public signup: registration requires a valid, unexpired invite token.
 *  - Staff cannot choose org/branch/role.
 *  - Passwords are Argon2id hashed.
 *  - Invitation tokens are single-use and expire.
 *
 * MySQL migration:
 *  Registration no longer depends on PostgreSQL SECURITY DEFINER / RLS.
 *  Validation and mutation run atomically inside a MySQL transaction with
 *  SELECT ... FOR UPDATE so the same invitation cannot be consumed twice.
 */
@Injectable()
export class StaffRegistrationService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly passwords: PasswordService,
    @Inject(DATABASE) private readonly db: Database | null,
  ) {}

  /**
   * Generate a single-use invitation token for an invited staff member.
   */
  async generateInviteToken(
    hqPrincipal: {
      staffId: string;
      role: string;
      orgId: string;
    },
    staffId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    if (hqPrincipal.role !== 'hq') {
      throw new ForbiddenError(
        'Only HQ can generate invitation tokens',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + 72 * 3600 * 1000,
    );

    await this.dbCtx.runAs(
      hqPrincipal as never,
      async (tx) => {
        const rows = await tx
          .select({ status: staff.status })
          .from(staff)
          .where(
            and(
              eq(staff.id, staffId),
              eq(staff.orgId, ORG_ID),
              isNull(staff.deletedAt),
            ),
          )
          .limit(1);

        const row = rows[0];

        if (!row) {
          throw new NotFoundError('staff', staffId);
        }

        if (row.status !== 'Invited') {
          throw new ConflictError(
            `Staff is not in Invited status (current: ${row.status})`,
          );
        }

        await tx
          .update(staff)
          .set({
            inviteToken: token,
            inviteExpiresAt: expiresAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(staff.id, staffId),
              eq(staff.orgId, ORG_ID),
            ),
          );
      },
    );

    return { token, expiresAt };
  }

  /**
   * Staff self-registration.
   *
   * MySQL transaction flow:
   *  1. Lock the invitation row.
   *  2. Validate token, status and expiry.
   *  3. Update identity/password.
   *  4. Clear the invitation token.
   *  5. Transition Invited -> Pending.
   */
  async register(input: {
    inviteToken: string;
    name: string;
    username: string;
    password: string;
  }): Promise<{ staffId: string; status: 'Pending' }> {
    if (
      !input.inviteToken ||
      !input.username ||
      !input.password ||
      !input.name
    ) {
      throw new ValidationError({
        _: [
          'inviteToken, name, username, and password are required',
        ],
      });
    }

    if (input.password.length < 8) {
      throw new ValidationError({
        password: [
          'Password must be at least 8 characters',
        ],
      });
    }

    if (!/^[a-z0-9_.-]+$/.test(input.username)) {
      throw new ValidationError({
        username: [
          'Lowercase letters, digits, _ . - only',
        ],
      });
    }

    if (!this.db) {
      throw new UnauthorizedError(
        'Authentication unavailable',
      );
    }

    const passwordHash =
      await this.passwords.hash(input.password);

    return this.dbCtx.runAsWorker(
      {
        orgId: ORG_ID,
        branchIds: [],
        correlationId: 'staff-registration',
        source: 'system_worker',
      },
      async (tx) => {
        const rows = await tx
          .select({
            id: staff.id,
            status: staff.status,
            inviteExpiresAt: staff.inviteExpiresAt,
          })
          .from(staff)
          .where(
            and(
              eq(staff.inviteToken, input.inviteToken),
              eq(staff.orgId, ORG_ID),
              isNull(staff.deletedAt),
            ),
          )
          .limit(1)
          .for('update');

        const member = rows[0];

        if (!member) {
          throw new UnauthorizedError(
            'Invalid or expired invitation',
          );
        }

        if (member.status !== 'Invited') {
          throw new ConflictError(
            `Invitation already used or invalid (status: ${member.status})`,
          );
        }

        if (
          member.inviteExpiresAt &&
          member.inviteExpiresAt < new Date()
        ) {
          throw new UnauthorizedError(
            'Invitation has expired',
          );
        }

        await tx
          .update(staff)
          .set({
            name: input.name,
            username: input.username.toLowerCase(),
            passwordHash,
            status: 'Pending',
            inviteToken: null,
            inviteExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(staff.id, member.id),
              eq(staff.orgId, ORG_ID),
            ),
          );

        return {
          staffId: member.id,
          status: 'Pending' as const,
        };
      },
    );
  }
}
