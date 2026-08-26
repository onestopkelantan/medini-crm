import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { DbContextService } from './db-context.service';
import { PasswordService } from './password.service';
import { staff } from '../../infrastructure/database/schema';
import {
  ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError,
} from '../../shared/errors/errors';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * StaffRegistrationService — HQ-controlled staff self-registration (S10 T1).
 *
 * Governance model:
 *   HQ invites (inviteStaff → status='Invited') → staff receives single-use
 *   invitation token → staff completes registration (username + password) →
 *   status='Pending' → HQ approves (activate) → 'Active' → login allowed.
 *
 * Security invariants:
 *  - No public signup: registration requires a valid, unexpired invitation token.
 *  - Staff CANNOT choose org/branch/role — those are HQ-assigned at invite time.
 *  - Passwords are Argon2id-hashed via PasswordService (never plaintext).
 *  - Invitation tokens are single-use (cleared on successful registration) and expire.
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
   * Called by HQ after inviteStaff. Returns the raw token (to be shared
   * out-of-band, e.g. printed/WhatsApp — no notification infra in T1).
   */
  async generateInviteToken(hqPrincipal: { staffId: string; role: string; orgId: string }, staffId: string): Promise<{ token: string; expiresAt: Date }> {
    if (hqPrincipal.role !== 'hq') throw new ForbiddenError('Only HQ can generate invitation tokens');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000); /* 72h expiry */
    await this.dbCtx.runAs(hqPrincipal as never, async (tx) => {
      const row = await tx.select({ status: staff.status }).from(staff)
        .where(and(eq(staff.id, staffId), eq(staff.orgId, ORG_ID), isNull(staff.deletedAt))).limit(1);
      if (!row[0]) throw new NotFoundError('staff', staffId);
      if (row[0].status !== 'Invited') throw new ConflictError(`Staff is not in Invited status (current: ${row[0].status})`);
      await tx.update(staff).set({
        inviteToken: token,
        inviteExpiresAt: expiresAt,
        updatedAt: new Date(),
      } as never).where(eq(staff.id, staffId));
    });
    return { token, expiresAt };
  }

  /**
   * Staff self-registration: validate invite token, set username + password,
   * transition Invited → Pending. Staff CANNOT change role/branch/org.
   */
  async register(input: {
    inviteToken: string;
    name: string;
    username: string;
    password: string;
  }): Promise<{ staffId: string; status: 'Pending' }> {
    if (!input.inviteToken || !input.username || !input.password || !input.name) {
      throw new ValidationError({ _: ['inviteToken, name, username, and password are required'] });
    }
    if (input.password.length < 8) {
      throw new ValidationError({ password: ['Password must be at least 8 characters'] });
    }
    if (!/^[a-z0-9_.-]+$/.test(input.username)) {
      throw new ValidationError({ username: ['Lowercase letters, digits, _ . - only'] });
    }

    const passwordHash = await this.passwords.hash(input.password);

    /* Pre-auth path: no Principal exists yet. Use SECURITY DEFINER function to
     * bypass RLS for the registration update. RLS policies cannot reliably see
     * transaction-local GUCs during policy evaluation, so direct UPDATE fails. */
    if (!this.db) throw new UnauthorizedError('Authentication unavailable');

    /* Get a single connection from the pool. */
    const client = await (this.db as unknown as { $client: { connect: () => Promise<{ query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>; release: () => void }> } }).$client.connect();
    try {
      /* Call SECURITY DEFINER function — validates token, checks status/expiry,
       * and performs the update in one atomic step. */
      const result = await client.query(
        `SELECT id, status FROM register_staff_with_token($1, $2, $3, $4, $5)`,
        [input.inviteToken, input.name, input.username, passwordHash, ORG_ID],
      );
      const row = result.rows[0] as { id: string; status: string } | undefined;
      if (!row) throw new ConflictError('Registration failed — invitation may have been used');

      return { staffId: row.id, status: 'Pending' as const };
    } catch (e) {
      /* Map SECURITY DEFINER function errors to domain errors. */
      if (e && typeof e === 'object' && 'code' in e) {
        const err = e as { code: string; message: string };
        if (err.code === 'P0002') {
          if (err.message.includes('expired')) throw new UnauthorizedError('Invitation has expired');
          throw new UnauthorizedError('Invalid or expired invitation');
        }
        if (err.code === 'P0001') throw new ConflictError(err.message);
      }
      throw e;
    } finally {
      (client as unknown as { release: () => void }).release();
    }
  }
}
