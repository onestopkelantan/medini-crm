import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ConflictError, ForbiddenError, ValidationError } from '../../../shared/errors/errors';

const inputSchema = z.object({
  name: z.string().trim().min(2).max(256),
  role: z.enum(['doctor', 'branch_admin']).default('doctor'),
  phone: z.string().trim().max(64).nullish(),
  specialization: z.string().trim().max(256).nullish(),
  doctorRef: z.string().trim().max(64).nullish(),
});

@Injectable()
export class DoctorRegistrationService {
  constructor(
    private readonly dbCtx: DbContextService,
  ) {}

  async list(principal: Principal) {
    if (principal.role !== 'branch_manager' || !principal.branchId) {
      throw new ForbiddenError('Only branch manager can view branch staff');
    }
    return this.dbCtx.runAs(principal, async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, name, username, email, phone, role, status, branch_id AS "branchId"
        FROM staff
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${principal.branchId}
          AND deleted_at IS NULL
        ORDER BY name
      `);
      return (result as any).rows ?? [];
    });
  }

  async currentBranch(principal: Principal) {
    if (!principal.branchId) throw new ForbiddenError('No branch context');
    const result = await this.dbCtx.runAs(principal, (tx) => tx.execute(sql`
      SELECT id, short_name AS "name"
      FROM branches
      WHERE org_id = ${principal.orgId} AND id = ${principal.branchId}
      LIMIT 1
    `));
    return (result as any).rows?.[0] ?? null;
  }

  async register(principal: Principal, raw: unknown) {
    if (principal.role !== 'branch_manager') {
      throw new ForbiddenError('Only branch manager can register a doctor');
    }
    if (!principal.branchId) {
      throw new ForbiddenError('No branch context — access denied');
    }

    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }

    const input = parsed.data;
    const branchId = principal.branchId;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);
    const temporaryUsername = `invite_${token.slice(0, 20)}`;

    return this.dbCtx.runAs(principal, async (tx) => {

      const staff = await tx.execute(sql`
        INSERT INTO staff (org_id, branch_id, name, username, email, phone, role, status, invite_token, invite_expires_at, created_by, updated_by)
        VALUES (${principal.orgId}, ${branchId}, ${input.name}, ${temporaryUsername}, NULL, ${input.phone ?? null}, ${input.role}, 'Invited', ${token}, ${expiresAt}, ${principal.staffId}, ${principal.staffId})
        RETURNING id, name, username, email, phone, role, status, branch_id AS "branchId"
      `);
      const row = (staff as any).rows?.[0];
      if (!row) throw new ConflictError('Doctor registration failed');

      await tx.execute(sql`
        INSERT INTO role_assignments (org_id, staff_id, role, branch_id, status, assigned_by, created_by, updated_by)
        VALUES (${principal.orgId}, ${row.id}, ${input.role}, ${branchId}, 'ACTIVE', ${principal.staffId}, ${principal.staffId}, ${principal.staffId})
      `);
      const baseUrl = process.env.APP_PUBLIC_BASE_URL ?? 'https://medinident.com.my';
      return { ...row, inviteLink: `${baseUrl.replace(/\/$/, '')}/register?token=${encodeURIComponent(token)}`, expiresAt };
    });
  }
}
